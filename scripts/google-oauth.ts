import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirectUri =
  process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ?? "http://localhost:3001/oauth2callback";

if (!clientId || !clientSecret) {
  console.error("Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET terlebih dahulu.");
  process.exit(1);
}

const redirect = new URL(redirectUri);
if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") {
  console.error("Untuk generator ini, redirect URI harus menggunakan localhost atau 127.0.0.1.");
  process.exit(1);
}

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

const port = Number(redirect.port || 80);
const server = http.createServer(async (request, response) => {
  const current = new URL(request.url ?? "/", redirectUri);
  if (current.pathname !== redirect.pathname) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const code = current.searchParams.get("code");
  const oauthError = current.searchParams.get("error");
  if (oauthError || !code) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end(`OAuth gagal: ${oauthError ?? "code tidak tersedia"}`);
    return;
  }
  try {
    const result = await oauth.getToken(code);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Otorisasi berhasil. Kembali ke terminal dan tutup halaman ini.");
    console.log("\nSimpan nilai berikut di .env dan jangan membagikannya:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${result.tokens.refresh_token ?? "TIDAK_DIBERIKAN_ULANG"}`);
    server.close();
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Pertukaran token gagal. Lihat terminal.");
    console.error(error instanceof Error ? error.message : error);
    server.close();
  }
});

server.listen(port, redirect.hostname, () => {
  console.log("Buka URL berikut di browser pada komputer ini:\n");
  console.log(authUrl);
  console.log(`\nMenunggu callback di ${redirectUri} ...`);
});
