import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  type Client,
  type ClientCapabilities,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk";

// Talking to an ACP agent over stdio: starting one, saying hello, stopping it,
// and reading the bits of what it says that every caller needs. Construct's
// chats (lib/construct/session.ts) and one-off runs (lib/oneoff.ts) both start
// their agents here. Imports nothing from pen, so tests load it with plain Node.

export type AgentLaunch = {
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  /** `_meta` for session/new (the agent's system prompt and lockdown options). */
  sessionMeta?: Record<string, unknown>;
  timeoutMs?: number;
};

export type AgentProcess = {
  conn: ClientSideConnection;
  /** Resolves (never rejects) with why it ended: "exited (1)", "couldn't start (…)". */
  exited: Promise<string>;
  /** Its last few lines on stderr, " · "-joined; "" when it said nothing. */
  stderrTail: () => string;
  /** Still running. */
  alive: () => boolean;
  /** SIGTERM now, SIGKILL if it's still there 3 s later. */
  stop: () => void;
};

/** Start the agent in `launch.cwd` (made if missing) and connect `client` to it. */
export async function spawnAgent(launch: AgentLaunch, client: Client, keepLines = 20): Promise<AgentProcess> {
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
    if (stderr.length > keepLines) stderr.splice(0, stderr.length - keepLines);
  });
  let ended = false;
  const exited = new Promise<string>((resolve) => {
    child.on("error", (err) => resolve(`couldn't start (${err.message})`));
    child.on("exit", (code, signal) => resolve(`exited (${signal ?? code})`));
  });
  void exited.then(() => (ended = true));
  const conn = new ClientSideConnection(
    () => client,
    ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
    ),
  );
  const alive = () => !ended && child.exitCode === null;
  return {
    conn,
    exited,
    stderrTail: () => stderr.slice(-3).join(" · "),
    alive,
    stop: () => {
      if (!alive()) return;
      child.kill("SIGTERM");
      setTimeout(() => alive() && child.kill("SIGKILL"), 3000).unref();
    },
  };
}

/** ACP's handshake, as pen. */
export const initialize = (conn: ClientSideConnection, clientCapabilities: ClientCapabilities = {}) =>
  conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities, clientInfo: { name: "pen", version: "0.1.0" } });

/** The agent's model picker, if it has one. */
export const modelOption = (options: SessionConfigOption[] | null | undefined) =>
  options?.find((o): o is Extract<SessionConfigOption, { type: "select" }> => o.type === "select" && o.category === "model");

export const optionValues = (o: Extract<SessionConfigOption, { type: "select" }>) =>
  o.options.flatMap((opt) => ("group" in opt ? opt.options : [opt])).map((opt) => opt.value);

// pi-acp sends its own notices and a hello as message text; they're not the
// agent speaking. Other agents never set these marks.

/** pi-acp's extension notices ("MCP: 1 servers connected"), marked in `_meta`. */
export const isNotice = (meta: unknown) => !!(meta as { piAcp?: { notify?: unknown } } | null)?.piAcp?.notify;

/** The text pi-acp is about to send as a message of its own when a session opens. */
export function startupInfoOf(meta: unknown): string | null {
  const text = (meta as { piAcp?: { startupInfo?: unknown } } | null)?.piAcp?.startupInfo;
  return typeof text === "string" ? text : null;
}
