{
  description = "pen: a mobile-first markdown editor for fiction";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Node for Next.js (npm/npx also launch Construct's agent,
        # @agentclientprotocol/claude-agent-acp).
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_24 ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
          '';
        };
      }
      // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
        # The browser tests (npm run test:e2e): the same, plus a Chromium for
        # Playwright, since the browsers it downloads don't run on NixOS. Linux
        # only: nixpkgs has no Chromium for macOS (there, `npx playwright install`).
        e2e = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24
            pkgs.chromium
          ];
          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            export PEN_E2E_CHROMIUM=${pkgs.chromium}/bin/chromium
          '';
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
