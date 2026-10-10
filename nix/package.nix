# pen as `next start` serves it: the build, its node_modules and scripts/ in
# lib/pen (Construct runs scripts/pi-construct and pi-mcp-adapter from there),
# with Construct's agents pinned in the wrapper. The library and cache come
# from PEN_DIR and PEN_CACHE_DIR: lib/pen is read-only.
{
  lib,
  buildNpmPackage,
  importNpmLock,
  nodejs_24,
  makeWrapper,
  claude-code,
  pi-coding-agent,
  claude-agent-acp,
  pi-acp,
}:

let
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference ../. (
      lib.fileset.unions [
        ../nix
        ../flake.nix
        ../flake.lock
        ../e2e
        ../tests
        ../design
        ../docs
      ]
    );
  };
in
buildNpmPackage {
  pname = "pen";
  version = (lib.importJSON ../package.json).version;
  inherit src;

  nodejs = nodejs_24;
  npmDeps = importNpmLock { npmRoot = src; };
  npmConfigHook = importNpmLock.npmConfigHook;

  nativeBuildInputs = [ makeWrapper ];

  env.NEXT_TELEMETRY_DISABLED = "1";

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --no-save
    mkdir -p $out/lib/pen $out/bin
    cp -r .next node_modules public scripts package.json next.config.ts $out/lib/pen/
    rm -rf $out/lib/pen/.next/cache

    makeWrapper ${lib.getExe nodejs_24} $out/bin/pen \
      --chdir $out/lib/pen \
      --add-flags $out/lib/pen/node_modules/next/dist/bin/next \
      --add-flags start \
      --set-default NODE_ENV production \
      --set-default NEXT_TELEMETRY_DISABLED 1 \
      --set-default PEN_CLAUDE ${lib.getExe claude-code} \
      --set-default PEN_CONSTRUCT_CLAUDE ${lib.getExe claude-agent-acp} \
      --set-default PEN_PI ${lib.getExe pi-coding-agent} \
      --set-default PEN_CONSTRUCT_PI ${lib.getExe pi-acp}

    runHook postInstall
  '';

  meta = {
    description = "A mobile-first markdown editor for fiction";
    homepage = "https://github.com/fazo96/pen";
    license = lib.licenses.agpl3Plus;
    mainProgram = "pen";
  };
}
