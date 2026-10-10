<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# pen

A mobile-first WYSIWYG markdown editor for fiction. Next.js 16 (App Router) + Tiptap 3 with `@tiptap/markdown` (`contentType: "markdown"`, `editor.getMarkdown()`). Plain CSS in `app/styles/` (one file per part of the app, imported in order from `app/layout.tsx`; shared buttons and menus in `controls.css`, z-index layers and other tokens on `:root` in `base.css`); no UI kit.

## Before you change anything

- **Never touch the writer's library** (`/mnt/Data/Server/pen` on the server) or the running service: it's the writer's pen. Test against a scratch library and port ([development](docs/development.md)).
- The writer's pen is a NixOS service built from `main` on GitHub (`nix/`, used by the dotfiles repo), not this checkout: building here is fine. When a change needs a redeploy, say so; the user deploys it.
- Construct's agents are pinned twice: in `lib/construct/agents.ts` and in `nix/` (version and hashes). Change both together ([development](docs/development.md#nix)).
- Node comes from `nix develop`. Check your work with `npm test`, `npm run typecheck`, `npm run lint` and the browser suite ([testing](docs/testing.md)).
- Keep these docs true: when you change how something works, update its page below.

## Docs

| Page | What's in it |
| --- | --- |
| [docs/development.md](docs/development.md) | The writer's data, the running service and redeploying, Nix (the package, the module, pinned agents), stopping servers you started, Node, fonts, Docker |
| [docs/testing.md](docs/testing.md) | Unit tests (and loading server modules in them), the Playwright browser suite |
| [docs/library.md](docs/library.md) | The library on disk (`lib/docs.ts`, `lib/store/`): layout, the Global Codex, writing files safely, versions, renames, stats and export, the cache |
| [docs/api.md](docs/api.md) | `app/api/`: saves and conflicts, `route()` and its helpers |
| [docs/pages.md](docs/pages.md) | The pages, the library's shelves, the optional lock |
| [docs/editor.md](docs/editor.md) | The editor page: saving and its hooks, the writer's spot and the switch, headings, comments, quotes, quick switcher, find and replace, Look up |
| [docs/grammar.md](docs/grammar.md) | The grammar check (Harper on the server), its cache and settings |
| [docs/stats.md](docs/stats.md) | Writing stats: what a save counts as drafting or editing, `.pen-stats/`, `/stats` and the library's card |
| [docs/construct.md](docs/construct.md) | Construct, the AI panel: agents, tools, chats, pi, models, quick actions, citations |
| [docs/imports.md](docs/imports.md) | Importing into the Codex: Critique Circle crits, handwritten notes |
