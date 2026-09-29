// Construct's wire format between the server session and the panel.

import type { SessionConfigOption } from "@agentclientprotocol/sdk";

export type PromptContext = {
  /** Codex entry open in the editor; absent for the manuscript. */
  entry?: string;
  /** Text the writer had selected, if any. */
  selection?: string;
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
  | { id: string; type: "notice"; text: string; tone: "info" | "error" };

export type ConstructState = {
  agent: string;
  status: "idle" | "starting" | "ready" | "busy" | "error";
  error?: string;
  /** Model / effort pickers the agent offers. */
  config: SessionConfigOption[];
};

export type ConstructEvent =
  | { t: "snapshot"; items: ChatItem[]; state: ConstructState }
  | { t: "item"; item: ChatItem }
  | { t: "append"; id: string; text: string }
  | { t: "state"; state: ConstructState }
  | { t: "codex"; change: { entry: string; action: string; to?: string } };
