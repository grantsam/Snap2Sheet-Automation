import "dotenv/config";
import { type AppConfig, loadConfig } from "./config";
import { DriveRepository } from "./drive-repository";
import { createHealthServer } from "./health-server";
import { Logger } from "./logger";
import { loadProject, projectToAppConfig } from "./project-loader";
import { SheetRepository } from "./sheet-repository";
import { JsonStateStore } from "./state-store";
import { SubmissionService } from "./submission-service";
import { WhatsAppBot } from "./whatsapp-bot";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const projectArg = args.find((a) => a.startsWith("--project="))?.split("=")[1]?.trim();

  let config: AppConfig;
  let activeProject = "default (.env)";

  if (projectArg) {
    const profile = loadProject(projectArg);
    config = projectToAppConfig(profile);
    activeProject = profile.name;
  } else {
    config = loadConfig();
  }

  const logger = new Logger(config.logLevel);
  logger.info(`📦 Memuat konfigurasi proyek: [ ${activeProject} ]`);

  const store = new JsonStateStore(config.stateFilePath);
  const drive = new DriveRepository(config);
  const sheets = new SheetRepository(config);

  await store.initialize();
  const driveInfo = await drive.verifyRootFolder();
  await sheets.ensureHeader();
  logger.info("Koneksi Google berhasil diverifikasi.", {
    project: activeProject,
    driveFolder: driveInfo.name,
    sharedDrive: driveInfo.sharedDrive,
    sheetName: config.sheetName,
  });

  const submissions = new SubmissionService(config, store, drive, sheets);
  const bot = new WhatsAppBot(config, store, submissions, logger);
  const server = createHealthServer(config.port, bot.status);
  logger.info("Health server aktif.", { port: config.port });

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("Menghentikan Snap2Sheet.", { signal });
    server.close();
    await bot.stop().catch((error) => logger.error("Gagal menutup WhatsApp client.", error));
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (error) => {
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      String(error.message).includes("EBUSY")
    ) {
      // Ignore benign Windows lockfile unlink race on process restart
      return;
    }
    logger.error("Unhandled rejection.", error);
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception.", error);
    void shutdown("uncaughtException");
  });

  const modeArg =
    args.find((a) => a.startsWith("--mode="))?.split("=")[1]?.toLowerCase() ||
    (args.includes("--sync") || args.includes("--backwards") ? "sync" : "live");
  const limitArg = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 500;

  logger.info(`Mode operasi: ${modeArg.toUpperCase()} (limit riwayat: ${limitArg} pesan)`);

  await bot.start();

  if (modeArg === "sync" || modeArg === "backwards" || modeArg === "backwards-only") {
    logger.info("Menunggu WhatsApp siap untuk sinkronisasi riwayat...");
    while (
      bot.status.whatsapp !== "ready" &&
      bot.status.whatsapp !== "auth_failure" &&
      bot.status.whatsapp !== "disconnected"
    ) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (bot.status.whatsapp === "ready") {
      await new Promise((r) => setTimeout(r, 2000));
      await bot.syncBackwards(limitArg);
    }
    if (modeArg === "backwards-only") {
      logger.info("Sinkronisasi riwayat selesai. Menutup bot.");
      await shutdown("DONE");
    }
  }
}

main().catch((error) => {
  const logger = new Logger("info");
  logger.error("Snap2Sheet gagal dijalankan.", error);
  process.exit(1);
});
