# The version lib/construct/agents.ts pins (nixpkgs' lags behind); the same
# recipe as nixpkgs' claude-agent-acp, which uses nixpkgs' Claude Code.
{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  makeWrapper,
  claude-code,
}:

buildNpmPackage (finalAttrs: {
  pname = "claude-agent-acp";
  version = "0.84.0";

  src = fetchFromGitHub {
    owner = "agentclientprotocol";
    repo = "claude-agent-acp";
    tag = "v${finalAttrs.version}";
    hash = "sha256-9BbbkvdhWejAfCFvyRnFVMWKcpQ6lWOOBj+KI31ypww=";
  };

  npmDepsHash = "sha256-GQJy5ey+B/ehKqH6M5ts1yuCcpW/dibB+SVyzLhNCHs=";

  nativeBuildInputs = [ makeWrapper ];

  postInstall = ''
    wrapProgram $out/bin/claude-agent-acp \
      --set-default CLAUDE_CODE_EXECUTABLE ${lib.getExe claude-code}
  '';

  meta = {
    description = "ACP-compatible coding agent powered by the Claude Agent SDK";
    homepage = "https://github.com/agentclientprotocol/claude-agent-acp";
    license = lib.licenses.asl20;
    mainProgram = "claude-agent-acp";
  };
})
