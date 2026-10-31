import "server-only";
import path from "node:path";
import { GLOBAL } from "../ids";
import { jsonStore } from "../jsonStore";
import { DOCS_DIR } from "../paths";
import { dirOf } from "../store/core";
import { DEFAULT_EDIT_MODE, type EditMode, isEditMode } from "./editMode";
import { type ModelSettings, sanitizeModelSettings } from "./models";

// Construct's default models, one file for the library (see ./models.ts).
// Missing or unreadable: every default is the agent's own.
const store = jsonStore<ModelSettings>(path.join(DOCS_DIR, ".pen-construct.json"), sanitizeModelSettings, () => ({}));

export const getModelSettings = (): Promise<ModelSettings> => store.read();

/** Merge `patch` in (an empty string unsets a use). Returns the settings as saved. */
export const patchModelSettings = (patch: Record<string, unknown>): Promise<ModelSettings> =>
  store.update((current) => sanitizeModelSettings({ ...current, ...patch }));

// A book's own Construct settings: <project>/construct.json. For now, how far
// Construct may change its manuscript (./editMode.ts); missing or unreadable, Off.
type BookSettings = { manuscript: EditMode };
const bookStore = (projectId: string) =>
  jsonStore<BookSettings>(
    path.join(dirOf(projectId), "construct.json"),
    (raw) => ({ manuscript: isEditMode((raw as Partial<BookSettings> | null)?.manuscript) ? (raw as BookSettings).manuscript : DEFAULT_EDIT_MODE }),
    () => ({ manuscript: DEFAULT_EDIT_MODE }),
  );

/** How far Construct may change the book's manuscript. The Global Codex has none: always Off. */
export async function getEditMode(projectId: string): Promise<EditMode> {
  if (projectId === GLOBAL) return "off";
  return (await bookStore(projectId).read()).manuscript;
}

export async function setEditMode(projectId: string, mode: EditMode): Promise<EditMode> {
  if (projectId === GLOBAL) return "off";
  return (await bookStore(projectId).update((s) => (s.manuscript === mode ? s : { ...s, manuscript: mode }))).manuscript;
}
