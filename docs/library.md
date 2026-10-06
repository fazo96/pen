# The library on disk

How pen keeps books, versions and the library-wide files, and how to write them safely.

## Layout

`lib/docs.ts` (gathering `lib/store/`: `core` the layout, queue and trash, then `projects`, `history`, `codex`, `spots`, `cover`, `chats`): the library on disk: one folder per project in `data/` (override with `PEN_DIR`), holding `manuscript.md` (the master copy), `versions/` (snapshots + `index.json`, see `lib/versions.ts`) and `construct/` (Construct chats), `codex/` (notes, one `.md` per entry, edited at `/d/<id>/codex/<entry>` with the same `Pen` editor in `kind="entry"` mode, or on screens ≥1180px beside the manuscript in `components/CodexPanel.tsx`, kept in the URL as `/d/<id>?entry=<entry>`; ≥2000px it can share the right side with Construct), and an optional `cover.<jpg|png|webp|avif|gif>` (format sniffed from magic bytes, served by `/api/docs/<id>/cover?v=<mtime>`; the browser downscales to WebP before upload, `lib/cover.ts`). Ids are validated against `^[a-z0-9][a-z0-9-]{0,79}$`; deletes move the whole folder to `data/.trash/`. Old flat `data/<id>.md` files are migrated on first access.

## The Global Codex

The Global Codex holds the notes every book shares: `PEN_DIR/.pen-global/`, laid out like a book's folder minus the manuscript (`codex/`, `construct/` for its chats, `spot.json`). The store, the API and Construct name it by the owner id `GLOBAL` (`"_global"`, `lib/ids.ts`), which `isValidId` refuses, so no book can take it and `listDocs` never lists it; `isOwnerId` accepts it. `dirOf(GLOBAL)` is its folder, `projectExists(GLOBAL)` is always true and `readDoc`/`fileOf` refuse it, so the codex, spot and chat functions work on it unchanged while nothing writes a manuscript, version or cover there. Its saves are recorded in the [writing stats](stats.md) under `_global` (kind `codex`), like a book's Codex, and not shown yet. `moveEntry(from, eid, to)` (`lib/store/codex.ts`) moves an entry between any two Codexes (a book's or the Global Codex), keeping its id unless taken there (then `-2`, `-3`…) and dropping it from the old `spot.json`; its writing stats stay where it was written. The library export includes `.pen-global/`, and the library's Codex figures count its entries. In the browser, `lib/entryRef.ts` turns an owner and id into addresses (`/codex/<eid>`, `/d/<id>/codex/<eid>`) and the panel's refs ([editor](editor.md)).

## Writing in PEN_DIR

Writing in `PEN_DIR`: whole files through `writeAtomic`/`createExclusive` (`lib/files.ts`: a `*.tmp` beside it, renamed over; exports skip `*.tmp`), read-modify-writes through a named queue (`lib/queue.ts`, kept on `globalThis` so a module loaded twice still shares it; `lib/store/core.ts` has one that every project shares), and the library-wide `.pen-*.json` files (shelves, renames, grammar, Construct's models) through `jsonStore` (`lib/jsonStore.ts`: read through a sanitizer, missing or corrupt reads as the default, updates queued). Ids are checked by `isValidId` (`lib/ids.ts`).

## Versions

Versions: named ones from the History tab; automatic ones when a save arrives after 30 min of quiet (`PEN_SESSION_GAP_MS` overrides, handy in tests) and before every restore. Only the newest 30 automatic ones are kept. The preview's "Changes" toggle marks what differs from the live draft (`lib/diff.ts`, lazy-loaded) using `lib/textdiff.ts` (blocks lined up first, edited ones word-diffed), drawn as decorations on the read-only view. Construct's `diff_versions` tool uses the same `lib/textdiff.ts` on markdown lines.

## Renaming a project

Renaming a project (`PATCH /api/docs/<id>` `{ id }`, `renameDoc`) moves its folder and records the old id in `PEN_DIR/.pen-renames.json` (`lib/renames.ts`, kept one hop deep). `proxy.ts` redirects `/d/<old>/…` and rewrites `/api/docs/<old>/…` to the new id, so an editor still open under the old id saves into the renamed project instead of recreating the old one (`writeDoc` recreates missing projects on purpose). Construct's agent runs in `tmpdir/pen-construct/<name>`, where the name is pinned in `construct/agent-home` the first time, because Claude Code files its sessions by that path.

## Stats and export

Stats and export (`lib/library.ts`): both settings pages show words, Codex, versions, size on disk and trash size (a book's trash is the `.trash/<id>--…` items, so things trashed before a rename count under the old id). `GET /api/docs/<id>/export` zips a book's folder plus its trash items; `GET /api/export` zips every book folder, `.trash`, `.pen-stats/` ([writing stats](stats.md)), `.pen-shelves.json`, `.pen-renames.json`, `.pen-grammar.json` and `.pen-construct.json` (`LIBRARY_FILES`), a whitelist: the password hash and anything else in the data folder (Construct's `.claude` in Docker) stay out. The zip writer is `lib/zip.ts` (node:zlib, streamed a file at a time, no ZIP64).

## The cache

`cache/` (`PEN_CACHE_DIR`, `CACHE_DIR` in `lib/paths.ts`, git-ignored) holds what pen can make again: `wordnet/` (the Look up index) and `grammar/` (Harper's flags per paragraph). Safe to delete; never part of exports. Docker sets it to `/cache`.
