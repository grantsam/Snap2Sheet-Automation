export const ATTACHMENT_SLOTS = [
  "berita_acara",
  "isometris",
  "dokumentasi_1",
  "dokumentasi_2",
  "dokumentasi_3",
  "dokumentasi_4",
] as const;

export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

export interface StartPayload {
  registrationNumber: string;
  customerName: string;
  address: string;
}

export interface AttachmentRecord {
  slot: AttachmentSlot;
  driveFileId: string;
  driveUrl: string;
  fileName: string;
  mimeType: string;
  sourceMessageId: string;
  uploadedAt: string;
}

export interface Draft {
  id: string;
  key: string;
  groupId: string;
  senderId: string;
  senderName: string;
  registrationNumber: string;
  customerName: string;
  address: string;
  reportDate: string;
  createdAt: string;
  updatedAt: string;
  driveFolderId?: string;
  attachments: Partial<Record<AttachmentSlot, AttachmentRecord>>;
}

export interface SubmissionRecord {
  id: string;
  registrationNumber: string;
  reportDate: string;
  sheetRow: number;
  completedAt: string;
}

export interface PersistentState {
  version: 1;
  drafts: Record<string, Draft>;
  processedMessages: Record<string, string>;
  submissions: Record<string, SubmissionRecord>;
}

export interface UploadedFile {
  id: string;
  name: string;
  webViewLink: string;
}

export type DuplicateScope = "day" | "all" | "none";
