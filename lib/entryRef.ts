import { GLOBAL, isValidId } from "./ids.ts";

// Where a Codex entry lives, for the browser: a book's Codex or the Global
// Codex (owner GLOBAL), and the addresses that follow from it. In a book, the
// entry beside the manuscript is a "ref": its id for the book's own, and
// "global/<id>" for one of the Global Codex (also how ?entry= carries it).
// Pure, so tests load it with plain Node.

export type EntryRef = { owner: string; id: string };

/** An entry's own page. */
export const entryHref = (owner: string, eid: string) => (owner === GLOBAL ? `/codex/${eid}` : `/d/${owner}/codex/${eid}`);

/** Where its list sends the writer when the entry open on its own page is gone. */
export const codexHome = (owner: string) => (owner === GLOBAL ? "/codex" : `/d/${owner}`);

/** An entry in the API. */
export const entryApi = (owner: string, eid: string) => `/api/docs/${owner}/codex/${eid}`;

/** Its localStorage backup (lib/useAutosave.ts). */
export const entryBackupKey = (owner: string, eid: string) => `pen:backup:${owner}/codex/${eid}`;

/** The entry an own-page address names, or null. */
export function entryOfHref(href: string): EntryRef | null {
  let m = /^\/codex\/([^/?#]+)$/.exec(href);
  if (m && isValidId(m[1])) return { owner: GLOBAL, id: m[1] };
  m = /^\/d\/([^/?#]+)\/codex\/([^/?#]+)$/.exec(href);
  return m && isValidId(m[1]) && isValidId(m[2]) ? { owner: m[1], id: m[2] } : null;
}

/** A book's ref to an entry: its id if it's the book's own, "global/<id>" for the Global Codex's. */
export const refOf = (e: EntryRef) => (e.owner === GLOBAL ? `global/${e.id}` : e.id);

/** A ref read back in `book`; null if it's malformed. */
export function entryOfRef(book: string, ref: string): EntryRef | null {
  if (ref.startsWith("global/")) {
    const id = ref.slice(7);
    return isValidId(id) ? { owner: GLOBAL, id } : null;
  }
  return isValidId(ref) ? { owner: book, id: ref } : null;
}
