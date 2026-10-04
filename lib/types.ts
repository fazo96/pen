// The shapes the API sends the browser, shared by the server (lib/docs.ts,
// lib/versions.ts) and the components. Types only, so client code can import
// them without reaching into server-only modules.

/** A manuscript or Codex entry as stored; `version` is the sha1 a save must name. */
export type Doc = { id: string; content: string; version: string };

export type DocMeta = {
  id: string;
  title: string;
  words: number;
  /** Last written: the manuscript or any Codex entry. */
  modified: number;
  /** mtime of the cover image, to cache-bust its URL; null without one. */
  cover: number | null;
};

export type EntryMeta = { id: string; title: string; words: number; modified: number };

export type VersionKind = "named" | "auto";
export type VersionMeta = { id: string; kind: VersionKind; label: string; created: number; words: number };
