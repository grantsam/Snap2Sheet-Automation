import "dotenv/config";
import { loadConfig } from "../src/config";
import { DriveRepository } from "../src/drive-repository";
import { SheetRepository } from "../src/sheet-repository";

async function main(): Promise<void> {
  const config = loadConfig();
  const drive = new DriveRepository(config);
  const sheets = new SheetRepository(config);
  const folder = await drive.verifyRootFolder();
  await sheets.ensureHeader();
  console.log(
    JSON.stringify(
      {
        ok: true,
        authMode: config.googleAuthMode,
        driveFolder: folder.name,
        sharedDrive: folder.sharedDrive,
        sheetName: config.sheetName,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
