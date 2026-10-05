# Writing stats

What the writer typed, counted at every save, and whether it looks like drafting or editing.

## Counting a save

The save routes (`PUT`/`POST /api/docs/<id>` and `.../codex/<eid>`) pass `track` to `writeDoc`/`writeEntry`; nothing else does, so Construct's tools, restores, imported drafts and new books aren't counted. A forced save ("keep mine" after a conflict) isn't counted either: it's measured against the other device's text (`trackOf` in `lib/saveBody.ts`). When the text changed, `trackSave` (`lib/store/stats.ts`) records it in the background, one save after another, after the save has answered; an error there is logged and never fails the save. `statsSettled()` waits for it in tests.

`measureEdit` (`lib/writingStats.ts`, pure and tested) compares the two texts with comments stripped, quotes straightened and entities dropped (an empty paragraph is saved as `&nbsp;`), block by block and word by word with `lib/textdiff.ts`:

- **Drafted**: words in new paragraphs, and words added at the end of a paragraph. Retyping up to 3 words there (a typo, a word the save cut in half) still counts as drafting, net, so words aren't counted twice. A short paragraph replaced in place is writing on if the new one starts with the old one, else a rewrite.
- **Added in edits**: words inserted inside existing text, or a rewrite's new words.
- **Removed**: words deleted or replaced.
- Words both removed and added in one save (a paragraph split or joined) cancel out.
- **Pasted**: the editor counts the words in every paste (`handlePaste` in `lib/usePenEditor.ts`), and `useAutosave` sends the count with the next save (`pasted`, kept in the backup and the beacon too). The server takes those words out of drafted first, then edits, and keeps them apart: pasting isn't writing. Text written offline arrives all at once but isn't a paste, which is why the editor counts pastes rather than the server guessing from size.

Whether a span of time was drafting or editing is decided when it's shown (`workOf`: drafting when drafted words outnumber added-in-edits plus removed), never stored, so the heuristic can change and old data follows.

## On disk

`PEN_DIR/.pen-stats/<YYYY-MM>.json`, one file per UTC month (`jsonStore`, so read through a sanitizer and written whole, one update at a time). Only the current month's file is rewritten; files are kept forever and go into the library export. Each holds `slots`, one per 15 minutes per book, kind (`manuscript` or `codex`) and Codex entry: drafted, editAdded, removed, pasted, saves and activeMs, plus `entry` (the entry's id, for the Codex) and `chapters` (for the manuscript: the chapters its saves changed, see below). 15 minutes lets the browser sort them into local days in any time zone. `titles` keeps each book's last manuscript title and `entries` each entry's (by `<book>/<entry>`), so deleted ones still have a name. Slots from before entries and chapters were kept have neither.

Chapters (`measureSave`): each block's chapter is the text of the `###` heading over it (formatting marks dropped; a `####` scene heading doesn't change it). A save touches the chapter of every paragraph it changed: added or edited text by where it is now, removed text by where it was, so renaming a heading touches both names. Words aren't split between chapters: a slot's counts are the whole book's, and `chapters` only says where the work was. When unsure there's no chapter: before the first one, after a title or part heading, under a heading with no words, and in a save that changed no words (a heading level, bold).

Active time: a save within 5 minutes of the book's previous save (manuscript or Codex) adds the time between. The last save times live in memory, so after a restart the first save adds none.

Slots keep the ids the book and entry had then. `writingReport` (`lib/writing.ts`) maps them to the current ids, books through `.pen-renames.json`, entries through `.pen-stats/entry-renames.json` (by `<book>/<entry>`, written by `renameEntry`, kept one hop deep with `lib/renameMap.ts`), and names gone books from `titles`, flagged `gone`. Writing before a book was trashed stays in the totals; a new book later given the same id shares its history.

The Codex, entries and chapters are recorded but not shown yet (`summarize` defaults to `kind: "manuscript"` and sums a book's slots).

## Showing them

`GET /api/stats?from=&to=` (ms since the epoch; the last 32 days by default) returns `{ slots, books, entries }`. `/stats` (`components/WritingPage.tsx`, `WritingStats.tsx`) and the library's card (`components/WritingCard.tsx`, over the shelves, left of Last edited when both fit) get the last 32 days from the server and sort them in the browser (`lib/statsView.ts`, pure and tested), after the first render, since the server doesn't know the writer's time zone. `/stats` has Today (by hour), 7 days and 30 days (by day), a book filter (both remembered in localStorage), totals, the drafting/editing split, the chart (`components/WritingChart.tsx`: drafted under added-in-edits above the line, removed below it, each column explained on hover, focus or tap), and tables by book and by day. Its chart colors are `--chart-draft` and `--chart-edit` in `base.css`, checked for color blindness against each theme's paper. It's reached from the card, `/settings`'s Library section and the command palette's "Writing stats".
