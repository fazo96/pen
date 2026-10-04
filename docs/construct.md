# Construct

The AI side panel, and the one-off questions that use the same agents.

## Pieces

Construct (`lib/construct/`, `components/Construct.tsx`, with `ConstructItem` (one transcript item; what each of pen's tools did, by `ToolName`), `ConstructChats`, `ConstructModelMenu` and `ConstructMarkdown`): the AI side panel.

`session.ts` drives a chat's agent and streams the conversation to the panel over SSE (`/api/docs/[id]/construct`). The transcript and how the agent's session updates change it are `transcript.ts`, and the stored chat's shape and title `chats.ts` (both pure and unit-tested); what the agent is told (system prompts, the writer's place and selection with each message) is `prompts.ts`, and what goes over the wire (events, `ConstructAction`, `QuickLine`) `types.ts`.

## When AI is on

AI features (Construct, quick actions, transcribing notes) are off unless an agent is found when the server starts (`lib/construct/detect.ts`, looked for once per process): Claude Code by its command (`PEN_CLAUDE`, else `claude`) or a credential it can use (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `.credentials.json` in `CLAUDE_CONFIG_DIR` or `~/.claude`), pi by its command; `PEN_AI=off` keeps them off. Pages pass `ai` to `Pen`, which then hides Construct, its buttons, commands and shortcut, and the Codex stops taking photos; the routes answer 503 (`aiOffResponse`) and `/settings` says what to install. A model setting or chat whose agent is missing falls back to the first one found (`fallbackAgent`).

## Agents

The server spawns an ACP agent per project (`agents.ts`: Claude Code via `@agentclientprotocol/claude-agent-acp`, run with `npx`); chats and one-off runs both start their agent with `spawnAgent` (`lib/acp.ts`: the process, its stderr tail, the handshake, stopping it), from the launch `launchFor` builds out of the agent's preset. A preset (`AGENTS` in `agents.ts`) holds everything agent-specific on the server; the names the browser shows are in `agentInfo.ts`.

## Tools

The agent's built-in tools are all off; It only gets pen's tools (`tools.ts`: manuscript/versions read-only, Codex read-write, `grammar_check`) from a small MCP endpoint, `/api/construct/mcp`, authenticated by a per-session bearer token (exempt from the lock proxy). There is deliberately no tool that writes the manuscript.

## Chats

Chats are stored in `<project>/construct/<chat>.json` (transcript + the agent's session id) and resumed with ACP `session/resume` after a restart. A chat's title is the writer's name for it (renamed from the Chats list), else the one Claude Code gives the session (`session_info_update`), else the first message's opening. Under the header, one line holds the model/effort pickers (behind a popover) and how full the agent's context is (ACP `usage_update`, kept in the chat file since a resume doesn't resend it) with a Compact button (and palette command) that sends Claude Code's `/compact` as the whole prompt; pen advertises the `session.compaction` client capability, so compactions, automatic or not, arrive as `compaction_update`s and show in the log with their summary.

## pi

The agent can also be pi (`AGENTS.pi`, offered only when `pi` runs on the server, `PEN_PI` names it), through the off-the-shelf `pi-acp` (run with `npx`). pi-acp ignores ACP's MCP servers and can't pass pi flags, so it runs `scripts/pi-construct` (`PI_ACP_PI_COMMAND`), which adds pen's lockdown (no skills, prompt templates or AGENTS.md; pen's system prompt from `PEN_SYSTEM_PROMPT`; `--tools` allowing only pen's tools, or `--no-tools` for one-off runs) and loads the off-the-shelf `pi-mcp-adapter` extension (a pen dependency) with a `--mcp-config` file written in the agent's folder (bearer token from `PEN_MCP_TOKEN`); its tools are named `mcp__pen_<tool>` (`penToolName` also takes pi 1.0's `mcp__pen__<tool>`). The writer's own pi extensions still load: self-hosted model providers live there. A chat stays on the agent it was started on (stored in the chat file) and switching chats switches the process; pi chats come back after a restart with `session/load`, whose replay is ignored, and pi-acp's hello and extension notices (sent as message text) are dropped.

## Models

The model picker lists every agent's models (`/api/construct/models`, each agent started once and asked, kept 10 min); another agent's model starts a new chat (`switch` action). Default models (`lib/construct/models.ts`, refs like `pi:namyra/x`) for new chats, transcribing notes and quick actions live in `PEN_DIR/.pen-construct.json` (`/api/construct/settings`, the Construct section of `/settings`, included in exports); unset is Claude Code's default, and an agent that can't run falls back to it.

## One-off runs and quick actions

One-off runs (`lib/oneoff.ts`, `lib/construct/ask.ts`: a fresh agent with no tools, one prompt, the model picked through ACP's model option) have no silence limit, only 20 min overall, since a self-hosted model may take minutes to load; their routes answer as JSON lines with a newline every 20 s (`lib/ndjson.ts`) so nginx's 60 s idle timeout never cuts them. Quick actions (Synonyms, Meaning, the grammar popover's Ask Construct) are one-off: `POST /api/docs/<id>/construct/quick` streams the answer into `components/QuickAnswer.tsx`, a popover over the selection (offered synonyms become buttons, `alternativesIn`), with Continue in Construct sending the same question to the chat; closing it stops the run.

## Citations

Citations (`lib/cite.ts`, `lib/passage.ts`): Construct links passages as `pen:L120`, `pen:L120-L134`, `pen:v/<version>/L40` or `pen:codex/<entry>`; the panel renders them as chips. When a turn ends, the session adds the cited lines' opening words (`?q=`, `?qe=`) to the stored transcript only (the agent's own history is untouched), and a click finds the passage by that text first, the line number second. From a Codex entry's page a click goes to `/d/<id>?cite=…`.

## grammar_check

Construct's `grammar_check` (`lib/construct/grammarCheck.ts`) checks the saved manuscript (or a Codex entry, a heading or a line range) the way the editor does: markdown parsed into the editor's document, `textBlocks`, the library's grammar settings, flags from `lib/grammarServer.ts` (so paragraphs the editor checked are cached for it, and the other way round); each block is matched to its markdown line by its opening words (`blockLines`, `lineOf` in `lib/grammarText.ts`) for `pen:L` citations.
