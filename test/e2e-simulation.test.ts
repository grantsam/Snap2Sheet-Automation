import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { SubmissionService, type IncomingMedia } from "../src/submission-service";
import { JsonStateStore } from "../src/state-store";
import { extractSentenceReport, InputError } from "../src/parser";
import type { AppConfig } from "../src/config";
import type { Draft, UploadedFile } from "../src/types";

// Mock Drive Repository
class MockDriveRepository {
  public uploadedFiles: { folderId: string; name: string; mimeType: string }[] = [];
  public createdFolders: { name: string; parentId: string }[] = [];
  public trashedIds: string[] = [];

  async verifyRootFolder(): Promise<{ name: string; sharedDrive: boolean }> {
    return { name: "Mock Root", sharedDrive: false };
  }

  async createDraftFolder(draft: Draft): Promise<string> {
    const folderId = `folder_${draft.registrationNumber}_${Date.now()}`;
    this.createdFolders.push({ name: folderId, parentId: "root" });
    return folderId;
  }

  async upload(
    folderId: string,
    baseName: string,
    _buffer: Buffer,
    mimeType: string,
    originalName?: string,
  ): Promise<UploadedFile> {
    const id = `drive_file_${Math.random().toString(36).slice(2, 9)}`;
    const name = `${baseName}.jpg`;
    this.uploadedFiles.push({ folderId, name: originalName || name, mimeType });
    return {
      id,
      name,
      webViewLink: `https://drive.google.com/file/d/${id}/view`,
    };
  }

  async trash(fileId: string): Promise<void> {
    this.trashedIds.push(fileId);
  }
}

// Mock Sheet Repository
class MockSheetRepository {
  public rows: (string | number)[][] = [];

  async ensureHeader(): Promise<void> {}

  async hasDuplicate(
    registrationNumber: string,
    reportDate: string,
    scope: string,
  ): Promise<boolean> {
    if (scope === "none") return false;
    return this.rows.some((row) => {
      const sameReg = String(row[4] ?? "").trim().toLowerCase() === registrationNumber.trim().toLowerCase();
      if (!sameReg) return false;
      return scope === "all" || String(row[1] ?? "").trim() === reportDate;
    });
  }

  async appendDraft(draft: Draft): Promise<{ sheetRow: number; sequenceNumber: number }> {
    const nextRowNumber = this.rows.length + 2; // +1 header, +1 for 1-based index
    const sequenceNumber = this.rows.length + 1;
    const attachment = (slot: keyof Draft["attachments"]): string => {
      const item = draft.attachments[slot];
      if (!item) throw new Error(`Slot ${slot} empty`);
      return `=IMAGE("https://drive.google.com/thumbnail?id=${item.driveFileId}&sz=w1000")`;
    };

    const row = [
      sequenceNumber,
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
    ];
    this.rows.push(row);
    return { sheetRow: nextRowNumber, sequenceNumber };
  }
}

function createTestConfig(stateFile: string): AppConfig {
  return {
    targetGroupName: "Test automation",
    targetGroupId: "120363428932565514@g.us",
    allowedSenders: new Set(),
    commandPrefix: "!",
    googleAuthMode: "oauth",
    spreadsheetId: "mock_sheet_id",
    sheetName: "Sheet1",
    driveFolderId: "mock_folder_id",
    googleOAuthRedirectUri: "http://localhost",
    timezone: "Asia/Jakarta",
    maxMediaBytes: 20 * 1024 * 1024,
    duplicateScope: "day",
    waAuthPath: "./data/mock-auth",
    stateFilePath: stateFile,
    port: 8080,
    logLevel: "error",
  };
}

function createDummyImage(sourceId: string): IncomingMedia {
  return {
    buffer: Buffer.from("fake_image_bytes_" + sourceId),
    mimeType: "image/jpeg",
    sourceMessageId: sourceId,
  };
}

