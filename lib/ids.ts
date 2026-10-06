// What a project, Codex entry or Construct chat id may be: it names a folder
// or file under PEN_DIR, so this is also what keeps paths inside it. Imports
// nothing, so proxy.ts, client components and plain-Node tests can all use it
// (tested modules import it as "./ids.ts").

/** The pattern without anchors, for building larger ones (citations). */
export const ID_PATTERN = "[a-z0-9][a-z0-9-]{0,79}";

const ID_RE = new RegExp(`^${ID_PATTERN}$`);

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * The Global Codex's owner: in the places a project id goes (the store, the
 * API, Construct), it names the notes every book shares. Not a valid project
 * id, so no book can take it and nothing that lists books finds it.
 */
export const GLOBAL = "_global";

/** A project id, or GLOBAL: whose Codex an entry is in. */
export function isOwnerId(id: unknown): id is string {
  return id === GLOBAL || isValidId(id);
}
