import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import readline from "node:readline/promises";
import { google } from "googleapis";
import {
  deleteProject,
  extractDriveFolderId,
  extractSpreadsheetId,
  listProjects,
  loadProject,
  type ProjectProfile,
  projectToAppConfig,
  sanitizeProjectName,
  saveProject,
} from "../src/project-loader";
import { DriveRepository } from "../src/drive-repository";
import { SheetRepository } from "../src/sheet-repository";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function openBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    exec(`start "" "${url}"`);
  } else if (platform === "darwin") {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

async function obtainOAuthRefreshToken(
  clientId: string,
  clientSecret: string,
  redirectUri = "http://localhost:3001/oauth2callback",
): Promise<string> {
  const redirect = new URL(redirectUri);
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const scopes = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ];
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });

  const port = Number(redirect.port || 3001);

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      try {
        const current = new URL(request.url ?? "/", redirectUri);
        if (current.pathname !== redirect.pathname) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const code = current.searchParams.get("code");
        const oauthError = current.searchParams.get("error");
        if (oauthError || !code) {
          response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          response.end(`<h2>OAuth Gagal</h2><p>${oauthError ?? "Kode otorisasi tidak ditemukan."}</p>`);
          server.close();
          reject(new Error(`OAuth Gagal: ${oauthError ?? "No code"}`));
          return;
        }

        const result = await oauth.getToken(code);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`
          <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #2e7d32;">✅ Otorisasi Google Berhasil!</h1>
            <p>Token berhasil ditangkap. Silakan tutup tab ini dan kembali ke terminal.</p>
          </div>
        `);
        server.close();
        const token = result.tokens.refresh_token;
        if (!token) {
          reject(new Error("Google tidak mengembalikan refresh token baru. Coba revoke akses atau pastikan prompt=consent."));
        } else {
          resolve(token);
        }
      } catch (err) {
        response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        response.end("<h2>Gagal menukar token.</h2>");
        server.close();
        reject(err);
      }
    });

    server.listen(port, redirect.hostname, () => {
      console.log("\n🌐 Membuka Google Login di browser...");
      console.log(`🔗 Link manual (jika browser tidak otomatis terbuka):\n${authUrl}\n`);
      openBrowser(authUrl);
    });
  });
}

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (default: ${defaultValue}): ` : ": ";
  const answer = await rl.question(`${question}${suffix}`);
  const trimmed = answer.trim();
  return trimmed || defaultValue || "";
}

async function validateAndTestProject(profile: ProjectProfile): Promise<boolean> {
  console.log("\n⏳ Sedang memverifikasi koneksi Google Sheets dan Drive...");
  try {
    const config = projectToAppConfig(profile);
    const drive = new DriveRepository(config);
    const sheets = new SheetRepository(config);

    const folderInfo = await drive.verifyRootFolder();
    console.log(`   ✅ Folder Drive: "${folderInfo.name}" (${folderInfo.sharedDrive ? "Shared Drive" : "My Drive"})`);

    await sheets.ensureHeader();
    console.log(`   ✅ Spreadsheet: Worksheet "${config.sheetName}" terhubung & header siap.`);

    return true;
  } catch (err: any) {
    console.log(`\n❌ Verifikasi Gagal: ${err.message || String(err)}`);
    return false;
  }
}

async function createOrEditProjectWizard(existingProfile?: ProjectProfile): Promise<void> {
  const isEdit = Boolean(existingProfile);
  console.log("\n" + "=".repeat(60));
  console.log(`         ${isEdit ? "EDIT PROYEK" : "SETUP PROYEK BARU"}`);
  console.log("=".repeat(60));

  // 1. Nama Proyek
  let name = existingProfile?.name || "";
  if (!isEdit) {
    while (!name) {
      const input = await prompt("1. Nama unik proyek (contoh: proyek-pipa-2026, proyek-b)");
      name = sanitizeProjectName(input);
      if (!name) {
        console.log("   ⚠️ Nama proyek tidak boleh kosong.");
      }
    }
  } else {
    console.log(`Nama Proyek: ${name}`);
  }

  const description = await prompt("   Deskripsi singkat proyek", existingProfile?.description || "");

  // 2. Google Auth Mode
  console.log("\n2. Mode Autentikasi Google:");
  console.log("   [1] OAuth 2.0 (Disarankan untuk My Drive / Akun Google Pribadi)");
  console.log("   [2] Service Account (Khusus Google Workspace Shared Drive)");
  const authChoice = await prompt("   Pilih mode (1/2)", existingProfile?.googleAuthMode === "service_account" ? "2" : "1");
  const googleAuthMode = authChoice === "2" ? "service_account" : "oauth";

  let googleClientId = existingProfile?.googleClientId || process.env.GOOGLE_CLIENT_ID || "";
  let googleClientSecret = existingProfile?.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET || "";
  let googleRefreshToken = existingProfile?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN || "";
  let googleServiceAccountJson = existingProfile?.googleServiceAccountJson || process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";

  if (googleAuthMode === "oauth") {
    googleClientId = await prompt("   GOOGLE_CLIENT_ID", googleClientId);
    googleClientSecret = await prompt("   GOOGLE_CLIENT_SECRET", googleClientSecret);

    if (googleRefreshToken) {
      console.log("   Ditemukan Refresh Token yang sudah tersimpan.");
      const reuse = await prompt("   Gunakan token ini? (y/n)", "y");
      if (reuse.toLowerCase() !== "y") {
        googleRefreshToken = "";
      }
    }

    if (!googleRefreshToken) {
      console.log("\n🔑 Melakukan login Google otomatis untuk mendapatkan Refresh Token...");
      try {
        googleRefreshToken = await obtainOAuthRefreshToken(googleClientId, googleClientSecret);
        console.log("   ✅ Refresh Token berhasil didapatkan!");
      } catch (err: any) {
        console.log(`   ❌ Gagal mendapatkan token: ${err.message || String(err)}`);
        const manual = await prompt("   Masukkan REFRESH_TOKEN manual jika ada (atau tekan Enter untuk batal)");
        if (manual) {
          googleRefreshToken = manual;
        } else {
          console.log("   ⚠️ Setup dibatalkan.");
          return;
        }
      }
    }
  } else {
    googleServiceAccountJson = await prompt("   Path ke file JSON Service Account", googleServiceAccountJson || "./credentials/service-account.json");
  }

  // 3. Google Sheets
  console.log("\n3. Konfigurasi Google Sheets:");
  console.log("   (Bisa paste URL lengkap atau hanya ID Spreadsheet)");
  let rawSheet = await prompt("   URL / ID Google Spreadsheet", existingProfile?.spreadsheetId || process.env.GOOGLE_SPREADSHEET_ID || "");
  const spreadsheetId = extractSpreadsheetId(rawSheet);
  const sheetName = await prompt("   Nama Worksheet/Tab (misal: Sheet1, Data)", existingProfile?.sheetName || process.env.GOOGLE_SHEET_NAME || "Sheet1");

  // 4. Google Drive
  console.log("\n4. Konfigurasi Google Drive:");
  console.log("   (Bisa paste URL folder Drive atau hanya ID Folder)");
  let rawDrive = await prompt("   URL / ID Folder Google Drive", existingProfile?.driveFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID || "");
  const driveFolderId = extractDriveFolderId(rawDrive);

  // 5. WhatsApp Target Group
  console.log("\n5. Target Grup WhatsApp (Opsional):");
  console.log("   (Bisa dikosongkan dulu, lalu jalankan !idgrup di grup WA saat bot aktif)");
  const targetGroupName = await prompt("   Nama Grup WhatsApp (TARGET_GROUP_NAME)", existingProfile?.targetGroupName || process.env.TARGET_GROUP_NAME || "");
  const targetGroupId = await prompt("   ID Grup WhatsApp (TARGET_GROUP_ID)", existingProfile?.targetGroupId || process.env.TARGET_GROUP_ID || "");

  const profile: ProjectProfile = {
    name,
    createdAt: existingProfile?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    googleAuthMode,
    spreadsheetId,
    sheetName,
    driveFolderId,
    timezone: existingProfile?.timezone || "Asia/Jakarta",
    maxMediaMb: existingProfile?.maxMediaMb || 20,
    duplicateScope: existingProfile?.duplicateScope || "day",
    waAuthPath: existingProfile?.waAuthPath || `./data/wwebjs-auth-${name}`,
    stateFilePath: existingProfile?.stateFilePath || `./data/state-${name}.json`,
    ...(description ? { description } : {}),
    ...(targetGroupName ? { targetGroupName } : {}),
    ...(targetGroupId ? { targetGroupId } : {}),
    ...(googleAuthMode === "oauth" && googleClientId ? { googleClientId } : {}),
    ...(googleAuthMode === "oauth" && googleClientSecret ? { googleClientSecret } : {}),
    ...(googleAuthMode === "oauth" && googleRefreshToken ? { googleRefreshToken } : {}),
    ...(googleAuthMode === "service_account" && googleServiceAccountJson
      ? { googleServiceAccountJson }
      : {}),
  };

  const isOk = await validateAndTestProject(profile);
  if (!isOk) {
    const saveAnyway = await prompt("\n⚠️ Verifikasi gagal. Tetap simpan profil ini? (y/n)", "n");
    if (saveAnyway.toLowerCase() !== "y") {
      console.log("❌ Profil tidak disimpan.");
      return;
    }
  }

  saveProject(profile);
  console.log("\n" + "=".repeat(60));
  console.log(`✅ Profil proyek "${name}" berhasil disimpan ke projects/${name}.json!`);
  console.log("=".repeat(60));
}

async function listAllProjectsWizard(): Promise<void> {
  const projects = listProjects();
  console.log("\n" + "=".repeat(60));
  console.log(`             DAFTAR PROYEK TERSEDIA (${projects.length})`);
  console.log("=".repeat(60));

  if (projects.length === 0) {
    console.log("  (Belum ada profil proyek tersimpan. Pilih [1] untuk membuat)");
    return;
  }

  projects.forEach((p, idx) => {
    console.log(`[${idx + 1}] ${p.name.padEnd(20)} | Tab: ${p.sheetName.padEnd(10)} | Grup: ${p.targetGroupName || p.targetGroupId || "(Belum di-set)"}`);
    if (p.description) {
      console.log(`    ↳ ${p.description}`);
    }
  });
}

async function deleteProjectWizard(): Promise<void> {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("\n⚠️ Belum ada proyek untuk dihapus.");
    return;
  }

  await listAllProjectsWizard();
  const choice = await prompt("\nPilih nomor proyek yang ingin dihapus (atau 0 untuk batal)");
  const idx = Number(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    console.log("Batal.");
    return;
  }

  const target = projects[idx];
  if (!target) return;
  const confirm = await prompt(`Apakah Anda yakin ingin menghapus proyek "${target.name}"? (y/n)`, "n");
  if (confirm.toLowerCase() === "y") {
    deleteProject(target.name);
    console.log(`✅ Proyek "${target.name}" berhasil dihapus.`);
  }
}

async function editProjectWizard(): Promise<void> {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("\n⚠️ Belum ada proyek tersimpan. Silakan buat baru.");
    return;
  }

  await listAllProjectsWizard();
  const choice = await prompt("\nPilih nomor proyek yang ingin diedit (atau 0 untuk batal)");
  const idx = Number(choice) - 1;
  if (isNaN(idx) || idx < 0 || idx >= projects.length) {
    console.log("Batal.");
    return;
  }

  const target = projects[idx];
  if (!target) return;
  const profile = loadProject(target.name);
  await createOrEditProjectWizard(profile);
}

async function main(): Promise<void> {
  while (true) {
    console.log("\n" + "=".repeat(60));
    console.log("       Snap2Sheet — Setup Wizard & Multi-Project Manager");
    console.log("=".repeat(60));
    console.log("[1] Buat Setup Proyek Baru");
    console.log("[2] Edit Proyek yang Ada");
    console.log("[3] Hapus Proyek");
    console.log("[4] Daftar Semua Proyek & Uji Koneksi");
    console.log("[0] Keluar");
    console.log("=".repeat(60));

    const choice = await prompt("Pilih menu (0-4)");

    if (choice === "1") {
      await createOrEditProjectWizard();
    } else if (choice === "2") {
      await editProjectWizard();
    } else if (choice === "3") {
      await deleteProjectWizard();
    } else if (choice === "4") {
      await listAllProjectsWizard();
      const testChoice = await prompt("\nIngin menguji koneksi salah satu proyek? (masukkan nama proyek atau Enter untuk lewati)");
      if (testChoice) {
        try {
          const profile = loadProject(testChoice);
          await validateAndTestProject(profile);
        } catch (err: any) {
          console.log(`❌ Gagal: ${err.message || String(err)}`);
        }
      }
    } else if (choice === "0") {
      console.log("\nSampai jumpa! Jalankan START_BOT.bat untuk memulai bot.");
      break;
    }
  }

  rl.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("\n❌ Terjadi kesalahan pada wizard:", error);
  rl.close();
  process.exit(1);
});
