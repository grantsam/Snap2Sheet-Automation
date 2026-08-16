import { google } from "googleapis";
import type { AppConfig } from "./config";
import type { Draft, DuplicateScope } from "./types";
import { createGoogleAuth } from "./google-auth";

export const SHEET_HEADERS = [
  "No.",
  "Tanggal",
  "Nama Pelanggan",
  "Alamat",
  "Nomor Registrasi",
  "Berita Acara",
  "Isometris",
  "Dokumentasi 1",
  "Dokumentasi 2",
  "Dokumentasi 3",
  "Dokumentasi 4",
] as const;

function quotedSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function rowNumberFromRange(range: string | null | undefined): number {
  const match = range?.match(/![A-Z]+(\d+):/i);
  if (!match?.[1]) throw new Error("Tidak dapat membaca nomor baris hasil append Sheets.");
  return Number(match[1]);
}

export class SheetRepository {
  private readonly sheets;

  constructor(
    private readonly config: AppConfig,
    auth = createGoogleAuth(config),
  ) {
    this.sheets = google.sheets({ version: "v4", auth });
  }

  async ensureHeader(): Promise<void> {
    const sheetId = await this.getSheetId();
    const range = `${quotedSheetName(this.config.sheetName)}!A1:K1`;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range,
    });
    const existing = response.data.values?.[0]?.map(String) ?? [];

    if (existing.length > 0) {
      const mismatch = SHEET_HEADERS.some(
        (header, index) => (existing[index]?.trim() || "").toLowerCase() !== header.toLowerCase(),
      );
      if (mismatch) {
        throw new Error(
          `Header sheet tidak sesuai. Diharapkan: ${SHEET_HEADERS.join(" | ")}`,
        );
      }
      return;
    }

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [[...SHEET_HEADERS]] },
    });
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.config.spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true },
                  horizontalAlignment: "CENTER",
                  verticalAlignment: "MIDDLE",
                  backgroundColor: { red: 0.82, green: 0.9, blue: 0.97 },
                },
              },
              fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,backgroundColor)",
            },
          },
          {
            updateDimensionProperties: {
              range: { sheetId, dimension: "COLUMNS", startIndex: 5, endIndex: 11 },
              properties: { pixelSize: 130 },
              fields: "pixelSize",
            },
          },
        ],
      },
    });
  }

  async getExistingSubmissions(): Promise<{ existingNoregs: Set<string>; latestDate?: string }> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quotedSheetName(this.config.sheetName)}!B2:E`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const values = response.data.values ?? [];
    const existingNoregs = new Set<string>();
    let latestDate: string | undefined;

    for (const row of values) {
      const date = String(row[0] ?? "").trim();
      const noreg = String(row[3] ?? "").trim().toLowerCase();
      if (noreg) existingNoregs.add(noreg);
      if (date) {
        if (!latestDate || date > latestDate) {
          latestDate = date;
        }
      }
    }
    return { existingNoregs, ...(latestDate ? { latestDate } : {}) };
  }

  async hasDuplicate(
    registrationNumber: string,
    reportDate: string,
    scope: DuplicateScope,
  ): Promise<boolean> {
    if (scope === "none") return false;
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quotedSheetName(this.config.sheetName)}!B2:E`,
      valueRenderOption: "FORMATTED_VALUE",
    });
    const normalizedRegistration = registrationNumber.trim().toLowerCase();
    return (response.data.values ?? []).some((row) => {
      const sameRegistration = String(row[3] ?? "").trim().toLowerCase() === normalizedRegistration;
      if (!sameRegistration) return false;
      return scope === "all" || String(row[0] ?? "").trim() === reportDate;
    });
  }

  async appendDraft(draft: Draft): Promise<{ sheetRow: number; sequenceNumber: number }> {
    const attachment = (slot: keyof Draft["attachments"]): string => {
      const item = draft.attachments[slot];
      if (!item) throw new Error(`Lampiran ${slot} belum lengkap.`);
      return `=IMAGE("https://drive.google.com/thumbnail?id=${item.driveFileId}&sz=w1000")`;
    };

    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quotedSheetName(this.config.sheetName)}!A:K`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [
            "",
            draft.reportDate,
            draft.customerName,
            draft.address,
            draft.registrationNumber,
            attachment("berita_acara"),
            attachment("isometris"),
            attachment("dokumentasi_1"),
            attachment("dokumentasi_2"),
            attachment("dokumentasi_3"),
            attachment("dokumentasi_4"),
          ],
        ],
      },
    });
    const sheetRow = rowNumberFromRange(response.data.updates?.updatedRange);
    const sequenceNumber = sheetRow - 1;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.config.spreadsheetId,
      range: `${quotedSheetName(this.config.sheetName)}!A${sheetRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[sequenceNumber]] },
    });

    // Set row height to 120px so image preview is crisp and visible
    try {
      const sheetId = await this.getSheetId();
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.config.spreadsheetId,
        requestBody: {
          requests: [
            {
              updateDimensionProperties: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: sheetRow - 1,
                  endIndex: sheetRow,
                },
                properties: { pixelSize: 120 },
                fields: "pixelSize",
              },
            },
          ],
        },
      });
    } catch {
      // Non-critical layout update
    }

    return { sheetRow, sequenceNumber };
  }

  private async getSheetId(): Promise<number> {
    const response = await this.sheets.spreadsheets.get({
      spreadsheetId: this.config.spreadsheetId,
      fields: "sheets.properties(sheetId,title)",
    });
    const sheet = response.data.sheets?.find(
      (item) => item.properties?.title === this.config.sheetName,
    );
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`Worksheet '${this.config.sheetName}' tidak ditemukan.`);
    }
    return sheetId;
  }
}
