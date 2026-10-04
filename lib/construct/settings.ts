import "server-only";
import path from "node:path";
import { jsonStore } from "../jsonStore";
import { DOCS_DIR } from "../paths";
import { type ModelSettings, sanitizeModelSettings } from "./models";

// Construct's default models, one file for the library (see ./models.ts).
// Missing or unreadable: every default is the agent's own.
const store = jsonStore<ModelSettings>(path.join(DOCS_DIR, ".pen-construct.json"), sanitizeModelSettings, () => ({}));

export const getModelSettings = (): Promise<ModelSettings> => store.read();

/** Merge `patch` in (an empty string unsets a use). Returns the settings as saved. */
export const patchModelSettings = (patch: Record<string, unknown>): Promise<ModelSettings> =>
  store.update((current) => sanitizeModelSettings({ ...current, ...patch }));
