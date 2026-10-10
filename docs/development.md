# Working on pen

How to run, build and stop things here without disturbing the writer's own pen. The tests are in [testing.md](testing.md).

## The writer's data

**Never write to the user's library**, `/mnt/Data/Server/pen` on the server: it holds their real manuscripts, and they often write in the running server while you work. Test against a throwaway library instead: `PEN_DIR=<scratch dir> PEN_CACHE_DIR=<scratch dir> next start -p 3001`. (`./data` is only the default `PEN_DIR`; it's empty here.)

## The running server

The user's pen runs as the NixOS service `pen` (`services.pen` in the dotfiles repo, `devices/ada.nix`) on port 3000, public as pen.trippy.pizza behind nginx. It's built from `main` on GitHub, not from this checkout, so `next build` here doesn't touch it. Leave the service alone: don't stop, restart or redeploy it.

### Redeploying

**The user deploys; agents don't.** Commit and push to `main`; when a change is ready, tell the user it needs a redeploy. For the user's reference, in the dotfiles repo: `nix flake update pen`, then `sudo nixos-rebuild switch --flake .#ada`. The service restarts on the new build; `journalctl -u pen` shows its log.

## Nix

`flake.nix` gives the dev shells, `packages.default` (`nix build`) and `nixosModules.default` (`services.pen`). The recipes are in `nix/`:

- `package.nix` builds pen with `npm run build` and installs the build, `node_modules`, `public/` and `scripts/` (Construct runs `scripts/pi-construct` and `node_modules/pi-mcp-adapter` from pen's working directory) into a read-only `lib/pen`. `bin/pen` runs `next start` there, with the library and cache from `PEN_DIR` and `PEN_CACHE_DIR`. Dependencies come straight from `package-lock.json` (`importNpmLock`), so no hash needs updating when they change.
- `claude-agent-acp.nix` and `pi-acp.nix` package Construct's agents at the versions `lib/construct/agents.ts` pins. `bin/pen` points `PEN_CONSTRUCT_CLAUDE`, `PEN_CONSTRUCT_PI`, `PEN_CLAUDE` and `PEN_PI` at them (and at nixpkgs' Claude Code and pi). **When you bump an agent in `agents.ts`, bump it here too**: set the new version, replace both hashes with `lib.fakeHash`, and `nix build .#claude-agent-acp` (or `.#pi-acp`) twice, copying the `got:` hash each time.
- `module.nix` is the service: it runs as `services.pen.user` with that user's home, so Construct's agents find its Claude Code login and pi settings (pi's models, `~/.pi/agent`).

`nix build` (or `nix build .#pen`) checks the package builds; run `result/bin/pen -p 3001` with scratch `PEN_DIR` and `PEN_CACHE_DIR` to try it.

## Stopping servers you started

When stopping a background server with `pkill -f`, pick a pattern that won't also match the shell running the `pkill` command. A running `next start` renames its process to `next-server (v…)`, so `pkill -f "next start"` misses it; find yours by working directory instead (`readlink /proc/<pid>/cwd` for each `pgrep -f next-server`), since the user's service on port 3000 shows up under the same name (its working directory is in `/nix/store`).

## Node

Node isn't on PATH (NixOS): `nix develop` gives a shell with Node 24 and `node_modules/.bin` on PATH (or one-off: `nix develop --command npx ...`).

## The service worker

`public/sw.js` ([editor](editor.md#offline)) registers only in production builds, so `next dev` never runs it unless localStorage `pen:sw` is `1`. A browser keeps it until it fetches a changed `sw.js` (it checks on every page load). If a bad one ever wedges the app, publish a `sw.js` that unregisters itself (`self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", (e) => e.waitUntil(self.registration.unregister().then(() => caches.keys()).then((ks) => Promise.all(ks.map((k) => caches.delete(k)))))));`), or clear the site's data in the browser.

## Fonts

Fonts (Literata, JetBrains Mono) come from npm (`@fontsource-variable/*`, imported in `app/layout.tsx`, named in `app/styles/base.css`), not `next/font/google`, so a build never needs to reach Google.

## Docker

Docker: `Dockerfile` builds with `PEN_STANDALONE=1`, which turns on `output: "standalone"` in `next.config.ts` (left off otherwise, since `next start` warns about it). The image keeps everything, Construct's agent state included (`CLAUDE_CONFIG_DIR=/data/.claude`), in the `/data` volume, and the cache in `/cache` (`PEN_CACHE_DIR`; the README suggests a volume).
