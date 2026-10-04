import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Browser tests (e2e/), run with `npm run test:e2e` (on NixOS inside
// `nix develop .#e2e`, which provides Chromium as PEN_E2E_CHROMIUM).
//
// They start their own `next dev` on port 3101 over an empty library in a
// temporary folder, so they never see data/ and leave the production build
// (.next, served on :3000) alone: next dev builds into .next/dev. Set
// PEN_E2E_URL to test a server that's already running instead, such as a
// production build made in a scratch worktree (see AGENTS.md); its library
// should be a throwaway one too, since the tests create, rename and delete.

const PORT = 3101;
const external = process.env.PEN_E2E_URL;

// The config is loaded again by each worker, which inherits this: one library a run.
const library = (process.env.PEN_E2E_LIBRARY ??= fs.mkdtempSync(path.join(os.tmpdir(), "pen-e2e-")));

export default defineConfig({
  testDir: "e2e",
  globalTeardown: "./e2e/teardown.ts",
  // One library and one lock for the whole run: tests go one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    launchOptions: process.env.PEN_E2E_CHROMIUM ? { executablePath: process.env.PEN_E2E_CHROMIUM } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: `next dev -p ${PORT}`,
        url: `http://localhost:${PORT}/api/docs`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          PEN_DIR: path.join(library, "data"),
          PEN_CACHE_DIR: path.join(library, "cache"),
          PEN_AI: "off",
        },
      },
});
