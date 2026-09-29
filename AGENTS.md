<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# pen

A mobile-first WYSIWYG markdown editor for fiction. Next.js 16 (App Router) + Tiptap 3 with `@tiptap/markdown` (`contentType: "markdown"`, `editor.getMarkdown()`). Plain CSS in `app/globals.css`; no UI kit.

## Layout

- `lib/docs.ts`: the library on disk: one folder per project in `data/` (override with `PEN_DIR`), holding `manuscript.md` (the master copy), `versions/` (snapshots + `index.json`, see `lib/versions.ts`) and `codex/` (notes, one `.md` per entry, edited at `/d/<id>/codex/<entry>` with the same `Pen` editor in `kind="entry"` mode). Ids are validated against `^[a-z0-9][a-z0-9-]{0,79}$`; deletes move the whole folder to `data/.trash/`. Old flat `data/<id>.md` files are migrated on first access.
- Versions: named ones from the History tab; automatic ones when a save arrives after 30 min of quiet (`PEN_SESSION_GAP_MS` overrides, handy in tests) and before every restore. Only the newest 30 automatic ones are kept.
- `app/api/docs/`: list/create (import) and per-document GET/PUT/POST(beacon)/DELETE. Saves carry `baseVersion` (sha1 of content); a stale save gets 409 with the current doc.
- `lib/useAutosave.ts`: idle autosave, conflict prompt, pull on focus, per-document localStorage backup, `leave()` to flush before navigating.
- `/` is the welcome page + library; `/d/[id]` is the editor. With exactly one document, `/` redirects to it unless `?library` is set.

## Working here

- **Never write to `data/`.** It holds the user's real manuscripts, and they often write in the running dev server while you work. Test against a throwaway library instead: `next build`, then `PEN_DIR=<scratch dir> next start -p 3001`.
- Node isn't on PATH (NixOS): run tools through `nix shell nixpkgs#nodejs --command npx ...`.
- The dev server usually runs on port 3000 bound to `0.0.0.0` (`next dev -H 0.0.0.0 -p 3000`) so the user can test on their phone. Leave it running.
- For browser tests, install `puppeteer-core` in a scratch directory (not in this project) and launch the Chromium from `nix shell nixpkgs#chromium`. The Tiptap instance is reachable in tests as `document.querySelector(".ProseMirror").editor`.
- When stopping a background server with `pkill -f`, pick a pattern that won't also match the shell running the `pkill` command.
- Headings: `#` manuscript title, `##` part (roman-numbered), `###` chapter (numbered straight through). Editor allows levels 1–3.
- Comments (`lib/comments.ts`): `%% … %%` (default for new ones) and `<!-- … -->` are editor content, block or inline, written back verbatim, excluded from word counts and titles. Test round-trips on real files when touching the tokenizers: marked merges a following paragraph into any token typed `paragraph`.
- Optional lock: a password set from the home page is stored as a scrypt hash in `PEN_DIR/.pen-auth.json`; `proxy.ts` gates every request and route handlers re-check. To reset a forgotten password, delete that file.
