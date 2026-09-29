import path from "node:path";

// Kept free of "server-only" so proxy.ts (outside the RSC graph) can import it.

// The library: every document is one markdown file in this directory.
export const DOCS_DIR = path.resolve(
  /*turbopackIgnore: true*/
  process.env.PEN_DIR ?? path.join(process.cwd(), "data"),
);
