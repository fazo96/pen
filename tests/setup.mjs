// Loaded before every test file (`npm test` passes `--import`). Lets Node's
// runner load pen's server modules, and points them at a throwaway library:
// without PEN_DIR, lib/paths.ts would use ./data, the writer's real books.
import { mkdtempSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "pen-test-"));
process.env.PEN_DIR = path.join(scratch, "data");
process.env.PEN_CACHE_DIR = path.join(scratch, "cache");
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

register("./hooks.mjs", import.meta.url);
