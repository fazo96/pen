<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# pen

A mobile-first WYSIWYG markdown editor for fiction. Next.js 16 (App Router) + Tiptap 3 with `@tiptap/markdown` (`contentType: "markdown"`, `editor.getMarkdown()`). Plain CSS in `app/globals.css`; no UI kit.

## Layout

- `lib/docs.ts`: the library on disk. One `.md` file per document in `data/` (override with `PEN_DIR`). Ids are validated against `^[a-z0-9][a-z0-9-]{0,79}$`; deletes move files to `data/.trash/`.
- `app/api/docs/`: list/create (import) and per-document GET/PUT/POST(beacon)/DELETE. Saves carry `baseVersion` (sha1 of content); a stale save gets 409 with the current doc.
- `lib/useAutosave.ts`: idle autosave, conflict prompt, pull on focus, per-document localStorage backup, `leave()` to flush before navigating.
- `/` is the welcome page + library; `/d/[id]` is the editor. With exactly one document, `/` redirects to it unless `?library` is set.

## Working here

- **Never write to `data/`.** It holds the user's real manuscripts, and they often write in the running dev server while you work. Test against a throwaway library instead: `next build`, then `PEN_DIR=<scratch dir> next start -p 3001`.
- Node isn't on PATH (NixOS): run tools through `nix shell nixpkgs#nodejs --command npx ...`.
- The dev server usually runs on port 3000 bound to `0.0.0.0` (`next dev -H 0.0.0.0 -p 3000`) so the user can test on their phone. Leave it running.
- For browser tests, install `puppeteer-core` in a scratch directory (not in this project) and launch the Chromium from `nix shell nixpkgs#chromium`. The Tiptap instance is reachable in tests as `document.querySelector(".ProseMirror").editor`.
- When stopping a background server with `pkill -f`, pick a pattern that won't also match the shell running the `pkill` command.
- Optional lock: a password set from the home page is stored as a scrypt hash in `PEN_DIR/.pen-auth.json`; `proxy.ts` gates every request and route handlers re-check. To reset a forgotten password, delete that file.
