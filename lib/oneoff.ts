import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";

// One question, one answer, from a fresh ACP agent (Construct's Claude Code
// or pi, with no tools): transcribing a note, a look-up button's question.
// Nothing here touches Construct's chats. Imports nothing from pen, so tests
// load it with plain Node and a stub agent.

/**
 * Self-hosted models can take minutes to load before they say a word, so
 * there's no limit on silence, only on the whole run.
 */
const TIMEOUT_MS = 20 * 60_000;

export type AgentLaunch = {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  /** `_meta` for session/new (the agent's system prompt and lockdown options). */
  sessionMeta?: Record<string, unknown>;
  timeoutMs?: number;
};

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

/** Ask a fresh agent once; resolves to its whole answer. */
export async function runOnce({ launch, prompt, model, onText, onThought, signal }: OneOff): Promise<string> {
  signal?.throwIfAborted();
  await mkdir(launch.cwd, { recursive: true });
  const [cmd, ...args] = launch.command;
  const child = spawn(cmd, args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr.push(...chunk.split("\n").filter(Boolean));
    if (stderr.length > 20) stderr.splice(0, stderr.length - 20);
  });
  const detail = () => (stderr.length ? `: ${stderr.slice(-3).join(" · ")}` : "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const failed = new Promise<never>((_, reject) => {
    child.on("error", (err) => reject(new Error(`couldn't start the agent (${err.message})`)));
    child.on("exit", (code, signal) => reject(new Error(`the agent exited (${signal ?? code})${detail()}`)));
    timer = setTimeout(() => reject(new TimeoutError()), launch.timeoutMs ?? TIMEOUT_MS);
    onAbort = () => reject(signal!.reason ?? new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });
  });

  let reply = "";
  let sessionId = "";
  let asking = false;
  /** pi-acp says hello (its version, startup info) as if it were the answer. */
  let startupInfo: string | null = null;
  const client: Client = {
    // It has no tools to ask about; refuse whatever it asks anyway.
    requestPermission: async (p) => {
      const reject = p.options.find((o) => o.kind.startsWith("reject"));
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    },
    sessionUpdate: async ({ sessionId: sid, update: u }) => {
      if (sid !== sessionId || !asking) return;
      if (u.sessionUpdate === "agent_thought_chunk" && u.content.type === "text") return onThought?.(u.content.text);
      if (u.sessionUpdate !== "agent_message_chunk" || u.content.type !== "text") return;
      if (isNotice(u._meta) || u.content.text === startupInfo) return;
      reply += u.content.text;
      onText?.(u.content.text);
    },
  };

  let conn: ClientSideConnection | null = null;
  try {
    conn = new ClientSideConnection(
      () => client,
      ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      ),
    );
    const c = conn;
    const run = async () => {
      const init = await c.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "pen", version: "0.1.0" },
      });
      if (prompt.some((b) => b.type === "image") && !init.agentCapabilities?.promptCapabilities?.image) {
        throw new Error("the agent can't read images");
      }
      const session = await c.newSession({ cwd: launch.cwd, mcpServers: [], _meta: launch.sessionMeta });
      sessionId = session.sessionId;
      startupInfo = startupInfoOf(session._meta);
      const picker = modelOption(session.configOptions);
      if (model && picker && optionValues(picker).includes(model) && picker.currentValue !== model) {
        await c.setSessionConfigOption({ sessionId, configId: picker.id, value: model });
      }
      asking = true;
      const res = await c.prompt({ sessionId, prompt });
      if (res.stopReason === "refusal") throw new Error("the agent declined to answer");
      if (res.stopReason === "cancelled") throw new Error("the agent stopped");
      if (!reply.trim()) throw new Error("the agent gave no answer");
      return reply;
    };
    return await Promise.race([
      run().catch(async (err) => {
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
    if (sessionId && child.exitCode === null) conn?.cancel({ sessionId }).catch(() => {});
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    }
  }
}

/** The agent's model picker, if it has one. */
export const modelOption = (options: SessionConfigOption[] | null | undefined) =>
  options?.find((o): o is Extract<SessionConfigOption, { type: "select" }> => o.type === "select" && o.category === "model");

export const optionValues = (o: Extract<SessionConfigOption, { type: "select" }>) =>
  o.options.flatMap((opt) => ("group" in opt ? opt.options : [opt])).map((opt) => opt.value);

/** pi-acp's extension notices ("MCP: 1 servers connected") come as message text, marked in `_meta`. */
export const isNotice = (meta: unknown) => !!(meta as { piAcp?: { notify?: unknown } } | null)?.piAcp?.notify;

/** The text pi-acp is about to send as a message of its own when a session opens. */
export function startupInfoOf(meta: unknown): string | null {
  const text = (meta as { piAcp?: { startupInfo?: unknown } } | null)?.piAcp?.startupInfo;
  return typeof text === "string" ? text : null;
}

/** The models an agent offers (its model picker), from a session opened and closed right away. */
export async function probeModels(launch: AgentLaunch): Promise<{ value: string; name: string }[]> {
  const models: { value: string; name: string }[] = [];
  await runSession(launch, async (conn) => {
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {}, clientInfo: { name: "pen", version: "0.1.0" } });
    const session = await conn.newSession({ cwd: launch.cwd, mcpServers: [], _meta: launch.sessionMeta });
    const picker = modelOption(session.configOptions);
    for (const opt of picker?.options.flatMap((o) => ("group" in o ? o.options : [o])) ?? []) {
      models.push({ value: opt.value, name: opt.name });
    }
  });
  return models;
}

/** Start the agent, run `fn` against it, stop it; the agent's exit or the timeout fail it. */
async function runSession(launch: AgentLaunch, fn: (conn: ClientSideConnection) => Promise<void>) {
  await mkdir(launch.cwd, { recursive: true });
  const [cmd, ...args] = launch.command;
  const child = spawn(cmd, args, { cwd: launch.cwd, env: { ...process.env, ...launch.env }, stdio: ["pipe", "pipe", "ignore"] });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_, reject) => {
    child.on("error", (err) => reject(new Error(`couldn't start the agent (${err.message})`)));
    child.on("exit", (code, signal) => reject(new Error(`the agent exited (${signal ?? code})`)));
    timer = setTimeout(() => reject(new TimeoutError()), launch.timeoutMs ?? 60_000);
  });
  const conn = new ClientSideConnection(
    () => ({ requestPermission: async () => ({ outcome: { outcome: "cancelled" } }), sessionUpdate: async () => {} }),
    ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    ),
  );
  try {
    await Promise.race([fn(conn), failed]);
  } finally {
    clearTimeout(timer);
    failed.catch(() => {});
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    }
  }
}
