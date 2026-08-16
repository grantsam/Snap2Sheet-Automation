import type { AttachmentSlot, StartPayload } from "./types";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanText(value: string, field: string, maxLength: number): string {
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) throw new InputError(`${field} tidak boleh kosong.`);
  if (cleaned.length > maxLength) throw new InputError(`${field} maksimal ${maxLength} karakter.`);
  return cleaned;
}

const CHAT_STOPWORDS = new Set([
  "i have",
  "i have 2",
  "i want",
  "we have",
  "do you",
  "can you",
  "please",
  "ada",
  "saya",
  "punya",
  "kamu",
  "dia",
  "mereka",
  "kita",
  "bisa",
  "tolong",
  "halo",
  "test",
  "testing",
  "siang",
  "pagi",
  "malam",
  "sore",
  "siap",
  "kirim",
  "terima",
  "kasih",
  "makasih",
  "ok",
  "oke",
  "yes",
  "no",
  "anjay",
  "anjir",
  "grup",
  "group",
  "bot",
  "admin",
  "foto",
  "gambar",
  "sudah",
  "belum",
  "masih",
  "lagi",
  "ini",
  "itu",
  "maksud",
]);

function isValidNoreg(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 30) return false;
  const digits = trimmed.match(/\d/g);
  if (!digits || digits.length < 3) return false;
  return /^[A-Za-z0-9\-_/]+$/.test(trimmed);
}

function isValidCustomerName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 100) return false;
  if (/\d/.test(trimmed)) return false;
  if (!/^[A-Za-z\s.'`’\-]+$/.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (CHAT_STOPWORDS.has(lower)) return false;
  for (const sw of CHAT_STOPWORDS) {
    if (lower.startsWith(sw + " ")) return false;
  }
  return true;
}

export function extractSentenceReport(text: string): StartPayload | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;

  // 1. Bracketed or prefixed format: ( 3862 sri Maryati ) or minz ( ... )
  const bracketMatch = cleaned.match(
    /(?:(?:0000\s*)?minz\s*)?\(\s*([A-Za-z0-9\-_/]{3,30})\s*[-–—,]?\s+([^)\r\n]{3,120})\)/i,
  );
  if (bracketMatch && bracketMatch[1] && bracketMatch[2]) {
    const p1 = bracketMatch[1].trim();
    const p2 = bracketMatch[2].trim();
    if (isValidNoreg(p1) && isValidCustomerName(p2)) {
      return {
        registrationNumber: cleanText(p1, "Nomor registrasi", 80),
        customerName: cleanText(p2, "Nama pelanggan", 160),
        address: "-",
      };
    } else if (isValidCustomerName(p1) && isValidNoreg(p2)) {
      return {
        registrationNumber: cleanText(p2, "Nomor registrasi", 80),
        customerName: cleanText(p1, "Nama pelanggan", 160),
        address: "-",
      };
    }
  }

  // 2. Format A: Number first -> "3862 sri Maryati", "4894 robiah", "REG-01 Budi Santoso"
  const numFirstMatch = cleaned.match(
    /^([A-Za-z0-9\-_/]{3,30})\s*[-–—,:]?\s+([A-Za-z\s.'`’\-]{3,120})$/,
  );
  if (numFirstMatch && numFirstMatch[1] && numFirstMatch[2]) {
    const p1 = numFirstMatch[1].trim();
    const p2 = numFirstMatch[2].trim();
    if (isValidNoreg(p1) && isValidCustomerName(p2)) {
      return {
        registrationNumber: cleanText(p1, "Nomor registrasi", 80),
        customerName: cleanText(p2, "Nama pelanggan", 160),
        address: "-",
      };
    }
  }

  // 3. Format B: Name first -> "Samina 4469", "Sri Maryati - 3862", "M. Syahputra 1234"
  const nameFirstMatch = cleaned.match(
    /^([A-Za-z\s.'`’\-]{3,120})\s*[-–—,:]?\s+([A-Za-z0-9\-_/]{3,30})$/,
  );
  if (nameFirstMatch && nameFirstMatch[1] && nameFirstMatch[2]) {
    const p1 = nameFirstMatch[1].trim();
    const p2 = nameFirstMatch[2].trim();
    if (isValidCustomerName(p1) && isValidNoreg(p2)) {
      return {
        registrationNumber: cleanText(p2, "Nomor registrasi", 80),
        customerName: cleanText(p1, "Nama pelanggan", 160),
        address: "-",
      };
    }
  }

  return undefined;
}

export function parseStartCommand(body: string, prefix = "!"): StartPayload {
  const lines = body.replace(/\r/g, "").split("\n");
  if (lines[0]?.trim().toLowerCase() !== `${prefix}mulai`.toLowerCase()) {
    throw new InputError(`Baris pertama harus ${prefix}mulai.`);
  }

  const values = new Map<string, string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    values.set(normalizedKey(line.slice(0, separator)), line.slice(separator + 1).trim());
  }

  const registrationNumber =
    values.get("noreg") ?? values.get("nomorregistrasi") ?? values.get("nomorreg");
  const customerName = values.get("nama") ?? values.get("namapelanggan");
  const address = values.get("alamat");

  if (!registrationNumber || !customerName || !address) {
    throw new InputError(
      `Format belum lengkap. Gunakan:\n${prefix}mulai\nnoreg: ...\nnama: ...\nalamat: ...`,
    );
  }

  return {
    registrationNumber: cleanText(registrationNumber, "Nomor registrasi", 80),
    customerName: cleanText(customerName, "Nama pelanggan", 160),
    address: cleanText(address, "Alamat", 500),
  };
}

const slotAliases: Record<string, AttachmentSlot> = {
  ba: "berita_acara",
  beritaacara: "berita_acara",
  iso: "isometris",
  isometris: "isometris",
  dok1: "dokumentasi_1",
  doc1: "dokumentasi_1",
  dokumentasi1: "dokumentasi_1",
  dok2: "dokumentasi_2",
  doc2: "dokumentasi_2",
  dokumentasi2: "dokumentasi_2",
  dok3: "dokumentasi_3",
  doc3: "dokumentasi_3",
  dokumentasi3: "dokumentasi_3",
  dok4: "dokumentasi_4",
  doc4: "dokumentasi_4",
  dokumentasi4: "dokumentasi_4",
};

export function parseAttachmentSlot(value: string): AttachmentSlot | undefined {
  const firstToken = value.trim().split(/\s+/)[0] ?? "";
  return slotAliases[normalizedKey(firstToken.replace(/^#/, ""))];
}

export function attachmentSlotLabel(slot: AttachmentSlot): string {
  const labels: Record<AttachmentSlot, string> = {
    berita_acara: "Berita Acara",
    isometris: "Isometris",
    dokumentasi_1: "Dokumentasi 1",
    dokumentasi_2: "Dokumentasi 2",
    dokumentasi_3: "Dokumentasi 3",
    dokumentasi_4: "Dokumentasi 4",
  };
  return labels[slot];
}
