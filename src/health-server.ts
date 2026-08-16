import http from "node:http";
import type { BotStatus } from "./whatsapp-bot";

export function createHealthServer(port: number, status: BotStatus): http.Server {
  const server = http.createServer((request, response) => {
    if (request.url !== "/healthz") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const healthy = status.whatsapp === "ready" || status.whatsapp === "qr_required";
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        status: healthy ? "ok" : "degraded",
        whatsapp: status.whatsapp,
        lastEventAt: status.lastEventAt,
      }),
    );
  });

  server.on("error", (err: any) => {
    // If port 8080 is already taken by a background process, don't crash the bot
    if (err?.code === "EADDRINUSE") {
      // Server will simply not listen on 8080
    }
  });

  try {
    server.listen(port, "0.0.0.0");
  } catch {
    // Graceful fallback
  }

  return server;
}
