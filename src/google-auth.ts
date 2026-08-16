import { google } from "googleapis";
import type { AppConfig } from "./config";

export function createGoogleAuth(config: AppConfig) {
  const scopes = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ];

  if (config.googleAuthMode === "service_account") {
    if (!config.googleServiceAccountJson) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON wajib diisi untuk mode service_account.");
    }
    return new google.auth.GoogleAuth({
      keyFile: config.googleServiceAccountJson,
      scopes,
    });
  }

  if (!config.googleClientId || !config.googleClientSecret || !config.googleRefreshToken) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan GOOGLE_REFRESH_TOKEN wajib diisi untuk mode oauth.");
  }

  const client = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleOAuthRedirectUri,
  );
  client.setCredentials({ refresh_token: config.googleRefreshToken });
  return client;
}
