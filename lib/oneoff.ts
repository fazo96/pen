import type { Client, ContentBlock } from "@agentclientprotocol/sdk";
import { type AgentLaunch, type AgentProcess, initialize, isNotice, modelOption, optionValues, spawnAgent, startupInfoOf } from "./acp.ts";

// One question, one answer, from a fresh ACP agent (Construct's Claude Code
// or pi, with no tools): transcribing a note, a look-up button's question.
// Nothing here touches Construct's chats. Imports nothing from pen but
// ./acp.ts, so tests load it with plain Node and a stub agent.

export type { AgentLaunch };

/**
 * Self-hosted models can take minutes to load before they say a word, so
 * there's no limit on silence, only on the whole run.
 */
const TIMEOUT_MS = 20 * 60_000;

export type OneOff = {
  launch: AgentLaunch;
  prompt: ContentBlock[];
  /** A value of the agent's model picker; the agent's default when unset or not offered. */
  model?: string;
  /** Each piece of the answer as it arrives. */
  onText?: (text: string) => void;
  /** Each piece of the agent's thinking (a reasoning model's), which isn't part of the answer. */
  onThought?: (text: string) => void;
  signal?: AbortSignal;
};

export class TimeoutError extends Error {
  constructor() {
    super("the agent took too long");
  }
}

// It has no tools to ask about; refuse whatever it asks anyway.
const refuse: Client["requestPermission"] = async (p) => {
  const reject = p.options.find((o) => o.kind.startsWith("reject"));
  return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
};

/** Ask a fresh agent once; resolves to its whole answer. */
export async function runOnce({ launch, prompt, model, onText, onThought, signal }: OneOff): Promise<string> {
  signal?.throwIfAborted();
  let reply = "";
  let sessionId = "";
  let asking = false;
  /** pi-acp says hello (its version, startup info) as if it were the answer. */
  let startupInfo: string | null = null;
  return withAgent(
    launch,
    {
      requestPermission: refuse,
      sessionUpdate: async ({ sessionId: sid, update: u }) => {
        if (sid !== sessionId || !asking) return;
        if (u.sessionUpdate === "agent_thought_chunk" && u.content.type === "text") return onThought?.(u.content.text);
        if (u.sessionUpdate !== "agent_message_chunk" || u.content.type !== "text") return;
        if (isNotice(u._meta) || u.content.text === startupInfo) return;
        reply += u.content.text;
        onText?.(u.content.text);
      },
    },
    {
      timeoutMs: TIMEOUT_MS,
      signal,
      beforeStop: (agent) => {
        if (sessionId && agent.alive()) agent.conn.cancel({ sessionId }).catch(() => {});
      },
    },
    async ({ conn }) => {
      const init = await initialize(conn);
      if (prompt.some((b) => b.type === "image") && !init.agentCapabilities?.promptCapabilities?.image) {
        throw new Error("the agent can't read images");
      }
      const session = await conn.newSession({ cwd: launch.cwd, mcpServers: [], _meta: launch.sessionMeta });
      sessionId = session.sessionId;
      startupInfo = startupInfoOf(session._meta);
      const picker = modelOption(session.configOptions);
      if (model && picker && optionValues(picker).includes(model) && picker.currentValue !== model) {
        await conn.setSessionConfigOption({ sessionId, configId: picker.id, value: model });
      }
      asking = true;
      const res = await conn.prompt({ sessionId, prompt });
      if (res.stopReason === "refusal") throw new Error("the agent declined to answer");
      if (res.stopReason === "cancelled") throw new Error("the agent stopped");
      if (!reply.trim()) throw new Error("the agent gave no answer");
      return reply;
    },
  );
}

/** The models an agent offers (its model picker), from a session opened and closed right away. */
export async function probeModels(launch: AgentLaunch): Promise<{ value: string; name: string }[]> {
  return withAgent(launch, { requestPermission: refuse, sessionUpdate: async () => {} }, { timeoutMs: 60_000 }, async ({ conn }) => {
    await initialize(conn);
    const session = await conn.newSession({ cwd: launch.cwd, mcpServers: [], _meta: launch.sessionMeta });
    const picker = modelOption(session.configOptions);
    return (picker?.options.flatMap((o) => ("group" in o ? o.options : [o])) ?? []).map(({ value, name }) => ({ value, name }));
  });
}

/**
 * Start the agent, run `fn` against it, stop it. Its exit, the timeout
 * (`launch.timeoutMs`, else `timeoutMs`) or `signal` fail the run.
 */
async function withAgent<T>(
  launch: AgentLaunch,
  client: Client,
  { timeoutMs, signal, beforeStop }: { timeoutMs: number; signal?: AbortSignal; beforeStop?: (agent: AgentProcess) => void },
  fn: (agent: AgentProcess) => Promise<T>,
): Promise<T> {
  const agent = await spawnAgent(launch, client);
  const detail = () => (agent.stderrTail() ? `: ${agent.stderrTail()}` : "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const failed = new Promise<never>((_, reject) => {
    void agent.exited.then((why) => reject(new Error(`the agent ${why}${detail()}`)));
    timer = setTimeout(() => reject(new TimeoutError()), launch.timeoutMs ?? timeoutMs);
    onAbort = () => reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      fn(agent).catch(async (err) => {
        // A crash reaches the connection ("closed") before the exit: say why it exited instead.
        await Promise.race([failed, new Promise((r) => setTimeout(r, 500))]);
        throw err;
      }),
      failed,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    failed.catch(() => {}); // the exit we cause below isn't news
    beforeStop?.(agent);
    agent.stop();
  }
}
