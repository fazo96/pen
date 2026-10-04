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
