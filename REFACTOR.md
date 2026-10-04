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

### A. Shared client and server plumbing (M, low risk)
- `if (!(await hasSession())) return lockedResponse();` is repeated in ~40 handlers; `isValidId` 29×; `type Ctx = { params: Promise<…> }` 11×; a `notFound` helper copy-pasted into 8 files; JSON bodies parsed three different ways (try/catch, `.catch(() => ({}))`, `JSON.parse(await req.text())`). GET handlers often skip the id check that their PUT/DELETE siblings do.
- Proposed `lib/route.ts`:
  ```ts
  type Opts<B> = { ids?: ("id"|"eid"|"vid")[]; ai?: boolean; body?: (raw: unknown) => B | null; maxBytes?: number };
  export function route<P, B = void>(opts: Opts<B>,
    fn: (a: { req: Request; params: P; body: B }) => Promise<Response | object | null>);
  export const http = { notFound, bad(msg), conflict(body), noContent, tooLarge(msg) };
  ```
  Keep the per-handler session re-check AGENTS.md asks for (the wrapper does it).
- Client side: ~45 `fetch(` calls in 14 files, each doing `if (!res.ok) throw new Error()` and dropping the server's `{error}`; `res.json().catch(() => ({}))` 10×; only `QuickAnswer` handles 401. A typed `lib/api.ts` (`apiJson<T>(path, init)` throwing `ApiError{status,message}`, one 401 → `/unlock` path, `saveVersion(docId, label)` used by Pen, History and quote straightening).
- ~~The id regex is duplicated~~ Done: `lib/ids.ts` (`isValidId`, `ID_PATTERN`).
- Client components import `DocMeta`/`EntryMeta` types from the `server-only` `lib/docs.ts`; move shared types to a plain module.

### B. `jsonStore<T>()` for the `.pen-*.json` files (S–M, low risk)
- Seven hand-written "tmp + rename" writes (`docs.ts`, `versions.ts`, `shelves.ts`, `renames.ts`, `grammarStore.ts`, `construct/settings.ts`, `auth.ts`), four hand-rolled queues. `createDoc` writes the manuscript non-atomically; tmp files are never cleaned up (and would land in exports).
  ```ts
  export function jsonStore<T>(file: string, sanitize: (raw: unknown) => T, fallback: () => T,
    opts?: { mode?: number; strict?: boolean /* auth: corrupt must throw */ }):
    { read(): Promise<T>; update(fn: (cur: T) => T | Promise<T>): Promise<T> };
  ```
- One global queue serializes every project; a per-id queue would stop a slow snapshot in one book blocking saves in another (`listDocs`/`renameDoc` still need the global one).
- `proxy.ts` runs `renamedTo()` (stats + a file read) on every `/d/*` and `/api/docs/*` request; cache by mtime.

### C. Slim down `components/Pen.tsx` (1395 lines; 26 `useState`, 11 `useRef`, 22 `useEffect`, 6 `exhaustive-deps` disables)
In order of payoff:
- **`lib/penCommands.ts`**: `places()`/`commands()` (~325 lines of palette item lists) as pure `buildPlaces(ctx)`/`buildCommands(ctx)`, testable with Node's runner. (S/M, low)
- **`lib/media.ts`**: named queries (`WIDE`, `ROOMY`, touch). The `(hover: none)` check exists 3× (Pen, `Construct.tsx` `isTouch`, `WordTools.tsx` `finePointer`); Pen mixes `useMedia` with 7 direct `matchMedia` calls. (S, low)
- **`useEditorDoc` + `useDocScan`**: Pen and `CodexPanel` duplicate editor+autosave wiring, quote straightening on open, and the debounced 200 ms `transaction` scan. (S, low)
- **`useFind`**, **`<EditorOverlays>`** (GrammarPopover + WordTools rendered once per editor), **`<TopBar>`** (the topbar passes the same 7 actions twice, to itself and to `EditorMenu`), **`<ConflictBanner>`**. (S, low)
- **Construct imperative handle** instead of bump-counter props (`newChat`, `compactChat`, `constructFocus`, tracked by `handled*` refs in Construct). `requestLookUp` is a module-level listener set while these are props: pick one style. (M, medium)
- **One keyboard dispatcher** reading `lib/shortcuts.ts`, replacing three capture-phase `window` keydown listeners with their own latest-refs. (M, medium: `stopPropagation` order vs Tiptap matters)
- **`useCodexPanel`**, **`useVersionPreview`** (the `citeShown` promise-ref handshake with `VersionPreview.onCited` is fragile). (L, medium; needs browser tests)
- Latest-ref assignments during render (`touchRef.current = …`, `paletteKeys`, `jumps`, `finds`) could become `useEffectEvent`.
- `createEntry` lives in `Codex.tsx` and Pen imports it; belongs in the client API module.

### D. Construct agent adapter (M, medium)
- Three copies of spawn + stderr tail + exit-as-rejection + `ndJsonStream` + SIGTERM→SIGKILL: `session.ts` launch/stop, `oneoff.ts` `runSession` and the model listing. `initialize` with the same `clientInfo` 3×. `MCP_NAME = "pen"` declared twice; `LaunchContext` built in `ask.ts` and `session.ts`. → `lib/construct/acpProcess.ts` `spawnAgent(launch, client) → { conn, exited, stderr, kill() }`.
- Claude/pi quirks outside `AgentPreset`: `toolNameOf` (`_meta.claudeCode`), `/compact` sent regardless of agent, `isNotice`/`startupInfoOf` (pi-acp), `"claude"` hard-coded as default in `session.ts`, `models.ts`, `agents.ts`; `Construct.tsx` `AGENT_NAMES` duplicates `AGENTS[x].name`; install hints in `ConstructSettings.tsx`; `detect.ts`. → extend `AgentPreset` with `toolNameOf`, `isNoise`, `startupInfo`, `compactPrompt?`, `detect()`, and put client-safe metadata (id, name, install hint) in a non-server `agentInfo.ts`. A third agent then becomes one entry.

