import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStateStore } from "../src/state-store";
import type { Draft } from "../src/types";

test("JsonStateStore menyimpan draft dan mencegah message diproses dua kali", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "snap2sheet-test-"));
  const filePath = path.join(directory, "state.json");
  const store = new JsonStateStore(filePath);
  await store.initialize();

  const draft: Draft = {
    id: "S2S-TEST",
    key: "group:sender",
    groupId: "group",
    senderId: "sender",
    senderName: "Petugas",
    registrationNumber: "REG-1",
    customerName: "Pelanggan",
    address: "Alamat",
    reportDate: "2026-08-16",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: {},
  };
  await store.saveDraft(draft);
  assert.equal((await store.getDraft(draft.key))?.registrationNumber, "REG-1");

  await store.markMessageProcessed("message-1");
  assert.equal(await store.hasProcessedMessage("message-1"), true);
});
