# Refactoring opportunities

An analysis of the codebase (October 2026) for what makes it hard to maintain and extend. Line numbers are as of commit `b6f2a37` and will drift.

Overall health is decent: `tsc --noEmit` is clean under `strict`, 119/119 tests pass, there's no `any`, colours almost all go through CSS variables, the Tiptap setup is already shared (`lib/usePenEditor.ts`) and Construct's tools are a table, not a switch. The weight is in a handful of big files (`components/Pen.tsx`, `lib/construct/session.ts`, `components/Construct.tsx`, `lib/construct/tools.ts`, `lib/docs.ts`, `app/globals.css`) and in small patterns copy-pasted per feature.

## Bugs and fragile spots

All fixed (October 2026), except the last, which turned out not to be one.

1. ~~**Failed deletes are ignored.**~~ Done: History and the Codex list show an error; a 404 counts as done.
2. ~~**Construct's Codex chip depends on exact wording.**~~ Done: the reply and its parser (`createdEntryIn`) sit together in `tools.ts`.
3. ~~**The save queue is module-scoped.**~~ Done: `lib/queue.ts`, named queues on `globalThis`, used by docs, shelves, grammar settings and Construct settings.
4. ~~**A renamed book can lose its shelf position.**~~ Done: saving shelves maps renamed ids (`.pen-renames.json`) to their current ones first (`followRenames`), which also covers a page left open across a rename.
5. ~~**Invalid entry/chat ids give 500.**~~ Not a bug: every caller validates first (routes return 404, `readEntry`/`readDoc` return null, Construct's tools validate both ids with `entryId`, chat ids are generated). `entryFile`/`chatFile` throwing is the last line of defence.

## Refactors

### A. Shared client and server plumbing — done
- `lib/route.ts`: every API handler (but `auth` and `construct/mcp`) is `route(fn)`: session re-check, params awaited, `id`/`eid`/`vid` validated (404) first; shared `notFound`/`badRequest`/`fail`/`noContent`/`noStore`/`readJson`.
- `lib/api.ts`: the browser's JSON calls (`api()`, `ApiError` with the server's message, `apiDelete` treating 404 as done, `saveVersion`, `createEntry`). Saves, beacons and streams still use `fetch`.
- `lib/ids.ts` (the id pattern), `lib/types.ts` (shapes shared with the browser).
- Left: a global 401 → `/unlock` path in `api()` (today each caller says "locked" its own way).

### B. Writing files — done
- `lib/files.ts` (`writeAtomic`, `createExclusive`) replaced seven hand-written tmp+rename writes and the grammar cache's fixed `.tmp`; a new manuscript and a new Codex entry are now written whole too.
- `lib/jsonStore.ts`: shelves, renames, grammar settings and Construct's models (`.pen-auth.json` stays on `writeAtomic`: it's never read-modify-written, and a corrupt one must throw).
- Left: per-project queues (one queue serializes every book; a slow snapshot in one blocks saves in another), caching `renamedTo` in `proxy.ts` (cheap: one `stat` unless the id is gone).

### C. Slim down `components/Pen.tsx` — done (1395 → 841 lines)
- `lib/penCommands.ts`: the switcher's and palette's lists, pure and tested.
- `lib/media.ts`, `lib/useEditorDoc.ts` (`useEditorDoc`, `useDocScan`, shared with `CodexPanel`), `ConflictBanner`, `useFind` (in `FindBar.tsx`), `EditorOverlays`, `ConstructHandle` instead of bumped counters, `useWindowKeys`, `useVersionPreview`, `useCodexPanel`, `EditorTopBar`.
- Not done: one table-driven keyboard dispatcher reading `lib/shortcuts.ts`. The palette and jump keys match `e.key` while find matches `e.code` (for ⌥F on a Mac), so unifying them would change behaviour on non-QWERTY layouts; `useWindowKeys` removed the fragile part (handlers kept in refs reassigned during render).
- Safety net added along the way: a Playwright suite (`e2e/`, 31 tests, `nix develop .#e2e --command npm run test:e2e`) covering every API route and the editor page's flows, with Construct on a stub agent.

