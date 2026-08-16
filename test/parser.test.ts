import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSentenceReport,
  parseAttachmentSlot,
  parseStartCommand,
} from "../src/parser";

test("extractSentenceReport parses 0000 minz ( noreg nama ) format", () => {
  const result = extractSentenceReport("0000 minz ( 123456789 Budi Santoso )");
  assert.deepEqual(result, {
    registrationNumber: "123456789",
    customerName: "Budi Santoso",
    address: "-",
  });
});

test("extractSentenceReport parses real WhatsApp screenshot formats", () => {
  // Format A: Number first (3862 sri Maryati)
  const r1 = extractSentenceReport("3862 sri Maryati");
  assert.deepEqual(r1, {
    registrationNumber: "3862",
    customerName: "sri Maryati",
    address: "-",
  });

  // Format B: Name first (Samina 4469)
  const r2 = extractSentenceReport("Samina 4469");
  assert.deepEqual(r2, {
    registrationNumber: "4469",
    customerName: "Samina",
    address: "-",
  });

  // Variations with punctuations & honorifics
  const r3 = extractSentenceReport("3862 - Sri Maryati");
  assert.equal(r3?.registrationNumber, "3862");
  assert.equal(r3?.customerName, "Sri Maryati");

  const r4 = extractSentenceReport("M. Syahputra 4469");
  assert.equal(r4?.registrationNumber, "4469");
  assert.equal(r4?.customerName, "M. Syahputra");
});

test("parseStartCommand membaca tiga field dan mempertahankan titik dua pada alamat", () => {
  const result = parseStartCommand(
    "!mulai\nnoreg: REG-001\nnama: Budi Santoso\nalamat: Jl. Melati No. 5: Blok A",
  );
  assert.deepEqual(result, {
    registrationNumber: "REG-001",
    customerName: "Budi Santoso",
    address: "Jl. Melati No. 5: Blok A",
  });
});

test("parseStartCommand menerima alias nama pelanggan dan nomor registrasi", () => {
  const result = parseStartCommand(
    "!mulai\nNomor Registrasi: 2026/88\nNama Pelanggan: Sari\nAlamat: Medan",
  );
  assert.equal(result.registrationNumber, "2026/88");
  assert.equal(result.customerName, "Sari");
});

test("parseAttachmentSlot menerima label foto yang disepakati", () => {
  assert.equal(parseAttachmentSlot("#ba"), "berita_acara");
  assert.equal(parseAttachmentSlot("#ISO catatan"), "isometris");
  assert.equal(parseAttachmentSlot("dokumentasi 3"), undefined);
  assert.equal(parseAttachmentSlot("#dokumentasi3"), "dokumentasi_3");
  assert.equal(parseAttachmentSlot("dok4"), "dokumentasi_4");
});

test("parseStartCommand menolak data yang tidak lengkap", () => {
  assert.throws(
    () => parseStartCommand("!mulai\nnoreg: REG-1\nnama: Budi"),
    /Format belum lengkap/,
  );
});

test("extractSentenceReport ignores conversational chat messages and false positives", () => {
  assert.equal(extractSentenceReport("i have 2"), undefined);
  assert.equal(extractSentenceReport("Anjay"), undefined);
  assert.equal(extractSentenceReport("masih pake gdrive"), undefined);
  assert.equal(extractSentenceReport("ga direct gsheet"), undefined);
  assert.equal(extractSentenceReport("mau gini aja atau gsheet only?"), undefined);
  assert.equal(extractSentenceReport("saya punya 1"), undefined);
  assert.equal(extractSentenceReport("halo test 12"), undefined);
  assert.equal(extractSentenceReport("ada 2 foto"), undefined);
});
