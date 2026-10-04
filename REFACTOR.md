# Refactoring opportunities

An analysis of the codebase (October 2026) for what makes it hard to maintain and extend. Line numbers are as of commit `b6f2a37` and will drift.

Everything below is now done or decided against (October 2026), each with its reason. Overall health at the start was decent: `tsc --noEmit` is clean under `strict`, 119/119 tests pass, there's no `any`, colours almost all go through CSS variables, the Tiptap setup is already shared (`lib/usePenEditor.ts`) and Construct's tools are a table, not a switch. The weight is in a handful of big files (`components/Pen.tsx`, `lib/construct/session.ts`, `components/Construct.tsx`, `lib/construct/tools.ts`, `lib/docs.ts`, `app/globals.css`) and in small patterns copy-pasted per feature.

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
- Decided against: a global 401 → `/unlock` redirect in `api()`. The editor stays on the page on a 401 and shows "Locked · unlock" so unsaved text isn't lost; a redirect from `api()` would throw that away. Each caller says "locked" its own way on purpose.

### B. Writing files — done
- `lib/files.ts` (`writeAtomic`, `createExclusive`) replaced seven hand-written tmp+rename writes and the grammar cache's fixed `.tmp`; a new manuscript and a new Codex entry are now written whole too.
- `lib/jsonStore.ts`: shelves, renames, grammar settings and Construct's models (`.pen-auth.json` stays on `writeAtomic`: it's never read-modify-written, and a corrupt one must throw).
- Decided against: per-project queues. There's one writer and saves are small; renames, creates and the listing span projects, so per-project locks would need a global one too, with ordering (deadlock) risks on real manuscripts for little gain.
- Decided against: caching `renamedTo` in `proxy.ts`. It's one `stat` unless the id is gone, and a cache could go stale across processes.

### C. Slim down `components/Pen.tsx` — done (1395 → 841 lines)
- `lib/penCommands.ts`: the switcher's and palette's lists, pure and tested.
- `lib/media.ts`, `lib/useEditorDoc.ts` (`useEditorDoc`, `useDocScan`, shared with `CodexPanel`), `ConflictBanner`, `useFind` (in `FindBar.tsx`), `EditorOverlays`, `ConstructHandle` instead of bumped counters, `useWindowKeys`, `useVersionPreview`, `useCodexPanel`, `EditorTopBar`.
- Not done: one table-driven keyboard dispatcher reading `lib/shortcuts.ts`. The palette and jump keys match `e.key` while find matches `e.code` (for ⌥F on a Mac), so unifying them would change behaviour on non-QWERTY layouts; `useWindowKeys` removed the fragile part (handlers kept in refs reassigned during render).
- Safety net added along the way: a Playwright suite (`e2e/`, 31 tests, `nix develop .#e2e --command npm run test:e2e`) covering every API route and the editor page's flows, with Construct on a stub agent.

### D. Construct agent adapter — done
- `lib/acp.ts` `spawnAgent()` starts every agent (chats, one-off runs, the model listing): process, stderr tail, handshake, stop. `MCP_NAME` and the launch (`launchFor`) live once in `agents.ts`; Claude Code's tool-name `_meta` is a preset hook; names, `AgentId` and the default agent are client-safe in `agentInfo.ts`.
- `/compact`: pi-acp (0.0.34) runs it as pi's own compaction, so sending it to any agent is right; pi answers with a plain message instead of `compaction_update`s, so its compaction shows as a message (noted in docs/construct.md).
- Kept as they are: install hints as prose in `ConstructSettings.tsx`; `detect.ts` separate (tested on its own).

