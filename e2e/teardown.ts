import fs from "node:fs";

// Remove the run's throwaway library (see playwright.config.ts).
export default function teardown() {
  const dir = process.env.PEN_E2E_LIBRARY;
  if (dir && !process.env.PEN_E2E_URL) fs.rmSync(dir, { recursive: true, force: true });
}
