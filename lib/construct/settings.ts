import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeAtomic } from "../files";
import { DOCS_DIR } from "../paths";
import { queue } from "../queue";
import { type ModelSettings, sanitizeModelSettings } from "./models";

// Construct's default models, one file for the library (see ./models.ts).
const FILE = path.join(DOCS_DIR, ".pen-construct.json");

export async function getModelSettings(): Promise<ModelSettings> {
  try {
    return sanitizeModelSettings(JSON.parse(await readFile(FILE, "utf8")));
  } catch {
    return {}; // missing or unreadable: every default is the agent's own
  }
}

const serialize = queue("construct-settings");

/** Merge `patch` in (an empty string unsets a use). Returns the settings as saved. */
export function patchModelSettings(patch: Record<string, unknown>): Promise<ModelSettings> {
  return serialize(async () => {
    const merged: Record<string, unknown> = { ...(await getModelSettings()), ...patch };
    const next = sanitizeModelSettings(merged);
    await writeAtomic(FILE, JSON.stringify(next, null, 2));
    return next;
  });
}
