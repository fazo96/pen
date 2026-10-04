// Construct's wire format between the server session and the panel.

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentId } from "./agentInfo.ts";

/** pen's tools, as Construct's agent calls them (served by ./tools.ts, described in the panel by Construct.tsx). */
export type ToolName =
  | "outline"
  | "read_manuscript"
  | "search"
  | "grammar_check"
  | "list_versions"
  | "read_version"
  | "diff_versions"
  | "list_codex"
  | "read_codex_entry"
  | "create_codex_entry"
  | "edit_codex_entry"
  | "write_codex_entry"
  | "rename_codex_entry"
  | "delete_codex_entry";

export type PromptContext = {
  /** Codex entry open in the editor; absent for the manuscript. */
  entry?: string;
  /** Text the writer had selected, if any. */
  selection?: string;
  /** The paragraph the selection sits in, when it's part of one. */
  paragraph?: string;
};

export type ChatItem =
  | { id: string; type: "user"; text: string; context?: PromptContext }
  | { id: string; type: "agent" | "thought"; text: string }
  | {
      id: string;
      type: "tool";
      /** Pen tool name without the MCP prefix (e.g. "edit_codex_entry"), or the agent's own. */
      name?: string;
      title: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      input?: Record<string, string>;
    }
  | { id: string; type: "plan"; entries: { content: string; status: string }[] }
  | { id: string; type: "notice"; text: string; tone: "info" | "error" }
  | {
      id: string;
      /** The agent summarized the conversation so far to make room in its context. */
      type: "compaction";
      status: "in_progress" | "completed" | "failed" | "cancelled";
      /** What it kept, as markdown. */
      summary?: string;
      error?: string;
      /** The writer asked for it; otherwise the agent did it on its own. */
      manual?: boolean;
    };

/** How full the agent's context window is, in tokens. */
export type ContextUsage = { used: number; size: number };

export type ChatMeta = { id: string; title: string; created: number; updated: number };

export type ConstructState = {
  agent: AgentId;
  /** The conversation shown, and the stored ones (newest first). */
  chatId: string;
  chats: ChatMeta[];
  status: "idle" | "starting" | "ready" | "busy" | "error";
  error?: string;
  /** Model / effort pickers the agent offers. */
  config: SessionConfigOption[];
  /** The agent's latest reading for the chat shown, once there is one. */
  context?: ContextUsage;
};

export type ConstructEvent =
  | { t: "snapshot"; items: ChatItem[]; state: ConstructState }
  | { t: "item"; item: ChatItem }
  | { t: "append"; id: string; text: string }
  | { t: "state"; state: ConstructState }
  | { t: "codex"; change: { entry: string; action: string; to?: string } };

/** What the panel asks of the session (POST /api/docs/<id>/construct); replies come over the event stream. */
export type ConstructAction =
  | { action: "start" }
  | { action: "switch"; agent: string; model?: string }
  | { action: "prompt"; text: string; context?: PromptContext }
  | { action: "compact" }
  | { action: "cancel" }
  | { action: "reset" }
  | { action: "open-chat"; chatId: string }
  | { action: "delete-chat"; chatId: string }
  | { action: "rename-chat"; chatId: string; title: string }
  | { action: "config"; configId: string; value: string };

/** A quick question's answer (POST /api/docs/<id>/construct/quick), as JSON lines. */
export type QuickLine = { t: "text"; text: string } | { t: "done" } | { t: "error"; error: string };
