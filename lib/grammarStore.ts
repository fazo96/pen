import "server-only";
import path from "node:path";
import { applyPatch, emptyConfig, sanitizeConfig, type GrammarConfig, type GrammarPatch } from "./grammarConfig";
import { jsonStore } from "./jsonStore";
import { DOCS_DIR } from "./paths";

// The grammar checker's dictionary and switches, one file for the library.
// Missing or unreadable: nothing added yet.
const store = jsonStore(path.join(DOCS_DIR, ".pen-grammar.json"), sanitizeConfig, emptyConfig);

export const getGrammar = (): Promise<GrammarConfig> => store.read();

/** Apply one change to the saved config. Returns it as saved. */
export const patchGrammar = (patch: GrammarPatch): Promise<GrammarConfig> => store.update((c) => applyPatch(c, patch));
