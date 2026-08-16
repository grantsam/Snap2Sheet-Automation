import path from "node:path";
import type { DuplicateScope } from "./types";

export type GoogleAuthMode = "oauth" | "service_account";

export interface AppConfig {
  targetGroupName?: string;
  targetGroupId?: string;
  notifyTargetId?: string;
  allowedSenders: Set<string>;
  commandPrefix: string;
  googleAuthMode: GoogleAuthMode;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleOAuthRedirectUri: string;
  googleServiceAccountJson?: string;
  spreadsheetId: string;
  sheetName: string;
  driveFolderId: string;
  timezone: string;
  maxMediaBytes: number;
  duplicateScope: DuplicateScope;
  waAuthPath: string;
  stateFilePath: string;
  puppeteerExecutablePath?: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Environment variable ${name} wajib diisi.`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = optional(name);
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} harus berupa bilangan bulat positif.`);
  }
  return value;
}

function normalizeSender(value: string): string {
  return value.includes("@") ? value.toLowerCase() : value.replace(/\D/g, "");
}

export function loadConfig(): AppConfig {
  const targetGroupName = optional("TARGET_GROUP_NAME");
  const targetGroupId = optional("TARGET_GROUP_ID");
  const notifyTargetId = optional("NOTIFY_TARGET_ID") ?? optional("NOTIFICATION_TARGET_ID");
  if (!targetGroupName && !targetGroupId) {
    throw new Error("Isi TARGET_GROUP_NAME atau TARGET_GROUP_ID.");
  }

  const googleAuthMode = (optional("GOOGLE_AUTH_MODE") ?? "oauth") as GoogleAuthMode;
  if (!(["oauth", "service_account"] as const).includes(googleAuthMode)) {
    throw new Error("GOOGLE_AUTH_MODE harus oauth atau service_account.");
  }

  const duplicateScope = (optional("DUPLICATE_SCOPE") ?? "day") as DuplicateScope;
  if (!(["day", "all", "none"] as const).includes(duplicateScope)) {
    throw new Error("DUPLICATE_SCOPE harus day, all, atau none.");
  }

  const rawLogLevel = optional("LOG_LEVEL") ?? "info";
  if (!(["debug", "info", "warn", "error"] as const).includes(rawLogLevel as AppConfig["logLevel"])) {
    throw new Error("LOG_LEVEL harus debug, info, warn, atau error.");
  }

  const allowedSenders = new Set(
    (optional("BOT_ALLOWED_SENDERS") ?? "")
      .split(",")
      .map((item) => normalizeSender(item.trim()))
      .filter(Boolean),
  );
  const puppeteerExecutablePath = optional("PUPPETEER_EXECUTABLE_PATH");

  const common = {
    allowedSenders,
    commandPrefix: optional("BOT_COMMAND_PREFIX") ?? "!",
    googleAuthMode,
    googleOAuthRedirectUri:
      optional("GOOGLE_OAUTH_REDIRECT_URI") ?? "http://localhost:3001/oauth2callback",
    spreadsheetId: required("GOOGLE_SPREADSHEET_ID"),
    sheetName: optional("GOOGLE_SHEET_NAME") ?? "Data",
    driveFolderId: required("GOOGLE_DRIVE_FOLDER_ID"),
    timezone: optional("TIMEZONE") ?? "Asia/Jakarta",
    maxMediaBytes: integer("MAX_MEDIA_MB", 20) * 1024 * 1024,
    duplicateScope,
    waAuthPath: path.resolve(optional("WA_AUTH_PATH") ?? "./data/wwebjs-auth"),
    stateFilePath: path.resolve(optional("STATE_FILE_PATH") ?? "./data/state.json"),
    port: integer("PORT", 8080),
    logLevel: rawLogLevel as AppConfig["logLevel"],
  };

  const config: AppConfig = {
    ...common,
    ...(targetGroupName ? { targetGroupName } : {}),
    ...(targetGroupId ? { targetGroupId } : {}),
    ...(notifyTargetId ? { notifyTargetId } : {}),
    ...(puppeteerExecutablePath ? { puppeteerExecutablePath } : {}),
  };

  if (googleAuthMode === "oauth") {
    config.googleClientId = required("GOOGLE_CLIENT_ID");
    config.googleClientSecret = required("GOOGLE_CLIENT_SECRET");
    config.googleRefreshToken = required("GOOGLE_REFRESH_TOKEN");
  } else {
    config.googleServiceAccountJson = path.resolve(required("GOOGLE_SERVICE_ACCOUNT_JSON"));
  }

  return config;
}

export function isSenderAllowed(config: AppConfig, senderId: string): boolean {
  if (config.allowedSenders.size === 0) return true;
  const normalizedId = normalizeSender(senderId);
  const digits = senderId.replace(/\D/g, "");
  return config.allowedSenders.has(normalizedId) || config.allowedSenders.has(digits);
}