test("E2E Scenario 1 [WORKS]: Standard 6-Photo Album Arrival with '4894 robiah'", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-e2e-1-"));
  const stateFile = path.join(tmpDir, "state.json");
  const config = createTestConfig(stateFile);
  const store = new JsonStateStore(stateFile);
  const drive = new MockDriveRepository();
  const sheets = new MockSheetRepository();
  const service = new SubmissionService(config, store, drive as any, sheets as any);

  const groupId = "120363428932565514@g.us";
  const senderId = "238211938955493@lid";
  const key = SubmissionService.draftKey(groupId, senderId);

  // 1. Simulate WhatsApp album buffer: Photos 1 to 5 arrive with empty captions
  const mediaBuffer: IncomingMedia[] = [];
  for (let i = 1; i <= 5; i++) {
    mediaBuffer.push(createDummyImage(`msg_${i}`));
  }

  // 2. Photo 6 arrives with caption "4894 robiah"
  const captionPayload = extractSentenceReport("4894 robiah");
  assert.ok(captionPayload, "Caption must parse as valid report payload");
  assert.equal(captionPayload.registrationNumber, "4894");
  assert.equal(captionPayload.customerName, "robiah");

  // Bot initializes draft upon receiving captioned photo
  let draft = await service.startOrReset(groupId, senderId, "Grant", captionPayload);
  assert.equal(draft.registrationNumber, "4894");

  // Drains early buffered photos (1-5) into slots 1-5
  for (const item of mediaBuffer) {
    const nextSlot = SubmissionService.getNextSlot(draft);
    assert.ok(nextSlot, "Next slot must be available for buffered media");
    const attachRes = await service.attach(key, nextSlot, item);
    draft = attachRes.draft;
  }

  // Attaches photo 6 into slot 6
  const photo6 = createDummyImage("msg_6");
  const finalSlot = SubmissionService.getNextSlot(draft);
  assert.equal(finalSlot, "dokumentasi_4", "Final slot should be dokumentasi_4");
  const finalAttach = await service.attach(key, finalSlot!, photo6);
  assert.equal(finalAttach.isComplete, true, "Draft must be complete with 6 photos");

  // Bot commits to Google Drive & Google Sheets
  const confirmation = await service.complete(key);
  assert.match(confirmation, /✅ Laporan 4894 \(robiah\) lengkap \(6 foto\) tersimpan di Google Sheets/);

  // Verify Drive and Sheets data integrity
  assert.equal(drive.uploadedFiles.length, 6, "Must upload exactly 6 photos to Google Drive");
  assert.equal(sheets.rows.length, 1, "Must append 1 complete row to Google Sheets");
  assert.equal(sheets.rows[0]![0], 1, "Sequence number should be 1");
  assert.equal(sheets.rows[0]![4], "4894", "Registration number in column E must be 4894");
  assert.equal(sheets.rows[0]![2], "robiah", "Customer name in column C must be robiah");
});

test("E2E Scenario 2 [WORKS]: Bracketed Sentence Format '0000 minz ( 3862 sri Maryati )' with 6 Photos", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-e2e-2-"));
  const stateFile = path.join(tmpDir, "state.json");
  const config = createTestConfig(stateFile);
  const store = new JsonStateStore(stateFile);
  const drive = new MockDriveRepository();
  const sheets = new MockSheetRepository();
  const service = new SubmissionService(config, store, drive as any, sheets as any);

  const key = SubmissionService.draftKey("group_1", "user_1");
  const payload = extractSentenceReport("0000 minz ( 3862 sri Maryati )");
  assert.ok(payload);
  assert.equal(payload.registrationNumber, "3862");
  assert.equal(payload.customerName, "sri Maryati");

  let draft = await service.startOrReset("group_1", "user_1", "User One", payload);

  for (let i = 1; i <= 6; i++) {
    const slot = SubmissionService.getNextSlot(draft);
    assert.ok(slot);
    const res = await service.attach(key, slot, createDummyImage(`p_${i}`));
    draft = res.draft;
  }

  const result = await service.complete(key);
  assert.match(result, /✅ Laporan 3862 \(sri Maryati\) lengkap/);
  assert.equal(sheets.rows.length, 1);
});

test("E2E Scenario 3 [DOES NOT WORK / SAFE]: Random Chat & Conversational Messages are Ignored", () => {
  // All these false-positive candidates MUST return undefined
  assert.equal(extractSentenceReport("i have 2"), undefined);
  assert.equal(extractSentenceReport("Anjay"), undefined);
  assert.equal(extractSentenceReport("masih pake gdrive"), undefined);
  assert.equal(extractSentenceReport("ga direct gsheet"), undefined);
  assert.equal(extractSentenceReport("mau gini aja atau gsheet only?"), undefined);
  assert.equal(extractSentenceReport("saya punya 1"), undefined);
  assert.equal(extractSentenceReport("halo test 12"), undefined);
  assert.equal(extractSentenceReport("tolong cek ini ya"), undefined);
});