### E. Split `lib/construct/session.ts` (786 lines, one class) (M, medium)
- Chat persistence (`StoredChat`, `chatTitle`, load/fresh/adopt/persist/save, rename/delete) → `chatStore.ts`.
- `prompt`/`compact` near-duplicates → `runTurn()`.
- `anchorCitations` → pure function in `lib/cite.ts` with an injected reader.
- The ~80-line `sessionUpdate` switch → a reducer `(items, streaming, update) → ops`, unit-testable without a process.
- Then test it with `tests/fixtures/stub-acp-agent.mjs`; today only one-off runs are covered.
- `tools.ts`: args extracted by hand (`argString`/`argInt`) can drift from `inputSchema`; tool names repeated in `brief()`, `describeTool` (`Construct.tsx`) and the `destructiveHint` check → export a `ToolName` union; optionally one file per tool group under `tools/`, formatting helpers in `toolFormat.ts`.
- `Construct.tsx` (739 lines): extract `ModelMenu`, `ConstructChats`, `ConstructItem` (+`describeTool`), `ConstructMarkdown`, and a `useBump` hook. (presentational, low risk)

### F. Shared wire types (S, very low)
- The construct route's `Action` union vs `useConstruct.ts`'s `post()` bodies typed `Record<string, unknown>`.
- The quick route's untyped lines vs `QuickAnswer.tsx`'s own `Line` type (imports do this right: `ImportEvent`).
- `ndjsonResponse`'s `send(value: unknown)` could be generic; `ConstructState.agent`/`AgentModels.agent` as a client-safe `AgentId`.
- `describeContext` (`session.ts`) and the quick route format selection/paragraph twice.

### G. Split `lib/docs.ts` (638 lines) (M, medium)
`lib/store/{core,projects,codex,cover,spots,chats}.ts`, with `docs.ts` as a barrel re-exporting them so imports don't change. All must share one queue. `renameDoc` returns string codes while siblings return boolean/null: one `Result` type would suit the route helper.

### H. Small UI pieces (S, low)
- `<ConfirmRow>`: the Keep/Delete confirm row is copied in History, Codex, Shelves, BookSettings.
- `useDismiss(ref, close)` (outside click / Escape) copied in EditorMenu, WordStats, Construct, Shelves; `useCloseOnEdit(editor, close)` in QuickAnswer and WordTools' LookUp.
- `<SettingsSection icon title>`: the `lock-head`/`lock-text`/`lock-actions` markup is reused by six settings screens (and the CSS name no longer means anything).
- `safeStorage.get/set/remove`: 7+ copies of localStorage try/catch.

## Tests and tooling
- No test can load `docs.ts`, `versions.ts`, `auth.ts`, `library.ts`, `tools.ts`, `session.ts` or any route: `server-only` and the `@/` alias block Node's runner. Fix with a loader/`--conditions=react-server` or by splitting I/O cores out of the server-only wrappers (~½ day). Most valuable: `writeDoc` (409 on stale, session-gap snapshot), version pruning at 30, `restoreVersion`, `renameDoc`, migration, the export whitelist (must exclude `.pen-auth.json`), `edit_codex_entry`'s match-once rule, `mcp.ts` JSON-RPC.
- Pure modules with no tests: done for `textdiff`, `cite`, `outline`, `quotes`, `text`. `passage` needs a DOM (EditorView); left.
- `npm run typecheck` added. Still no lint, no CI, no component or browser tests.

## CSS (`app/globals.css`, 3927 lines)
- ~40 banner sections in chronological order; shared primitives live in unrelated sections (`.btn` defined in Library and again in Welcome, `.btn-danger` duplicates `.library-confirm-actions button.danger`, `.dropdown` under Shelf).
- 13 unrelated z-index values (0–71), no scale → `--z-*` tokens.
- Breakpoints written by hand 19× and again in `Pen.tsx`.
- `font-size: 10.5px` ×18 and the mono-uppercase label pattern → a shared class or tokens.
- Dead CSS: essentially only `.drawer-action`. `is-confirming` is set in TSX but has no CSS.
- Split into ~8 plain files imported from `app/layout.tsx` in the current order (2–3 h, low risk). Skip CSS Modules: classes are shared across components, some built in HTML strings, ProseMirror needs `:global`.

## AGENTS.md
Mostly accurate (8 numeric claims checked). The renames bullet ends with a mis-pasted, stale route-map fragment; the export bullet's whitelist omits `.pen-construct.json`. The real problem is format: one huge bullet list (Construct alone ~2.5 KB in one bullet). Splitting it into per-feature docs with a short index would make drift easier to catch.

## Suggested order
1. ~~**Quick wins**~~: done (the bugs, `lib/queue.ts`, `lib/ids.ts`, `npm run typecheck`, tests for the pure modules).
2. **Foundations**: B, A, F, and making server modules testable, so the big moves have a net.
3. **The big files**: C, then D + E, then G.
4. **Any time**: H, the CSS split, restructuring AGENTS.md.
