import "server-only";
import path from "node:path";
import { jsonStore } from "./jsonStore";
import { DOCS_DIR } from "./paths";
import { applyProsodyPatch, emptyProsody, type ProsodyConfig, type ProsodyPatch, sanitizeProsody } from "./prosody/own";

// The writer's own pronunciations (lib/prosody/own.ts), one file for the
// library. Missing or unreadable: none set yet. Construct's tools call these too.
const store = jsonStore(path.join(DOCS_DIR, ".pen-prosody.json"), sanitizeProsody, emptyProsody);

export const getProsody = (): Promise<ProsodyConfig> => store.read();

/** Apply one change to the saved config. Returns it as saved. */
export const patchProsody = (patch: ProsodyPatch): Promise<ProsodyConfig> => store.update((c) => applyProsodyPatch(c, patch));
