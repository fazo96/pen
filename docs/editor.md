# The editor

The editor page (`components/Pen.tsx`) and what happens in the text.

## Saving and the editor hooks

`lib/useAutosave.ts`: idle autosave, conflict prompt, pull on focus, per-document localStorage backup, `leave()` to flush before navigating. `useEditorDoc` (`lib/useEditorDoc.ts`) puts it together with the editor for one document, manuscript or entry (straightening quotes on open), and `useDocScan` rescans the document 200 ms after edits pause. The editor page (`components/Pen.tsx`) keeps its pieces in hooks: `useCodexPanel` (the side panel: which entry, which editor was used last, `?entry=`), `useVersionPreview` (a version over the manuscript, restore, the citation handshake), `useFind` (beside `FindBar`), `useWindowKeys` for page-wide shortcuts; `EditorTopBar` draws the top bar and the phone menu. Breakpoints and pointer queries are named in `lib/media.ts`. The browser calls the API through `lib/api.ts` (`api()` throws `ApiError` with the server's message), except saves, beacons and streams.

## Where the writer was, and the switch

Where the writer was (`lib/spot.ts`, `lib/useSpot.ts`): `<project>/spot.json` holds the manuscript's spot, each Codex entry's (50 most recent) and `last`, the entry viewed last (any opening counts: its page or the side panel). A spot is the selection and the text at the top of the screen, each as a textblock's position, opening words and offset (found by the words first, so edits elsewhere don't lose it). Saved by `PUT /api/docs/<id>/spot` (`{ spot }`, `{ entry, spot }`, or `{ entry }` on opening one; a lone Spot from older pages is the manuscript's) 2 s after scrolling or moving the cursor, before `go()` navigates, and by beacon when the page is hidden; the pages read it so the manuscript or entry opens there on any device, unless `?cite=` brought it somewhere else. Renaming or trashing an entry updates the file (in `lib/docs.ts`). The top line is found with `coordsAtPos`, not `posAtCoords`, which hit-tests and fails while the drawer covers the text. The switch (Ctrl+Shift+E, and the quick switcher's top row) goes between the manuscript and `last`: separate pages on phones, the side panel ≥1180px (with the panel open, the cursor moves between the two editors and the panel stays); with no `last`, it opens the drawer's Codex tab. Ctrl+Shift+M / X / A go to the manuscript, the Codex entry and Construct (Esc there gives the cursor back to the text), putting the cursor there except on touch screens (across a page change via sessionStorage `pen:focus-on-arrival`). Shortcuts are listed once in `lib/shortcuts.ts`, which tooltips (`useKeys`, ⌘ on a Mac), palette hints and the Keyboard section of `/settings` read.

## Headings

Headings: `#` manuscript title, `##` part (roman-numbered), `###` chapter (numbered straight through). Editor allows levels 1–3.

## Comments

Comments (`lib/comments.ts`): `%% … %%` (default for new ones) and `<!-- … -->` are editor content, block or inline, written back verbatim, excluded from word counts and titles. Test round-trips on real files when touching the tokenizers: marked merges a following paragraph into any token typed `paragraph`.

## Quotes

Quotes stay straight (`lib/quotes.ts`): Typography's quote rules are off, and curly quotes from imports, pastes or phone keyboards are straightened as they arrive and when a document opens (a manuscript gets a "Before straightening quotes" version first). Code is left alone. `--` → `—` and `...` → `…` still apply while typing.

## Quick switcher and commands

Quick switcher and commands (`components/Palette.tsx`, matching in `lib/palette.ts`): Ctrl/Cmd+O and the top bar's button open the switcher (the switch first, then recent Codex entries from `spot.json`, headings from the live editor, the Codex, other books); Ctrl/Cmd+P or Ctrl+K open commands, which is the same dialog with `>` typed. Both lists are built when it opens by `buildPlaces` and `buildCommands` (`lib/penCommands.ts`, pure and tested) from a context `Pen.tsx` gathers, so commands follow the page's state (selection, Construct, panel); the few that act in child components go through `requestLookUp`, `ConstructHandle` (`ask`, `newChat`, `compact`, `focus`; New chat and Compact wait for the conversation to load) and `createEntry` in `lib/api.ts`. Matching ignores case and accents, takes the query's words in any order, and keeps the given order on ties (recent first). Esc gives the editor its cursor back.

## Find and replace

Find and replace (`lib/find.ts` matching, pure and tested; `lib/findPlugin.ts` the editor plugin; `components/FindBar.tsx`): Ctrl+F / Ctrl+H (⌥⌘F on a Mac, since ⌘H hides the app), the palette, or Find in the phone menu. It searches the editor used last (the manuscript, or the Codex panel, where the bar renders as `CodexPanel`'s children); Ctrl+F inside the bar is left to the browser. Every textblock is read whole (matches cross bold/italic, never paragraphs), comments and code included; case optional, accents and curly quotes ignored, `...`/`…` and `--`/`—` find each other. Matches are decorations, moved along on edits and searched again after 250 ms; at most 5000 drawn. Replace all is one transaction (one undo). Esc leaves the current match selected in the text.

## Look up

Look up (`components/WordTools.tsx`): selecting up to 4 words (`pickedWords` in `lib/wordTools.ts`) shows a bar over them where there's a mouse, or buttons at the start of the toolbar on touch screens: Look up (also Ctrl+Shift+D) and Construct's Synonyms / Meaning / Ask…. Look up asks `GET /api/dictionary?word=` (`lib/dictionary.ts`): Open English WordNet 2025 (CC BY 4.0, credited in `/settings`), indexed into `cache/wordnet/oewn-2025.json.gz` by `lib/wordnetBuild.ts` (pinned 10 MB download + checksum, ~4 s, in a child process because parsing it leaves ~200 MB behind in the server, even from a worker thread) on the first look-up, which waits for it (the popover says so after 1.5 s); a failed download is retried after a minute. `npm run dictionary` (`scripts/build-dictionary.ts`) makes it ahead, for servers that can't reach GitHub. It's loaded on the first look-up (~40 MB). `lib/wordforms.ts` finds base forms (WordNet's suffix rules; irregular forms come from the index) and gives a chosen synonym the replaced word's form and case; when that can't be done by rule ("went", or a synonym like "take" whose forms are irregular) it inserts the plain word and leaves it selected. Construct buttons (these, and Ask Construct in the grammar popover) send to the open chat through `ConstructHandle.ask`, with the selection's paragraph in `PromptContext.paragraph`; Ask… only fills the input.