### E. Split `lib/construct/session.ts` — done (786 → 589 lines)
- The `sessionUpdate` switch is `Transcript.apply()` (`transcript.ts`), stored chats and titles `chats.ts`, `prompt`/`compact` share `runTurn()`, `anchorCitations` is pure in `lib/cite.ts`: all unit-tested without an agent.
- `ToolName` union shared by `tools.ts` and the panel, whose descriptions are a `Record<ToolName, …>` (it caught `grammar_check`, which had none).
- `Construct.tsx` 740 → 371 lines: `ConstructItem`, `ConstructChats`, `ConstructModelMenu`, `ConstructMarkdown`.
- Done: `tools.ts` is `lib/construct/tools/` (`core.ts`, `manuscript.ts`, `versions.ts`, `codex.ts`, `index.ts`). Tools are made with `tool()`, whose schema both goes to the agent (unchanged, byte for byte) and checks and types the arguments (`readArgs`: required, strings, integers, booleans, enums, entry ids), replacing `argString`/`argInt`. Tested in `construct-tools.test.ts`.

### F. Shared wire types — done
`ConstructAction`, `QuickLine`, generic `ndjsonResponse<T>`, `AgentId` in `agentInfo.ts`; prompts and the message context (`promptContextFrom`, `describeContext`, `quickQuestion`) in `prompts.ts`.

### G. Split `lib/docs.ts` — done
`lib/store/{core,projects,history,codex,spots,cover,chats}.ts`, `docs.ts` a barrel; one `trashPath()`. `renameDoc`'s string codes stay: a rename can end four ways (ok, missing, taken, invalid), which a boolean can't say.

### H. Small UI pieces — done
`ConfirmRow`, `SettingsHead`, `useDismiss`, `useCloseOnEdit`, `lib/storage.ts` (`local`/`session`). The `lock-*` class names became `settings-*` (see CSS).

## Tests and tooling
- Done: `tests/setup.mjs` + `tests/hooks.mjs` let the runner load server modules against a scratch library; `store.test.ts`, `store-migration.test.ts`, `construct-tools.test.ts` cover saves and conflicts, versions, renames, the Codex, the export whitelist, the migration, `edit_codex_entry` and the MCP endpoint.
- Done: `auth.test.ts` (passwords, sessions, a corrupt auth file, `safeNext`, the attempt limit). Lint: Biome (`npm run lint`, `biome.jsonc`), clean, with every rule turned off or suppressed explained. CI (`.github/workflows/ci.yml`, already there) now runs lint and typecheck before the tests and the build.
- Covered from outside rather than by unit tests: routes (`e2e/api.spec.ts`), `session.ts` with the stub agent (`e2e/construct.spec.ts`); `passage` needs a DOM.

## CSS (`app/styles/`)
- Done: split into nine files in the old order (joined, byte-for-byte the old file; the built CSS differs only by eight newlines).
- Done: `controls.css` (right after `base.css`) holds the shared `.btn` family, merged from Library, Welcome and the lock section, with `.btn-danger` and the confirm row's danger button sharing one rule, and `.popover-menu` from Shelf. z-index values are `--z-*` layer tokens (same numbers, named, on `:root`), `10.5px` is `--text-label`, the dead `.drawer-action` and `is-confirming` are gone, and `lock-*` is `settings-*` (`settings-section`, `settings-text`…). Checked by screenshotting HEAD and the change side by side (13 views × desk, phone, dark): identical but for data (times, sizes, the caret's heading).
- Kept: breakpoints by hand. CSS can't put a variable in `@media` (`@custom-media` needs a build step), and `lib/media.ts` names the two JS needs. The mono-uppercase label is a pattern of four declarations, not yet a class.

## AGENTS.md
- Done: the stale route-map fragment is its own "Pages" bullet; the export whitelist names `.pen-construct.json`; new modules described as they landed.
- Done: split into `docs/` (one page per area, one section per old bullet; the Construct bullet broken into subsections), with `AGENTS.md` a table of contents plus the four hard rules.

## Suggested order
1. ~~**Quick wins**~~: done (the bugs, `lib/queue.ts`, `lib/ids.ts`, `npm run typecheck`, tests for the pure modules).
2. ~~**Foundations**~~: A, B, F and testable server modules done.
3. ~~**The big files**~~: C, D, E, G done.
4. ~~**Any time**~~: H, the CSS split and clean-ups, the AGENTS.md split, lint and CI done.
