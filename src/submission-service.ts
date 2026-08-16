import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config";
import { DriveRepository } from "./drive-repository";
import { KeyedQueue } from "./keyed-queue";
import { attachmentSlotLabel, InputError } from "./parser";
import { SheetRepository } from "./sheet-repository";
import { JsonStateStore } from "./state-store";
import {
  ATTACHMENT_SLOTS,
  type AttachmentSlot,
  type Draft,
  type StartPayload,
} from "./types";

export interface IncomingMedia {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
  sourceMessageId: string;
}

function reportDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function uploadBaseName(slot: AttachmentSlot): string {
  const index = ATTACHMENT_SLOTS.indexOf(slot) + 1;
  return `${String(index).padStart(2, "0")}-${slot.replace(/_/g, "-")}`;
}

export class SubmissionService {
  private readonly completionQueue = new KeyedQueue();

  constructor(
    private readonly config: AppConfig,
    private readonly store: JsonStateStore,
    private readonly drive: DriveRepository,
    private readonly sheets: SheetRepository,
  ) {}

  static draftKey(groupId: string, senderId: string): string {
    return `${groupId}:${senderId}`;
  }

  async getExistingSheetInfo(): Promise<{ existingNoregs: Set<string>; latestDate?: string }> {
    return this.sheets.getExistingSubmissions();
  }

  static getNextSlot(draft: Draft): AttachmentSlot | undefined {
    return ATTACHMENT_SLOTS.find((slot) => !draft.attachments[slot]);
  }

  async getDraft(key: string): Promise<Draft | undefined> {
    return this.store.getDraft(key);
  }