### D. Construct agent adapter — done
- `lib/acp.ts` `spawnAgent()` starts every agent (chats, one-off runs, the model listing): process, stderr tail, handshake, stop. `MCP_NAME` and the launch (`launchFor`) live once in `agents.ts`; Claude Code's tool-name `_meta` is a preset hook; names, `AgentId` and the default agent are client-safe in `agentInfo.ts`.
- Left: `/compact` is still sent to any agent (unknown whether pi-acp takes it); install hints stay as prose in `ConstructSettings.tsx`; `detect.ts` stays separate (tested on its own).

### E. Split `lib/construct/session.ts` — done (786 → 589 lines)
- The `sessionUpdate` switch is `Transcript.apply()` (`transcript.ts`), stored chats and titles `chats.ts`, `prompt`/`compact` share `runTurn()`, `anchorCitations` is pure in `lib/cite.ts`: all unit-tested without an agent.
- `ToolName` union shared by `tools.ts` and the panel, whose descriptions are a `Record<ToolName, …>` (it caught `grammar_check`, which had none).
- `Construct.tsx` 740 → 371 lines: `ConstructItem`, `ConstructChats`, `ConstructModelMenu`, `ConstructMarkdown`.
- Left: tool arguments are still read by hand (`argString`/`argInt`) rather than from `inputSchema`; `tools.ts` is still one 650-line file.

### F. Shared wire types — done
`ConstructAction`, `QuickLine`, generic `ndjsonResponse<T>`, `AgentId` in `agentInfo.ts`; prompts and the message context (`promptContextFrom`, `describeContext`, `quickQuestion`) in `prompts.ts`.

### G. Split `lib/docs.ts` — done
`lib/store/{core,projects,history,codex,spots,cover,chats}.ts`, `docs.ts` a barrel; one `trashPath()`. Left: `renameDoc`'s string codes vs its siblings' booleans.

### H. Small UI pieces — done
`ConfirmRow`, `SettingsHead`, `useDismiss`, `useCloseOnEdit`, `lib/storage.ts` (`local`/`session`). The CSS class names (`lock-head`…) stay.

## Tests and tooling
- Done: `tests/setup.mjs` + `tests/hooks.mjs` let the runner load server modules against a scratch library; `store.test.ts`, `store-migration.test.ts`, `construct-tools.test.ts` cover saves and conflicts, versions, renames, the Codex, the export whitelist, the migration, `edit_codex_entry` and the MCP endpoint.
- Left: `auth.ts`, routes (covered from outside by `e2e/api.spec.ts`), `session.ts` with the stub agent (covered by `e2e/construct.spec.ts`); `passage` needs a DOM. Still no lint and no CI.

## CSS (`app/styles/`, 3927 lines)
- Done: split into nine files in the old order (joined, byte-for-byte the old file; the built CSS differs only by eight newlines).
- Left: shared primitives in unrelated sections (`.btn` defined in Library and again in Welcome, `.btn-danger` duplicates `.library-confirm-actions button.danger`, `.dropdown` under Shelf); 13 unrelated z-index values (0–71) → `--z-*` tokens; breakpoints written by hand 19× and again in `lib/media.ts`; `font-size: 10.5px` ×18 and the mono-uppercase label pattern; dead `.drawer-action`, and `is-confirming` set with no CSS; `lock-*` names that now mean "settings section".

## AGENTS.md
- Done: the stale route-map fragment is its own "Pages" bullet; the export whitelist names `.pen-construct.json`; new modules described as they landed.
- Left: the format. One huge bullet list (Construct alone ~3 KB in one bullet); per-feature docs with a short index would make drift easier to catch.

## Suggested order
1. ~~**Quick wins**~~: done (the bugs, `lib/queue.ts`, `lib/ids.ts`, `npm run typecheck`, tests for the pure modules).
2. ~~**Foundations**~~: A, B, F and testable server modules done.
3. ~~**The big files**~~: C, D, E, G done.
4. **Any time**: ~~H, the CSS split~~ done; left: the CSS clean-ups above, restructuring AGENTS.md, lint and CI.
