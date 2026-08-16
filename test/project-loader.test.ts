import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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

test("extractSpreadsheetId extracts ID from full URLs or returns raw ID", () => {
  assert.equal(
    extractSpreadsheetId("https://docs.google.com/spreadsheets/d/13ybHNpIlvTq5AVlgUh_NFP57Vw8NWIw-7rpxPm_JaiY/edit#gid=0"),
    "13ybHNpIlvTq5AVlgUh_NFP57Vw8NWIw-7rpxPm_JaiY",
  );
  assert.equal(
    extractSpreadsheetId("https://docs.google.com/spreadsheets/d/ABC-123_xyz/edit"),
    "ABC-123_xyz",
  );
  assert.equal(extractSpreadsheetId("13ybHNpIlvTq5AVlgUh_NFP57Vw8NWIw-7rpxPm_JaiY"), "13ybHNpIlvTq5AVlgUh_NFP57Vw8NWIw-7rpxPm_JaiY");
});

test("extractDriveFolderId extracts folder ID from full URLs or returns raw ID", () => {
  assert.equal(
    extractDriveFolderId("https://drive.google.com/drive/folders/1rNL5tV6hSNMVAxq3uKZDP5eK8ETzqOjE"),
    "1rNL5tV6hSNMVAxq3uKZDP5eK8ETzqOjE",
  );
  assert.equal(
    extractDriveFolderId("https://drive.google.com/drive/u/0/folders/FOLDER_ID_123?usp=sharing"),
    "FOLDER_ID_123",
  );
  assert.equal(extractDriveFolderId("1rNL5tV6hSNMVAxq3uKZDP5eK8ETzqOjE"), "1rNL5tV6hSNMVAxq3uKZDP5eK8ETzqOjE");
});

test("sanitizeProjectName creates clean slug", () => {
  assert.equal(sanitizeProjectName("Proyek Pipa 2026!"), "proyek-pipa-2026");
  assert.equal(sanitizeProjectName("Proyek-A_Test"), "proyek-a_test");
});

test("saveProject, loadProject, listProjects, and deleteProject work correctly", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "snap2sheet-projects-test-"));

  const profile: ProjectProfile = {
    name: "proyek-test-1",
    description: "Proyek Testing A",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    googleAuthMode: "oauth",
    googleClientId: "test-client-id",
    googleClientSecret: "test-client-secret",
    googleRefreshToken: "test-refresh-token",
    spreadsheetId: "https://docs.google.com/spreadsheets/d/SHEET_123/edit",
    sheetName: "Sheet1",
    driveFolderId: "https://drive.google.com/drive/folders/DRIVE_456",
    targetGroupName: "Grup Test",
  };

  saveProject(profile, tempDir);

  const loaded = loadProject("proyek-test-1", tempDir);
  assert.equal(loaded.name, "proyek-test-1");
  assert.equal(loaded.description, "Proyek Testing A");

  const list = listProjects(tempDir);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "proyek-test-1");
  assert.equal(list[0]?.sheetName, "Sheet1");

  const config = projectToAppConfig(loaded);
  assert.equal(config.spreadsheetId, "SHEET_123");
  assert.equal(config.driveFolderId, "DRIVE_456");
  assert.equal(config.googleClientId, "test-client-id");
  assert.equal(config.googleAuthMode, "oauth");

  const deleted = deleteProject("proyek-test-1", tempDir);
  assert.equal(deleted, true);
  assert.equal(listProjects(tempDir).length, 0);
});