test("E2E Scenario 4 [DOES NOT WORK / SAFE]: Duplicate Registration is Blocked", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-e2e-4-"));
  const stateFile = path.join(tmpDir, "state.json");
  const config = createTestConfig(stateFile);
  const store = new JsonStateStore(stateFile);
  const drive = new MockDriveRepository();
  const sheets = new MockSheetRepository();
  const service = new SubmissionService(config, store, drive as any, sheets as any);

  const key = SubmissionService.draftKey("group_1", "user_1");
  const payload = extractSentenceReport("4894 robiah")!;

  // First submission succeeds
  let draft = await service.startOrReset("group_1", "user_1", "User One", payload);
  for (let i = 1; i <= 6; i++) {
    const slot = SubmissionService.getNextSlot(draft)!;
    const res = await service.attach(key, slot, createDummyImage(`img_${i}`));
    draft = res.draft;
  }
  await service.complete(key);
  assert.equal(sheets.rows.length, 1);

  // Second submission with SAME registration number 4894 on the same date MUST fail
  let draft2 = await service.startOrReset("group_1", "user_1", "User One", payload);
  for (let i = 1; i <= 6; i++) {
    const slot = SubmissionService.getNextSlot(draft2)!;
    const res = await service.attach(key, slot, createDummyImage(`img_dup_${i}`));
    draft2 = res.draft;
  }

  await assert.rejects(
    async () => service.complete(key),
    (err: Error) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /Nomor registrasi 4894 sudah tersimpan/);
      return true;
    },
    "Duplicate submission must be rejected with InputError",
  );

  // Ensure sheet was NOT modified by the duplicate attempt
  assert.equal(sheets.rows.length, 1, "Duplicate row must not be added to Google Sheets");
});

test("E2E Scenario 5 [DOES NOT WORK / SAFE]: Incomplete Draft Cannot Be Completed", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-e2e-5-"));
  const stateFile = path.join(tmpDir, "state.json");
  const config = createTestConfig(stateFile);
  const store = new JsonStateStore(stateFile);
  const drive = new MockDriveRepository();
  const sheets = new MockSheetRepository();
  const service = new SubmissionService(config, store, drive as any, sheets as any);

  const key = SubmissionService.draftKey("group_1", "user_1");
  const payload = extractSentenceReport("9999 Sari Lestari")!;

  let draft = await service.startOrReset("group_1", "user_1", "User One", payload);

  // Only upload 3 of 6 photos
  for (let i = 1; i <= 3; i++) {
    const slot = SubmissionService.getNextSlot(draft)!;
    const res = await service.attach(key, slot, createDummyImage(`p_${i}`));
    draft = res.draft;
  }

  // Attempting complete must fail with missing attachments error
  await assert.rejects(
    async () => service.complete(key),
    (err: Error) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /Belum lengkap/);
      return true;
    },
  );

  assert.equal(sheets.rows.length, 0, "No row should be written for incomplete submission");
});

test("E2E Scenario 6 [DOES NOT WORK / SAFE]: Non-image / Corrupt Mime Type is Rejected", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "s2s-e2e-6-"));
  const stateFile = path.join(tmpDir, "state.json");
  const config = createTestConfig(stateFile);
  const store = new JsonStateStore(stateFile);
  const drive = new MockDriveRepository();
  const sheets = new MockSheetRepository();
  const service = new SubmissionService(config, store, drive as any, sheets as any);

  const key = SubmissionService.draftKey("group_1", "user_1");
  const payload = extractSentenceReport("5555 Ahmad Dahlan")!;
  const draft = await service.startOrReset("group_1", "user_1", "User One", payload);

  const invalidAudioMedia: IncomingMedia = {
    buffer: Buffer.from("audio_bytes"),
    mimeType: "audio/mp3",
    sourceMessageId: "bad_media",
  };

  const slot = SubmissionService.getNextSlot(draft)!;
  await assert.rejects(
    async () => service.attach(key, slot, invalidAudioMedia),
    (err: Error) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /Lampiran harus berupa gambar atau PDF/);
      return true;
    },
  );
});

test("E2E Scenario 7 [WORKS]: Backwards Sliding Window detects unrecorded submissions", async () => {
  const sheets = new MockSheetRepository();
  sheets.rows.push([1, "2026-08-16", "Existing User", "-", "1001", "img1", "img2", "img3", "img4", "img5", "img6"]);

  const has1001 = await sheets.hasDuplicate("1001", "2026-08-16", "day");
  assert.equal(has1001, true, "1001 must be recognized as existing in sheet");

  const has1201 = await sheets.hasDuplicate("1201", "2026-08-16", "day");
  assert.equal(has1201, false, "1201 must be recognized as new/unrecorded");

  const existing = await sheets.hasDuplicate("1001", "2026-08-16", "day");
  assert.equal(existing, true);
});
