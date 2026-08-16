import { Readable } from "node:stream";
import path from "node:path";
import mime from "mime-types";
import { google } from "googleapis";
import type { AppConfig } from "./config";
import type { Draft, UploadedFile } from "./types";
import { createGoogleAuth } from "./google-auth";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function safeName(value: string, maxLength = 100): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\\/:*?"<>|#%{}~&]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "tanpa-nama").slice(0, maxLength);
}

export class DriveRepository {
  private readonly drive;
  private readonly dateFolderPromises = new Map<string, Promise<string>>();

  constructor(
    private readonly config: AppConfig,
    auth = createGoogleAuth(config),
  ) {
    this.drive = google.drive({ version: "v3", auth });
  }

  async verifyRootFolder(): Promise<{ name: string; sharedDrive: boolean }> {
    const response = await this.drive.files.get({
      fileId: this.config.driveFolderId,
      fields: "id,name,mimeType,driveId,capabilities(canAddChildren)",
      supportsAllDrives: true,
    });
    const folder = response.data;
    if (folder.mimeType !== FOLDER_MIME) throw new Error("GOOGLE_DRIVE_FOLDER_ID bukan folder.");
    if (!folder.capabilities?.canAddChildren) throw new Error("Bot tidak memiliki izin upload ke folder Drive.");
    if (this.config.googleAuthMode === "service_account" && !folder.driveId) {
      throw new Error(
        "Service account tidak dapat memiliki file di My Drive. Gunakan OAuth atau pindahkan folder ke Shared Drive.",
      );
    }
    return { name: folder.name ?? "Drive Folder", sharedDrive: Boolean(folder.driveId) };
  }

  async createDraftFolder(draft: Draft): Promise<string> {
    const dateFolderId = await this.getDateFolder(draft.reportDate);
    const folderName = safeName(
      `${draft.registrationNumber} - ${draft.customerName} - ${draft.id}`,
      180,
    );
    return this.createFolder(folderName, dateFolderId, `Snap2Sheet submission ${draft.id}`);
  }

  private getDateFolder(date: string): Promise<string> {
    const existing = this.dateFolderPromises.get(date);
    if (existing) return existing;
    const operation = this.findOrCreateFolder(date, this.config.driveFolderId);
    this.dateFolderPromises.set(date, operation);
    const cleanup = (): void => {
      if (this.dateFolderPromises.get(date) === operation) this.dateFolderPromises.delete(date);
    };
    void operation.then(cleanup, cleanup);
    return operation;
  }

  async upload(
    folderId: string,
    baseName: string,
    buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ): Promise<UploadedFile> {
    const originalExtension = originalName ? path.extname(originalName).replace(/^\./, "") : "";
    const extension = safeName(originalExtension || mime.extension(mimeType) || "bin", 12);
    const fileName = `${safeName(baseName, 120)}.${extension}`;
    const response = await this.drive.files.create({
      requestBody: { name: fileName, mimeType, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    });
    if (!response.data.id || !response.data.webViewLink) {
      throw new Error("Drive tidak mengembalikan ID atau tautan file.");
    }
    const fileId = response.data.id;
    try {
      await this.drive.permissions.create({
        fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
        supportsAllDrives: true,
      });
    } catch {
      // Permission might be inherited from parent folder
    }
    return {
      id: fileId,
      name: response.data.name ?? fileName,
      webViewLink: response.data.webViewLink,
    };
  }

  async trash(fileId: string): Promise<void> {
    await this.drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: "id,trashed",
      supportsAllDrives: true,
    });
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const response = await this.drive.files.list({
      q: `'${escapeDriveQuery(parentId)}' in parents and name='${escapeDriveQuery(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: "files(id,name)",
      pageSize: 2,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const existing = response.data.files?.[0]?.id;
    return existing ?? this.createFolder(name, parentId);
  }

  private async createFolder(name: string, parentId: string, description?: string): Promise<string> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
        ...(description ? { description } : {}),
      },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!response.data.id) throw new Error("Drive tidak mengembalikan ID folder.");
    return response.data.id;
  }
}
