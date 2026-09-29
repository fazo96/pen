<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# pen

A mobile-first WYSIWYG markdown editor for fiction. Next.js 16 (App Router) + Tiptap 3 with `@tiptap/markdown` (`contentType: "markdown"`, `editor.getMarkdown()`). Plain CSS in `app/globals.css`; no UI kit.

## Layout

- `lib/docs.ts`: the library on disk: one folder per project in `data/` (override with `PEN_DIR`), holding `manuscript.md` (the master copy), `versions/` (snapshots + `index.json`, see `lib/versions.ts`) and `construct/` (Construct chats), `codex/` (notes, one `.md` per entry, edited at `/d/<id>/codex/<entry>` with the same `Pen` editor in `kind="entry"` mode, or on screens ≥1180px beside the manuscript in `components/CodexPanel.tsx`, kept in the URL as `/d/<id>?entry=<entry>`; ≥1800px it can share the right side with Construct), and an optional `cover.<jpg|png|webp|avif|gif>` (format sniffed from magic bytes, served by `/api/docs/<id>/cover?v=<mtime>`; the browser downscales to WebP before upload, `lib/cover.ts`). Ids are validated against `^[a-z0-9][a-z0-9-]{0,79}$`; deletes move the whole folder to `data/.trash/`. Old flat `data/<id>.md` files are migrated on first access.
- Versions: named ones from the History tab; automatic ones when a save arrives after 30 min of quiet (`PEN_SESSION_GAP_MS` overrides, handy in tests) and before every restore. Only the newest 30 automatic ones are kept. The preview's "Changes" toggle marks what differs from the live draft (`lib/diff.ts`, lazy-loaded) using `lib/textdiff.ts` (blocks lined up first, edited ones word-diffed), drawn as decorations on the read-only view. Construct's `diff_versions` tool uses the same `lib/textdiff.ts` on markdown lines.
- `app/api/docs/`: list/create (import) and per-document GET/PUT/POST(beacon)/DELETE. Saves carry `baseVersion` (sha1 of content); a stale save gets 409 with the current doc.
- `lib/useAutosave.ts`: idle autosave, conflict prompt, pull on focus, per-document localStorage backup, `leave()` to flush before navigating.
- Construct (`lib/construct/`, `components/Construct.tsx`): the AI side panel. The server spawns an ACP agent per project (`agents.ts`: Claude Code via `@agentclientprotocol/claude-agent-acp`, run with `npx`) and streams the conversation to the panel over SSE (`/api/docs/[id]/construct`). The agent's built-in tools are all off; it only gets pen's tools (`tools.ts`: manuscript/versions read-only, Codex read-write) from a small MCP endpoint, `/api/construct/mcp`, authenticated by a per-session bearer token (exempt from the lock proxy). There is deliberately no tool that writes the manuscript. Chats are stored in `<project>/construct/<chat>.json` (transcript + the agent's session id) and resumed with ACP `session/resume` after a restart. pi's `pi-acp` ignores MCP servers from ACP and would need its own adapter (e.g. a pi extension registering the same tools).
- Citations (`lib/cite.ts`, `lib/passage.ts`): Construct links passages as `pen:L120`, `pen:L120-L134`, `pen:v/<version>/L40` or `pen:codex/<entry>`; the panel renders them as chips. When a turn ends, the session adds the cited lines' opening words (`?q=`, `?qe=`) to the stored transcript only (the agent's own history is untouched), and a click finds the passage by that text first, the line number second. From a Codex entry's page a click goes to `/d/<id>?cite=…`.
- `/` is the welcome page + library, shown as a shelf of books (`components/Shelf.tsx`; placeholder cloth covers for books without art); `/settings` holds the lock; `/d/[id]` is the editor. With exactly one document, `/` redirects to it unless `?library` is set.

## Working here

- **Never write to `data/`.** It holds the user's real manuscripts, and they often write in the running dev server while you work. Test against a throwaway library instead: `next build`, then `PEN_DIR=<scratch dir> next start -p 3001`.
- Node isn't on PATH (NixOS): `nix develop` gives a shell with Node 24 and `node_modules/.bin` on PATH (or one-off: `nix develop --command npx ...`).
- Docker: `Dockerfile` builds with `PEN_STANDALONE=1`, which turns on `output: "standalone"` in `next.config.ts` (left off otherwise, since `next start` warns about it). The image keeps everything, Construct's agent state included (`CLAUDE_CONFIG_DIR=/data/.claude`), in the `/data` volume.
- The dev server usually runs on port 3000 bound to `0.0.0.0` (`next dev -H 0.0.0.0 -p 3000`) so the user can test on their phone. Leave it running.
- For browser tests, install `puppeteer-core` in a scratch directory (not in this project) and launch the Chromium from `nix shell nixpkgs#chromium`. The Tiptap instance is reachable in tests as `document.querySelector(".ProseMirror").editor`.
- When stopping a background server with `pkill -f`, pick a pattern that won't also match the shell running the `pkill` command.
- Headings: `#` manuscript title, `##` part (roman-numbered), `###` chapter (numbered straight through). Editor allows levels 1–3.
- Comments (`lib/comments.ts`): `%% … %%` (default for new ones) and `<!-- … -->` are editor content, block or inline, written back verbatim, excluded from word counts and titles. Test round-trips on real files when touching the tokenizers: marked merges a following paragraph into any token typed `paragraph`.
- Quotes stay straight (`lib/quotes.ts`): Typography's quote rules are off, and curly quotes from imports, pastes or phone keyboards are straightened as they arrive and when a document opens (a manuscript gets a "Before straightening quotes" version first). Code is left alone. `--` → `—` and `...` → `…` still apply while typing.
- Optional lock: a password set from `/settings` is stored as a scrypt hash in `PEN_DIR/.pen-auth.json`; `proxy.ts` gates every request and route handlers re-check. To reset a forgotten password, delete that file.
