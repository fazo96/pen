import path from "node:path";

// Kept free of "server-only" so proxy.ts (outside the RSC graph) can import it.

// The library: every document is one markdown file in this directory.
export const DOCS_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PEN_DIR ?? path.join(process.cwd(), "data"),
);

// Things pen can make again (the dictionary, grammar results): safe to delete,
// and never part of the library or its exports.
export const CACHE_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PEN_CACHE_DIR ?? path.join(process.cwd(), "cache"),
);
