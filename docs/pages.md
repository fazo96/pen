# Pages, the library and the lock

## Pages

Pages: `/` is the library (with exactly one book it redirects to it, unless `?library` is set); `/settings` holds pen's settings (library stats and export, editor, grammar, Construct, keyboard, lock); `/d/[id]` is the editor, `/d/[id]/settings` a book's settings.

## The library's shelves

`/` is the welcome page + library, shown as shelves of books (`components/Shelves.tsx`, each book a `components/Book.tsx`; placeholder cloth covers for books without art). The arrangement lives in `PEN_DIR/.pen-shelves.json` (`lib/shelves.ts`, pure logic in `lib/shelfLayout.ts`), saved whole by `PUT /api/shelves`; books it doesn't list (new, imported) go first on the first shelf, gone ones are dropped. From 4 books up, the one written in last (manuscript or any Codex entry: `DocMeta.modified`) gets a small "Last edited" card over the shelves (`components/LastEdited.tsx`). Books are dragged with pointer events (mouse: move 5px; touch: 350ms long press), not HTML5 drag, which phones lack and which the cover-image drop already uses; a single unnamed shelf shows no header. Each book's gear (and the editor's) opens `/d/<id>/settings` (`components/BookSettings.tsx`): cover, shelf, address, delete. "New manuscript" asks for a title first (optional; `newManuscript` in `lib/text.ts` escapes it into the H1), which also names the id; when a title changes later, the settings page offers an address matching it but never renames on its own.

## Optional lock

Optional lock: a password set from `/settings` is stored as a scrypt hash in `PEN_DIR/.pen-auth.json`; `proxy.ts` gates every request and route handlers re-check. pen has no Server Actions, so `proxy.ts` also 404s any request with a `Next-Action` header (internet scanners probing for RSC exploits), `/unlock` included. To reset a forgotten password, delete that file. `proxy.ts` leaves `/sw.js` and `/offline.html` public (they hold nothing private). Pages the service worker kept open offline without the password, on the device that opened them; signing out (`/unlock`) drops them ([editor](editor.md#offline)).
