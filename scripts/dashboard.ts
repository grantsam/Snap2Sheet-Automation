import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { URL } from "node:url";
import { exec } from "node:child_process";
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

const DASHBOARD_PORT = 3500;
let botProcess: ChildProcess | null = null;
let botLogs: string[] = [];
let botRunning = false;
let botProjectName = "";
let botMode = "";
let currentQRCode: string | null = null;

interface BotNotification {
  id: string;
  type: "success" | "info" | "warn" | "error";
  title: string;
  message: string;
  timestamp: string;
  noreg?: string;
  nama?: string;
  read: boolean;
}

const botNotifications: BotNotification[] = [];

// SSE clients for live log streaming
const sseClients: Set<http.ServerResponse> = new Set();

function broadcastCustomEvent(event: string, data: string): void {
  for (const client of sseClients) {
    try {
      client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function broadcastLog(line: string): void {
  // Check if log contains QR code
  if (line.includes('"qr":')) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.qr) {
        currentQRCode = parsed.qr;
        broadcastCustomEvent("qr", parsed.qr);
      }
    } catch {
      const match = line.match(/"qr":"([^"]+)"/);
      if (match?.[1]) {
        currentQRCode = match[1];
        broadcastCustomEvent("qr", match[1]);
      }
    }
  }

  if (line.includes("Sesi WhatsApp berhasil diautentikasi") || line.includes("WhatsApp client siap")) {
    currentQRCode = null;
    broadcastCustomEvent("authenticated", "ok");
  }

  // Rich Notification Processing
  try {
    let parsed: any = null;
    try { parsed = JSON.parse(line); } catch {}
    const msgText = parsed?.message || line;

    if (msgText.includes("tersimpan di Google Sheets") || msgText.includes("Laporan 6 foto lengkap") || (parsed?.noreg && msgText.includes("Laporan"))) {
      const notif: BotNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "success",
        title: parsed?.noreg ? `Laporan Selesai: ${parsed.noreg} (${parsed.nama || ""})` : "Laporan Selesai & Tersimpan",
        message: msgText,
        noreg: parsed?.noreg,
        nama: parsed?.nama,
        timestamp: new Date().toISOString(),
        read: false,
      };
      botNotifications.unshift(notif);
      if (botNotifications.length > 200) botNotifications.pop();
      broadcastCustomEvent("bot_notification", JSON.stringify(notif));
    } else if (msgText.includes("Mulai draft laporan baru:") || (parsed?.noreg && parsed?.pengirim)) {
      const notif: BotNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "info",
        title: `Draft Baru: ${parsed?.noreg || ""} ${parsed?.nama || ""}`,
        message: `Pengirim: ${parsed?.pengirim || "WhatsApp"}`,
        noreg: parsed?.noreg,
        nama: parsed?.nama,
        timestamp: new Date().toISOString(),
        read: false,
      };
      botNotifications.unshift(notif);
      if (botNotifications.length > 200) botNotifications.pop();
      broadcastCustomEvent("bot_notification", JSON.stringify(notif));
    } else if (msgText.includes("Sinkronisasi riwayat selesai") || msgText.includes("Sinkronisasi Selesai")) {
      const notif: BotNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "info",
        title: "Sinkronisasi Riwayat Chat Selesai",
        message: msgText,
        timestamp: new Date().toISOString(),
        read: false,
      };
      botNotifications.unshift(notif);
      if (botNotifications.length > 200) botNotifications.pop();
      broadcastCustomEvent("bot_notification", JSON.stringify(notif));
    } else if (msgText.includes("sudah ada di Google Sheets, dilewati") || msgText.includes("dilewati")) {
      const notif: BotNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "warn",
        title: "Laporan Dilewati (Sudah Tercatat)",
        message: msgText,
        timestamp: new Date().toISOString(),
        read: false,
      };
      botNotifications.unshift(notif);
      if (botNotifications.length > 200) botNotifications.pop();
      broadcastCustomEvent("bot_notification", JSON.stringify(notif));
    } else if (msgText.includes("❌") || parsed?.level === "error") {
      const notif: BotNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: "error",
        title: "Peringatan / Error Bot",
        message: msgText,
        timestamp: new Date().toISOString(),
        read: false,
      };
      botNotifications.unshift(notif);
      if (botNotifications.length > 200) botNotifications.pop();
      broadcastCustomEvent("bot_notification", JSON.stringify(notif));
    }
  } catch {}

  // Filter out terminal ASCII block lines so they don't break console layout
  const isTerminalAsciiQR = /[\u2580-\u259F]{4,}/.test(line) || /^\s*(\u2588|\u2584|\u2580)+\s*$/.test(line);
  if (isTerminalAsciiQR) {
    return;
  }

  botLogs.push(line);
  if (botLogs.length > 500) botLogs.shift();
  for (const client of sseClients) {
    try {
      client.write(`data: ${JSON.stringify(line)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function openBrowser(url: string): void {
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec(`taskkill /PID ${pid} /T /F`, () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
      resolve();
    }
  });
}

async function validateProject(profile: ProjectProfile): Promise<{ ok: boolean; messages: string[] }> {
  const messages: string[] = [];
  try {
    const config = projectToAppConfig(profile);
    const drive = new DriveRepository(config);
    const sheets = new SheetRepository(config);

    const folderInfo = await drive.verifyRootFolder();
    messages.push(`✅ Drive folder: "${folderInfo.name}" (${folderInfo.sharedDrive ? "Shared Drive" : "My Drive"})`);

    await sheets.ensureHeader();
    messages.push(`✅ Spreadsheet: Worksheet "${config.sheetName}" connected & headers ready.`);

    return { ok: true, messages };
  } catch (err: any) {
    messages.push(`❌ ${err.message || String(err)}`);
    return { ok: false, messages };
  }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function serveUI(res: http.ServerResponse): void {
  const htmlPath = path.resolve(__dirname, "..", "ui", "dashboard.html");
  if (!fs.existsSync(htmlPath)) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("dashboard.html not found at " + htmlPath);
    return;
  }
  const html = fs.readFileSync(htmlPath, "utf-8");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// ── OAuth flow state ──
let pendingOAuthResolve: ((token: string) => void) | null = null;
let pendingOAuthReject: ((err: Error) => void) | null = null;
let oauthServer: http.Server | null = null;

async function startOAuthFlow(clientId: string, clientSecret: string): Promise<string> {
  const redirectUri = "http://localhost:3001/oauth2callback";
  const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const authUrl = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
  });

  return new Promise((resolve, reject) => {
    pendingOAuthResolve = resolve;
    pendingOAuthReject = reject;

    if (oauthServer) {
      try { oauthServer.close(); } catch { /* ignore */ }
    }

    oauthServer = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      if (error || !code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="background:#1a1a2e;color:#e94560;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>❌ OAuth Failed: ${error ?? "No code"}</h1></body></html>`);
        oauthServer?.close();
        reject(new Error(error ?? "No code"));
        return;
      }
      try {
        const result = await oauth.getToken(code);
        const token = result.tokens.refresh_token;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="background:#1a1a2e;color:#00d2d3;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column"><h1>✅ Google Authorization Complete!</h1><p>You can close this tab now.</p></body></html>`);
        oauthServer?.close();
        if (token) resolve(token);
        else reject(new Error("No refresh token returned. Revoke access and retry."));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="background:#1a1a2e;color:#e94560;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>❌ Token Exchange Failed</h1></body></html>`);
        oauthServer?.close();
        reject(err);
      }
    });

    oauthServer.listen(3001, "localhost", () => {
      openBrowser(authUrl);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${DASHBOARD_PORT}`);
  const method = req.method ?? "GET";

  // CORS
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // ── UI ──
  if (method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    return serveUI(res);
  }

  // ── API: List projects ──
  if (method === "GET" && url.pathname === "/api/projects") {
    return json(res, listProjects());
  }

  // ── API: Get single project ──
  if (method === "GET" && url.pathname.startsWith("/api/projects/")) {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      return json(res, loadProject(name));
    } catch (err: any) {
      return json(res, { error: err.message }, 404);
    }
  }

  // ── API: Save project ──
  if (method === "POST" && url.pathname === "/api/projects") {
    try {
      const body = JSON.parse(await readBody(req)) as ProjectProfile;
      saveProject(body);
      return json(res, { ok: true, name: sanitizeProjectName(body.name) });
    } catch (err: any) {
      return json(res, { error: err.message }, 400);
    }
  }

  // ── API: Update project ──
  if (method === "PUT" && url.pathname.startsWith("/api/projects/")) {
    try {
      const body = JSON.parse(await readBody(req)) as ProjectProfile;
      saveProject(body);
      return json(res, { ok: true, name: sanitizeProjectName(body.name) });
    } catch (err: any) {
      return json(res, { error: err.message }, 400);
    }
  }

  // ── API: Delete project ──
  if (method === "DELETE" && url.pathname.startsWith("/api/projects/")) {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    const deleted = deleteProject(name);
    return json(res, { ok: deleted });
  }

  // ── API: Validate project ──
  if (method === "POST" && url.pathname.startsWith("/api/projects/") && url.pathname.endsWith("/validate")) {
    const name = decodeURIComponent(url.pathname.split("/")[3] ?? "");
    try {
      const profile = loadProject(name);
      const result = await validateProject(profile);
      return json(res, result);
    } catch (err: any) {
      return json(res, { ok: false, messages: [err.message] }, 400);
    }
  }

  // ── API: Validate arbitrary profile ──
  if (method === "POST" && url.pathname === "/api/validate") {
    try {
      const body = JSON.parse(await readBody(req)) as ProjectProfile;
      const result = await validateProject(body);
      return json(res, result);
    } catch (err: any) {
      return json(res, { ok: false, messages: [err.message] }, 400);
    }
  }

  // ── API: Extract IDs from URLs ──
  if (method === "POST" && url.pathname === "/api/extract-ids") {
    try {
      const body = JSON.parse(await readBody(req));
      return json(res, {
        spreadsheetId: body.sheetUrl ? extractSpreadsheetId(body.sheetUrl) : "",
        driveFolderId: body.driveUrl ? extractDriveFolderId(body.driveUrl) : "",
      });
    } catch (err: any) {
      return json(res, { error: err.message }, 400);
    }
  }

  // ── API: Start OAuth ──
  if (method === "POST" && url.pathname === "/api/oauth/start") {
    try {
      const body = JSON.parse(await readBody(req));
      const token = await startOAuthFlow(body.clientId, body.clientSecret);
      return json(res, { ok: true, refreshToken: token });
    } catch (err: any) {
      return json(res, { ok: false, error: err.message }, 400);
    }
  }

  // ── API: Start bot ──
  if (method === "POST" && url.pathname === "/api/bot/start") {
    if (botRunning && botProcess) {
      return json(res, { error: "Bot is already running." }, 409);
    }

    try {
      if (botProcess && botProcess.pid) {
        await killProcessTree(botProcess.pid);
        botProcess = null;
      }

      const body = JSON.parse((await readBody(req)) || "{}") as {
        project?: string;
        mode?: string;
        limit?: number;
      };
      const projectName = body.project || "";
      const mode = body.mode || "sync";
      const limit = body.limit || 500;

      botLogs = [];
      botProjectName = projectName || ".env (default)";
      botMode = mode;

      const args = ["tsx", "src/index.ts", `--mode=${mode}`, `--limit=${limit}`];
      if (projectName) args.push(`--project=${projectName}`);

      broadcastLog(`[Dashboard] Starting bot — project: ${botProjectName}, mode: ${mode}`);

      botProcess = spawn("npx", args, {
        cwd: path.resolve(__dirname, ".."),
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      botRunning = true;

      botProcess.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString("utf-8").split("\n").filter(Boolean);
        for (const line of lines) broadcastLog(line);
      });

      botProcess.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString("utf-8").split("\n").filter(Boolean);
        for (const line of lines) broadcastLog(`[stderr] ${line}`);
      });

      botProcess.on("exit", (code) => {
        botRunning = false;
        broadcastLog(`[Dashboard] Bot exited with code ${code}`);
        botProcess = null;
      });

      return json(res, { ok: true, project: botProjectName, mode });
    } catch (err: any) {
      return json(res, { error: err.message }, 500);
    }
  }

  // ── API: Stop bot ──
  if (method === "POST" && url.pathname === "/api/bot/stop") {
    if (!botProcess && !botRunning) {
      return json(res, { error: "Bot is not running." }, 409);
    }
    broadcastLog("[Dashboard] Stopping bot and closing browser...");
    if (botProcess && botProcess.pid) {
      await killProcessTree(botProcess.pid);
    }
    botRunning = false;
    botProcess = null;
    return json(res, { ok: true });
  }

  // ── API: Bot status ──
  if (method === "GET" && url.pathname === "/api/bot/status") {
    return json(res, {
      running: botRunning,
      project: botProjectName,
      mode: botMode,
      logCount: botLogs.length,
      hasQr: Boolean(currentQRCode),
    });
  }

  // ── API: Bot QR code ──
  if (method === "GET" && url.pathname === "/api/bot/qr") {
    return json(res, { qr: currentQRCode });
  }

  // ── API: Notifications List ──
  if (method === "GET" && url.pathname === "/api/notifications") {
    return json(res, {
      notifications: botNotifications,
      unreadCount: botNotifications.filter(n => !n.read).length,
    });
  }

  // ── API: Mark Notifications Read ──
  if (method === "POST" && url.pathname === "/api/notifications/read-all") {
    botNotifications.forEach(n => n.read = true);
    return json(res, { ok: true });
  }

  // ── API: Clear Notifications ──
  if (method === "DELETE" && url.pathname === "/api/notifications") {
    botNotifications.length = 0;
    return json(res, { ok: true });
  }

  // ── SSE: Live logs ──
  if (method === "GET" && url.pathname === "/api/bot/logs") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    // Send existing logs
    for (const line of botLogs) {
      res.write(`data: ${JSON.stringify(line)}\n\n`);
    }

    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  // ── 404 ──
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(DASHBOARD_PORT, "localhost", () => {
  const url = `http://localhost:${DASHBOARD_PORT}`;
  console.log(`\n  ┌─────────────────────────────────────────────┐`);
  console.log(`  │   Snap2Sheet Dashboard aktif di:             │`);
  console.log(`  │   ${url}                      │`);
  console.log(`  │   Tekan Ctrl+C untuk menutup.                │`);
  console.log(`  └─────────────────────────────────────────────┘\n`);
  openBrowser(url);
});
