import readline from "node:readline/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { listProjects } from "../src/project-loader";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (default: ${defaultValue}): ` : ": ";
  const answer = await rl.question(`${question}${suffix}`);
  const trimmed = answer.trim();
  return trimmed || defaultValue || "";
}

async function main(): Promise<void> {
  console.log("=======================================================");
  console.log("          Snap2Sheet WhatsApp Automation Bot           ");
  console.log("=======================================================");

  const projects = listProjects();
  let selectedProject: string | undefined;

  if (projects.length > 0) {
    console.log("\n📁 PILIH PROYEK:");
    projects.forEach((p, idx) => {
      const group = p.targetGroupName || p.targetGroupId || "Grup belum di-set";
      console.log(`  [${idx + 1}] ${p.name.padEnd(20)} | Sheet: ${p.sheetName.padEnd(10)} | ${group}`);
    });
    console.log(`  [D] Gunakan konfigurasi .env langsung (Default)`);
    console.log(`  [S] Buka Setup Wizard (Buat/Edit Proyek Baru)`);
    console.log("-------------------------------------------------------");

    const pChoice = await prompt("Pilih proyek (nomor/D/S)", "1");
    const upper = pChoice.toUpperCase();

    if (upper === "S") {
      rl.close();
      const setupProc = spawn("npx", ["tsx", "scripts/setup-wizard.ts"], {
        stdio: "inherit",
        shell: true,
      });
      setupProc.on("exit", (code) => process.exit(code ?? 0));
      return;
    } else if (upper === "D") {
      selectedProject = undefined;
    } else {
      const idx = Number(pChoice) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < projects.length) {
        selectedProject = projects[idx]?.name;
      } else {
        selectedProject = undefined;
      }
    }
  }

  console.log("\n=======================================================");
  console.log("                 PILIH MODE OPERASI                    ");
  console.log("=======================================================");
  console.log("  [1] Mode Live (Pantau chat baru realtime)");
  console.log("  [2] Mode Sinkronisasi Riwayat (Scan chat offline + Live)");
  console.log("  [3] Mode Sinkronisasi Saja (Scan chat offline lalu selesai)");
  console.log("=======================================================");

  const modeChoice = await prompt("Pilih mode (1/2/3)", "2");
  let mode = "sync";
  if (modeChoice === "1") mode = "live";
  else if (modeChoice === "3") mode = "backwards-only";
  else mode = "sync";

  rl.close();

  const args = ["tsx", "src/index.ts", `--mode=${mode}`];
  if (selectedProject) {
    args.push(`--project=${selectedProject}`);
  }

  console.log(`\n🚀 Menjalankan Snap2Sheet ${selectedProject ? `[Proyek: ${selectedProject}]` : "[.env]"} (Mode: ${mode.toUpperCase()})...\n`);

  const botProc = spawn("npx", args, {
    stdio: "inherit",
    shell: true,
    cwd: path.resolve(__dirname, ".."),
  });

  botProc.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error("Launcher error:", err);
  rl.close();
  process.exit(1);
});
