import fs from "node:fs";
import path from "node:path";
import type { AppConfig, GoogleAuthMode } from "./config";
import type { DuplicateScope } from "./types";

export interface ProjectProfile {
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;

  // WhatsApp configuration
  targetGroupName?: string;
  targetGroupId?: string;
  notifyTargetId?: string;
  allowedSenders?: string[];
  commandPrefix?: string;

  // Google Authentication
  googleAuthMode: GoogleAuthMode;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleOAuthRedirectUri?: string;
  googleServiceAccountJson?: string;

  // Google Sheets & Drive
  spreadsheetId: string;
  sheetName: string;
  driveFolderId: string;

  // Operational settings
  timezone?: string;
  maxMediaMb?: number;
  duplicateScope?: DuplicateScope;
  waAuthPath?: string;
  stateFilePath?: string;
  port?: number;
  logLevel?: "debug" | "info" | "warn" | "error";
}

export interface ProjectSummary {
  name: string;
  description?: string;
  sheetName: string;
  spreadsheetId: string;
  driveFolderId: string;
  targetGroupName?: string;
  targetGroupId?: string;
  updatedAt: string;
}

export function getProjectsDir(customDir?: string): string {
  const dir = customDir || path.resolve(process.cwd(), "projects");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
}

export function extractDriveFolderId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (match?.[1]) return match[1];
  return trimmed;
}

export function sanitizeProjectName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function listProjects(customDir?: string): ProjectSummary[] {
  const dir = getProjectsDir(customDir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const summaries: ProjectSummary[] = [];

  for (const file of files) {
    try {
      const fullPath = path.join(dir, file);
      const content = fs.readFileSync(fullPath, "utf-8");
      const profile = JSON.parse(content) as ProjectProfile;
      const summary: ProjectSummary = {
        name: profile.name || path.basename(file, ".json"),
        sheetName: profile.sheetName || "Data",
        spreadsheetId: profile.spreadsheetId || "",
        driveFolderId: profile.driveFolderId || "",
        updatedAt: profile.updatedAt || new Date().toISOString(),
        ...(profile.description ? { description: profile.description } : {}),
        ...(profile.targetGroupName ? { targetGroupName: profile.targetGroupName } : {}),
        ...(profile.targetGroupId ? { targetGroupId: profile.targetGroupId } : {}),
      };
      summaries.push(summary);
    } catch {
      // Skip corrupt files
    }
  }

  return summaries.sort((a, b) => a.name.localeCompare(b.name));
}

export function loadProject(name: string, customDir?: string): ProjectProfile {
  const dir = getProjectsDir(customDir);
  const cleanName = sanitizeProjectName(name);
  const filePath = path.join(dir, `${cleanName}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Profil proyek '${cleanName}' tidak ditemukan di ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(content) as ProjectProfile;
}

export function saveProject(profile: ProjectProfile, customDir?: string): void {
  const dir = getProjectsDir(customDir);
  const cleanName = sanitizeProjectName(profile.name);
  profile.name = cleanName;
  profile.updatedAt = new Date().toISOString();
  if (!profile.createdAt) {
    profile.createdAt = profile.updatedAt;
  }

  const filePath = path.join(dir, `${cleanName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf-8");
}

export function deleteProject(name: string, customDir?: string): boolean {
  const dir = getProjectsDir(customDir);
  const cleanName = sanitizeProjectName(name);
  const filePath = path.join(dir, `${cleanName}.json`);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

export function projectToAppConfig(profile: ProjectProfile): AppConfig {
  const cleanName = sanitizeProjectName(profile.name);
  const googleAuthMode = profile.googleAuthMode || "oauth";

  if (googleAuthMode === "oauth") {
    if (!profile.googleClientId || !profile.googleClientSecret || !profile.googleRefreshToken) {
      throw new Error(
        `Profil proyek '${profile.name}' belum lengkap. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN wajib diisi.`,
      );
    }
  } else if (googleAuthMode === "service_account") {
    if (!profile.googleServiceAccountJson) {
      throw new Error(
        `Profil proyek '${profile.name}' belum lengkap. GOOGLE_SERVICE_ACCOUNT_JSON wajib diisi.`,
      );
    }
  }

  if (!profile.spreadsheetId) {
    throw new Error(`Profil proyek '${profile.name}' belum memiliki GOOGLE_SPREADSHEET_ID.`);
  }
  if (!profile.driveFolderId) {
    throw new Error(`Profil proyek '${profile.name}' belum memiliki GOOGLE_DRIVE_FOLDER_ID.`);
  }

  const allowedSenders = new Set(
    (profile.allowedSenders || [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  const maxMediaMb = profile.maxMediaMb || 20;

  return {
    ...(profile.targetGroupName ? { targetGroupName: profile.targetGroupName } : {}),
    ...(profile.targetGroupId ? { targetGroupId: profile.targetGroupId } : {}),
    ...(profile.notifyTargetId ? { notifyTargetId: profile.notifyTargetId } : {}),
    allowedSenders,
    commandPrefix: profile.commandPrefix || "!",
    googleAuthMode,
    ...(profile.googleClientId ? { googleClientId: profile.googleClientId } : {}),
    ...(profile.googleClientSecret ? { googleClientSecret: profile.googleClientSecret } : {}),
    ...(profile.googleRefreshToken ? { googleRefreshToken: profile.googleRefreshToken } : {}),
    googleOAuthRedirectUri:
      profile.googleOAuthRedirectUri || "http://localhost:3001/oauth2callback",
    ...(profile.googleServiceAccountJson
      ? { googleServiceAccountJson: path.resolve(profile.googleServiceAccountJson) }
      : {}),
    spreadsheetId: extractSpreadsheetId(profile.spreadsheetId),
    sheetName: profile.sheetName || "Data",
    driveFolderId: extractDriveFolderId(profile.driveFolderId),
    timezone: profile.timezone || "Asia/Jakarta",
    maxMediaBytes: maxMediaMb * 1024 * 1024,
    duplicateScope: profile.duplicateScope || "day",
    waAuthPath: path.resolve(profile.waAuthPath || `./data/wwebjs-auth-${cleanName}`),
    stateFilePath: path.resolve(profile.stateFilePath || `./data/state-${cleanName}.json`),
    port: profile.port || 8080,
    logLevel: profile.logLevel || "info",
  };
}
