# Working on pen

How to run, build and stop things here without disturbing the writer's own pen. The tests are in [testing.md](testing.md).

## The writer's data

**Never write to `data/`.** It holds the user's real manuscripts, and they often write in the running server while you work. Test against a throwaway library instead, built outside this checkout (see below): `PEN_DIR=<scratch dir> PEN_CACHE_DIR=<scratch dir> next start -p 3001`.

## The running server

The user's pen usually runs from this checkout as a production build on port 3000 (`npm start`), public as pen.trippy.pizza behind nginx. Leave it running, and **don't run `next build` here**: it rewrites the `.next` that server is using. Build in a scratch worktree instead (`git worktree add <dir>`, copy the working-tree changes in, `cp -a --reflink=auto node_modules <dir>/`; Turbopack rejects a symlinked `node_modules`), and `git worktree remove` it afterwards.

## Stopping servers you started

When stopping a background server with `pkill -f`, pick a pattern that won't also match the shell running the `pkill` command. A running `next start` renames its process to `next-server (v…)`, so `pkill -f "next start"` misses it; find yours by working directory instead (`readlink /proc/<pid>/cwd` for each `pgrep -f next-server`), since the user's server on port 3000 shows up under the same name.

## Node

Node isn't on PATH (NixOS): `nix develop` gives a shell with Node 24 and `node_modules/.bin` on PATH (or one-off: `nix develop --command npx ...`).

## Fonts

Fonts (Literata, JetBrains Mono) come from npm (`@fontsource-variable/*`, imported in `app/layout.tsx`, named in `app/styles/base.css`), not `next/font/google`, so a build never needs to reach Google.

## Docker

Docker: `Dockerfile` builds with `PEN_STANDALONE=1`, which turns on `output: "standalone"` in `next.config.ts` (left off otherwise, since `next start` warns about it). The image keeps everything, Construct's agent state included (`CLAUDE_CONFIG_DIR=/data/.claude`), in the `/data` volume, and the cache in `/cache` (`PEN_CACHE_DIR`; the README suggests a volume).