  async startOrReset(
    groupId: string,
    senderId: string,
    senderName: string,
    payload: StartPayload,
  ): Promise<Draft> {
    const key = SubmissionService.draftKey(groupId, senderId);
    const existing = await this.store.getDraft(key);
    if (existing?.driveFolderId) {
      await this.drive.trash(existing.driveFolderId).catch(() => {});
    }
    const now = new Date();
    const date = reportDate(now, this.config.timezone);
    const draft: Draft = {
      id: `S2S-${date.replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      key,
      groupId,
      senderId,
      senderName,
      registrationNumber: payload.registrationNumber,
      customerName: payload.customerName,
      address: payload.address || "-",
      reportDate: date,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      attachments: {},
    };
    await this.store.saveDraft(draft);
    return draft;
  }

  async start(
    groupId: string,
    senderId: string,
    senderName: string,
    payload: StartPayload,
  ): Promise<string> {
    const key = SubmissionService.draftKey(groupId, senderId);
    if (await this.store.getDraft(key)) {
      throw new InputError("Masih ada draft aktif. Selesaikan dengan !selesai atau batalkan dengan !batal konfirmasi.");
    }
    const now = new Date();
    const date = reportDate(now, this.config.timezone);
    const draft: Draft = {
      id: `S2S-${date.replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
      key,
      groupId,
      senderId,
      senderName,
      registrationNumber: payload.registrationNumber,
      customerName: payload.customerName,
      address: payload.address || "-",
      reportDate: date,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      attachments: {},
    };
    await this.store.saveDraft(draft);
    return [
      `✅ Draft ${draft.id} dibuat untuk ${draft.customerName} (${draft.registrationNumber}).`,
      "Kirim enam lampiran dengan caption: #ba, #iso, #dok1, #dok2, #dok3, #dok4.",
      "Setelah lengkap, kirim !selesai.",
    ].join("\n");
  }

  async attach(
    key: string,
    slot: AttachmentSlot,
    media: IncomingMedia,
  ): Promise<{ message: string; count: number; isComplete: boolean; draft: Draft }> {
    if (media.buffer.length > this.config.maxMediaBytes) {
      throw new InputError(`Ukuran file melebihi batas ${Math.round(this.config.maxMediaBytes / 1024 / 1024)} MB.`);
    }
    if (!(media.mimeType.startsWith("image/") || media.mimeType === "application/pdf")) {
      throw new InputError("Lampiran harus berupa gambar atau PDF.");
    }

    const draft = await this.requireDraft(key);
    if (draft.attachments[slot]) {
      throw new InputError(
        `${attachmentSlotLabel(slot)} sudah terisi. Hapus dahulu dengan !hapus ${slot.replace("dokumentasi_", "dok").replace("berita_acara", "ba")} lalu kirim ulang.`,
      );
    }

    if (!draft.driveFolderId) {
      draft.driveFolderId = await this.drive.createDraftFolder(draft);
      draft.updatedAt = new Date().toISOString();
      await this.store.saveDraft(draft);
    }

    const uploaded = await this.drive.upload(
      draft.driveFolderId,
      uploadBaseName(slot),
      media.buffer,
      media.mimeType,
      media.originalName,
    );
    draft.attachments[slot] = {
      slot,
      driveFileId: uploaded.id,
      driveUrl: uploaded.webViewLink,
      fileName: uploaded.name,
      mimeType: media.mimeType,
      sourceMessageId: media.sourceMessageId,
      uploadedAt: new Date().toISOString(),
    };
    draft.updatedAt = new Date().toISOString();
    await this.store.saveDraft(draft);

    const count = ATTACHMENT_SLOTS.filter((item) => draft.attachments[item]).length;
    const isComplete = count === ATTACHMENT_SLOTS.length;
    const message = `✅ ${attachmentSlotLabel(slot)} diterima (${count}/6).${isComplete ? " Lengkap." : ""}`;
    return { message, count, isComplete, draft };
  }

  async status(key: string): Promise<string> {
    const draft = await this.requireDraft(key);
    const rows = ATTACHMENT_SLOTS.map(
      (slot) => `${draft.attachments[slot] ? "✅" : "⬜"} ${attachmentSlotLabel(slot)}`,
    );
    return [
      `Draft: ${draft.id}`,
      `Noreg: ${draft.registrationNumber}`,
      `Nama: ${draft.customerName}`,
      `Alamat: ${draft.address}`,
      "",
      ...rows,
    ].join("\n");
  }

  async removeAttachment(key: string, slot: AttachmentSlot): Promise<string> {
    const draft = await this.requireDraft(key);
    const attachment = draft.attachments[slot];
    if (!attachment) throw new InputError(`${attachmentSlotLabel(slot)} belum terisi.`);
    await this.drive.trash(attachment.driveFileId);
    delete draft.attachments[slot];
    draft.updatedAt = new Date().toISOString();
    await this.store.saveDraft(draft);
    return `🗑️ ${attachmentSlotLabel(slot)} dipindahkan ke Trash Drive. Silakan kirim penggantinya.`;
  }

  async cancel(key: string): Promise<string> {
    const draft = await this.requireDraft(key);
    if (draft.driveFolderId) await this.drive.trash(draft.driveFolderId);
    await this.store.cancelDraft(key);
    return `🗑️ Draft ${draft.id} dibatalkan. Folder lampiran dipindahkan ke Trash Drive.`;
  }

  async complete(key: string): Promise<string> {
    const initialDraft = await this.requireDraft(key);
    const duplicateKey = [
      this.config.duplicateScope,
      this.config.duplicateScope === "day" ? initialDraft.reportDate : "all",
      initialDraft.registrationNumber.trim().toLowerCase(),
    ].join(":");
    return this.completionQueue.run(duplicateKey, () => this.completeLocked(key));
  }

  private async completeLocked(key: string): Promise<string> {
    const draft = await this.requireDraft(key);
    const missing = ATTACHMENT_SLOTS.filter((slot) => !draft.attachments[slot]);
    if (missing.length > 0) {
      throw new InputError(
        `Belum lengkap: ${missing.map(attachmentSlotLabel).join(", ")}. Kirim !status untuk memeriksa.`,
      );
    }

    const sheetDuplicate = await this.sheets.hasDuplicate(
      draft.registrationNumber,
      draft.reportDate,
      this.config.duplicateScope,
    );
    if (sheetDuplicate) {
      throw new InputError(
        `Nomor registrasi ${draft.registrationNumber} sudah tersimpan di Google Sheets${this.config.duplicateScope === "day" ? " pada tanggal ini" : ""}. Draft tidak dihapus.`,
      );
    }

    const result = await this.sheets.appendDraft(draft);
    const completedAt = new Date().toISOString();
    await this.store.completeDraft(key, {
      id: draft.id,
      registrationNumber: draft.registrationNumber,
      reportDate: draft.reportDate,
      sheetRow: result.sheetRow,
      completedAt,
    });
    return `✅ Laporan ${draft.registrationNumber} (${draft.customerName}) lengkap (6 foto) tersimpan di Google Sheets (No. ${result.sequenceNumber}).`;
  }

  private async requireDraft(key: string): Promise<Draft> {
    const draft = await this.store.getDraft(key);
    if (!draft) {
      throw new InputError("Belum ada draft aktif. Mulai dengan !mulai, noreg, nama, dan alamat.");
    }
    return draft;
  }
}
