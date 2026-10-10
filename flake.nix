{
  description = "pen: a mobile-first markdown editor for fiction";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      # Claude Code (Construct's Claude agent runs it) is unfree.
      unfreePkgs =
        system:
        import nixpkgs {
          inherit system;
          config.allowUnfreePredicate = pkg: nixpkgs.lib.getName pkg == "claude-code";
        };
    in
    {
      # pen and the agents it pins, from any nixpkgs (the NixOS module uses
      # the system's).
      lib.packagesFor =
        pkgs:
        let
          claude-agent-acp = pkgs.callPackage ./nix/claude-agent-acp.nix { };
          pi-acp = pkgs.callPackage ./nix/pi-acp.nix { };
        in
        {
          inherit claude-agent-acp pi-acp;
          pen = pkgs.callPackage ./nix/package.nix { inherit claude-agent-acp pi-acp; };
        };

      packages = nixpkgs.lib.genAttrs [ "x86_64-linux" "aarch64-linux" ] (
        system:
        let
          p = self.lib.packagesFor (unfreePkgs system);
        in
        p // { default = p.pen; }
      );

      nixosModules.default = import ./nix/module.nix { inherit self; };

      devShells = forAllSystems (
        pkgs:
        {
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
        }
      );

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
