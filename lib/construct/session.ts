import "server-only";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import {
  type Client,
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import { parseCitation, withSnippets } from "../cite";
import { agentHome, readChats, readDoc, readVersion, trashChat, writeChat } from "../docs";
import { titleOf } from "../text";
import type { CodexChange, ToolContext } from "./tools";
import { type AgentId, type AgentPreset, AGENTS, systemPrompt } from "./agents";
import type { ChatItem, ChatMeta, ConstructEvent, ConstructState, PromptContext } from "./types";

// One Construct conversation at a time per project, driving an ACP agent over
// stdio. Lives in the server process (on globalThis, so dev reloads keep it);
// the browser watches it through /api/docs/[id]/construct. Every chat is also
// stored in the project folder, with the agent's session id, so it can be
// picked up again after a restart (ACP session/resume).

const MCP_NAME = "pen";
const TOOL_PREFIX = `mcp__${MCP_NAME}__`;
const MAX_ITEMS = 400;
const SAVE_EVERY_MS = 1500;

/** A chat as stored in <project>/construct/<id>.json. */
type StoredChat = ChatMeta & { v: 1; agent: string; sessionId: string | null; seq: number; items: ChatItem[] };

const newChatId = () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

function isStoredChat(x: unknown): x is StoredChat {
  const c = x as StoredChat;
  return !!c && typeof c === "object" && c.v === 1 && typeof c.id === "string" && Array.isArray(c.items);
}

const metaOf = ({ id, title, created, updated }: ChatMeta): ChatMeta => ({ id, title, created, updated });

/** Keep only the small, displayable bits of a tool call's input. */
function brief(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const k of ["id", "new_id", "heading", "query", "name", "from_line", "to_line", "scope", "version", "from", "to"]) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v === "string" || typeof v === "number") out[k] = String(v).slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

class ConstructSession {
  readonly token = randomBytes(24).toString("base64url");
  private items: ChatItem[] = [];
  private state: ConstructState;
  private listeners = new Set<(e: ConstructEvent) => void>();
  private child: ChildProcess | null = null;
  private conn: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private starting: Promise<void> | null = null;
  private stderr: string[] = [];
  private cwd = "";
  private seq = 0;
  private running = false;
  /** The message or thought currently streaming, to append chunks to. */
  private streaming: { id: string; type: "agent" | "thought" } | null = null;
  /** The chat shown; `sessionId` is the agent's, kept to resume it later. */
  private chat: { id: string; created: number; sessionId: string | null };
  private canResume = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly loaded: Promise<void>;

  constructor(
    readonly projectId: string,
    private baseUrl: string,
  ) {
    this.chat = { id: newChatId(), created: Date.now(), sessionId: null };
    this.state = { agent: "claude", chatId: this.chat.id, chats: [], status: "idle", config: [] };
    this.loaded = this.load().catch((err) => console.error("construct: couldn't load chats", err));
  }

  // ─── Stored chats ───────────────────────────────────────────

  private async stored(): Promise<StoredChat[]> {
    const chats = (await readChats(this.projectId)).filter(isStoredChat);
    return chats.sort((a, b) => b.updated - a.updated);
  }

  /** Pick up where the newest stored chat left off. */
  private async load() {
    const chats = await this.stored();
    this.state = { ...this.state, chats: chats.map(metaOf) };
    if (chats[0]) this.adopt(chats[0]);
  }

  private adopt(c: StoredChat) {
    this.chat = { id: c.id, created: c.created, sessionId: c.sessionId };
    this.seq = c.seq;
    // A turn cut short by a restart leaves tools that will never finish.
    this.items = c.items.map((i) =>
      i.type === "tool" && (i.status === "pending" || i.status === "in_progress") ? { ...i, status: "failed" } : i,
    );
    this.streaming = null;
    this.state = { ...this.state, chatId: c.id };
  }

  private title() {
    const first = this.items.find((i) => i.type === "user");
    const text = first?.type === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
    return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text || "New chat";
  }

  /** Note a change: refresh the chat list now, write the file shortly. */
  private persist() {
    if (!this.items.length) return;
    const meta: ChatMeta = { id: this.chat.id, title: this.title(), created: this.chat.created, updated: Date.now() };
    const others = this.state.chats.filter((c) => c.id !== meta.id);
    const prev = this.state.chats.find((c) => c.id === meta.id);
    if (!prev || prev.title !== meta.title || this.state.chats[0]?.id !== meta.id) {
      this.setState({ chats: [meta, ...others] });
    } else {
      this.state.chats[0] = meta; // same order and title: no need to tell anyone
    }
    this.saveTimer ??= setTimeout(() => void this.save(), SAVE_EVERY_MS);
  }

  /** Write the current chat now (if it has anything in it). */
  private async save() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.items.length) return;
    const data: StoredChat = {
      v: 1,
      id: this.chat.id,
      title: this.title(),
      created: this.chat.created,
      updated: this.state.chats.find((c) => c.id === this.chat.id)?.updated ?? Date.now(),
      agent: this.state.agent,
      sessionId: this.chat.sessionId,
      seq: this.seq,
      items: this.items,
    };
    try {
      await writeChat(this.projectId, this.chat.id, data);
    } catch (err) {
      console.error("construct: couldn't save chat", err);
    }
  }

  /** Show a different conversation: an empty new one, or a stored one. */
  private async show(next: StoredChat | null) {
    if (this.running) throw new Error("Wait for Construct to finish, or stop it first.");
    await this.save();
    if (next) this.adopt(next);
    else {
      this.chat = { id: newChatId(), created: Date.now(), sessionId: null };
      this.items = [];
      this.streaming = null;
      this.state = { ...this.state, chatId: this.chat.id };
    }
    this.emit({ t: "snapshot", items: this.items, state: this.state });
    if (this.conn) {
      this.setState({ status: "starting" });
      try {
        await this.openSession();
      } catch (err) {
        this.stop();
        this.setState({ status: "error", error: (err as Error).message });
      }
    }
  }

  /** Start a fresh conversation; the current one stays stored. */
  async reset() {
    await this.cancel().catch(() => {});
    for (let i = 0; this.running && i < 100; i++) await new Promise((r) => setTimeout(r, 50));
    await this.show(null);
  }

  async openChat(chatId: string) {
    if (chatId === this.chat.id) return;
    const found = (await this.stored()).find((c) => c.id === chatId);
    if (!found) throw new Error("That chat is gone.");
    await this.show(found);
  }

  async deleteChat(chatId: string) {
    if (chatId === this.chat.id) {
      await this.show(null);
      this.state.chats = this.state.chats.filter((c) => c.id !== chatId);
    }
    await trashChat(this.projectId, chatId);
    this.setState({ chats: this.state.chats.filter((c) => c.id !== chatId) });
  }

  toolContext(): ToolContext {
    return {
      projectId: this.projectId,
      onCodexChange: (change: CodexChange) => this.emit({ t: "codex", change }),
    };
  }

  subscribe(fn: (e: ConstructEvent) => void) {
    fn({ t: "snapshot", items: this.items, state: this.state });
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: ConstructEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch {}
    }
  }

  private setState(patch: Partial<ConstructState>) {
    this.state = { ...this.state, ...patch };
    this.emit({ t: "state", state: this.state });
  }

  private nextId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  private upsert(item: ChatItem) {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.items[i] = item;
    else {
      this.items.push(item);
      if (this.items.length > MAX_ITEMS) this.items.splice(0, this.items.length - MAX_ITEMS);
    }
    this.emit({ t: "item", item });
    this.persist();
  }

  private notice(text: string, tone: "info" | "error" = "info") {
    this.streaming = null;
    this.upsert({ id: this.nextId("n"), type: "notice", text, tone });
  }

  // ─── Agent process ──────────────────────────────────────────

  /** Start the agent (or reuse the running one) and open a session. */
  start(agent: AgentId = this.state.agent as AgentId, baseUrl = this.baseUrl): Promise<void> {
    this.baseUrl = baseUrl;
    if (agent !== this.state.agent) {
      // Another agent can't resume this one's session: start a new chat.
      this.stop();
      void this.save();
      this.chat = { id: newChatId(), created: Date.now(), sessionId: null };
      this.items = [];
      this.state = { ...this.state, chatId: this.chat.id };
      this.emit({ t: "snapshot", items: this.items, state: this.state });
    }
    if (this.conn && this.sessionId) return Promise.resolve();
    this.starting ??= this.launch(agent).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(agent: AgentId) {
    const preset: AgentPreset = AGENTS[agent];
    this.setState({ agent, status: "starting", error: undefined, config: [] });
    try {
      const cwd = path.join(os.tmpdir(), "pen-construct", await agentHome(this.projectId));
      await mkdir(cwd, { recursive: true });
      this.cwd = cwd;
      const [cmd, ...args] = preset.command;
      this.stderr = [];
      const child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, ...(await preset.env?.()) },
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child = child;
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (chunk: string) => {
        this.stderr.push(...chunk.split("\n").filter(Boolean));
        if (this.stderr.length > 40) this.stderr.splice(0, this.stderr.length - 40);
      });
      const exited = new Promise<string>((resolve) => {
        child.on("error", (err) => resolve(err.message));
        child.on("exit", (code, signal) => resolve(`exited (${signal ?? code})`));
      });
      exited.then((why) => {
        if (this.child !== child) return; // stopped on purpose
        this.child = null;
        this.conn = null;
        this.sessionId = null;
        const detail = this.stderr.slice(-3).join(" · ");
        this.setState({ status: "error", error: `${preset.name} ${why}${detail ? `: ${detail}` : ""}` });
      });

      const stream = ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      );
      const conn = new ClientSideConnection(() => this.client(), stream);
      this.conn = conn;

      const init = await Promise.race([
        conn.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {}, // no fs, no terminal: everything goes through pen's tools
          clientInfo: { name: "pen", version: "0.1.0" },
        }),
        exited.then((why) => Promise.reject(new Error(why))),
      ]);
      if (init.agentCapabilities?.mcpCapabilities?.http !== true) {
        throw new Error(`${preset.name} can't use pen's tools (no HTTP MCP support).`);
      }
      this.canResume = !!init.agentCapabilities?.sessionCapabilities?.resume;
      await this.openSession();
    } catch (err) {
      this.stop();
      const detail = this.stderr.slice(-3).join(" · ");
      this.setState({ status: "error", error: `${(err as Error).message}${detail ? ` (${detail})` : ""}` });
      throw err;
    }
  }

  private async openSession() {
    const conn = this.conn!;
    const doc = await readDoc(this.projectId);
    const title = doc ? titleOf(doc.content, this.projectId) : this.projectId;
    const params = {
      cwd: this.cwd,
      mcpServers: [
        {
          type: "http" as const,
          name: MCP_NAME,
          url: `${this.baseUrl}/api/construct/mcp`,
          headers: [{ name: "Authorization", value: `Bearer ${this.token}` }],
        },
      ],
      _meta: AGENTS[this.state.agent as AgentId].sessionMeta(systemPrompt(title), MCP_NAME),
    };
    const chat = this.chat;

    // A stored chat continues the agent's own session, memory and all.
    if (chat.sessionId && this.canResume) {
      try {
        const res = await conn.resumeSession({ ...params, sessionId: chat.sessionId });
        if (this.chat !== chat) return; // switched meanwhile
        this.sessionId = chat.sessionId;
        this.setState({ status: "ready", config: visibleConfig(res.configOptions) });
        return;
      } catch (err) {
        console.error("construct: couldn't resume session", chat.sessionId, err);
        if (this.chat === chat && this.items.length) {
          this.notice("Construct couldn’t pick up this conversation where it left off: it won’t remember the messages above.");
        }
      }
    }

    const res = await conn.newSession(params);
    if (this.chat !== chat) return;
    this.sessionId = res.sessionId;
    chat.sessionId = res.sessionId;
    if (this.items.length) void this.save();
    this.setState({ status: "ready", config: visibleConfig(res.configOptions) });
  }

  stop() {
    const child = this.child;
    this.child = null;
    this.conn = null;
    this.sessionId = null;
    this.streaming = null;
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    }
    if (this.state.status !== "error") this.setState({ status: "idle", config: [] });
  }

  // ─── Conversation ───────────────────────────────────────────

  get busy() {
    return this.running;
  }

  /** Send a message and wait for the turn to end. Errors end up in the chat. */
  async prompt(text: string, context: PromptContext) {
    if (this.running) return;
    this.running = true;
    this.streaming = null;
    const userId = this.nextId("u");
    this.upsert({ id: userId, type: "user", text, context });
    try {
      await this.start();
      this.setState({ status: "busy" });
      const res = await this.conn!.prompt({
        sessionId: this.sessionId!,
        prompt: [
          { type: "text", text: describeContext(context) },
          { type: "text", text },
        ],
      });
      this.streaming = null;
      if (res.stopReason === "max_tokens" || res.stopReason === "max_turn_requests") {
        this.notice("Construct stopped: it hit its limit for one answer.");
      } else if (res.stopReason === "refusal") {
        this.notice("Construct declined to answer.");
      }
      if (this.state.status === "busy") this.setState({ status: "ready" });
    } catch (err) {
      if (this.conn) this.setState({ status: "ready" });
      this.notice((err as Error).message || "Construct failed.", "error");
    } finally {
      await this.anchorCitations(userId).catch((err) => console.error("construct: couldn't anchor citations", err));
      this.running = false;
      await this.save();
    }
  }

  /**
   * Adds the cited lines' text to the pen: links in this turn's replies, so
   * they still find their passage after the writer edits (see lib/cite.ts).
   * Only the stored transcript changes; the agent's own history keeps its links.
   */
  private async anchorCitations(userId: string) {
    const start = this.items.findIndex((x) => x.id === userId);
    if (start < 0) return; // another chat is showing now
    const texts = new Map<string, Promise<string[] | null>>();
    const linesOf = (version?: string) => {
      const key = version ?? "";
      if (!texts.has(key)) {
        const read = version ? readVersion(this.projectId, version) : readDoc(this.projectId).then((d) => d?.content ?? null);
        texts.set(key, read.then((t) => t?.split("\n") ?? null).catch(() => null));
      }
      return texts.get(key)!;
    };
    for (const item of this.items.slice(start + 1)) {
      if (item.type !== "agent" || !item.text.includes("](pen:")) continue;
      let text = item.text;
      for (const [, href] of item.text.matchAll(/\]\((pen:[^)\s]+)\)/g)) {
        const c = parseCitation(href);
        if (!c || c.kind === "codex" || c.q) continue;
        const lines = await linesOf(c.kind === "version" ? c.version : undefined);
        if (lines) text = text.replaceAll(`](${href})`, `](${withSnippets(href, lines)})`);
      }
      if (text !== item.text) this.upsert({ ...item, text });
    }
  }

  async cancel() {
    if (this.conn && this.sessionId) await this.conn.cancel({ sessionId: this.sessionId });
  }

  async setConfig(configId: string, value: string) {
    if (!this.conn || !this.sessionId) throw new Error("Construct isn't running.");
    const res = await this.conn.setSessionConfigOption({ sessionId: this.sessionId, configId, value });
    this.setState({ config: visibleConfig(res.configOptions) });
  }

  // ─── ACP client side ────────────────────────────────────────

  private client(): Client {
    return {
      requestPermission: (p) => this.permission(p),
      sessionUpdate: (n) => this.update(n),
    };
  }

  /** Pen's own tools are pre-approved; anything else is refused. */
  private async permission(p: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const name = toolNameOf(p.toolCall);
    const allowed = name?.startsWith(TOOL_PREFIX);
    const option =
      p.options.find((o) => o.kind === (allowed ? "allow_once" : "reject_once")) ??
      p.options.find((o) => o.kind.startsWith(allowed ? "allow" : "reject"));
    if (!allowed) this.notice(`Blocked “${p.toolCall.title ?? name ?? "a tool"}”: Construct can only use pen’s tools.`);
    return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
  }

  private update({ sessionId, update: u }: SessionNotification) {
    if (sessionId !== this.sessionId) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (u.content.type !== "text") return;
        const type = u.sessionUpdate === "agent_message_chunk" ? "agent" : "thought";
        if (this.streaming?.type === type) {
          const item = this.items.find((x) => x.id === this.streaming!.id);
          if (item && (item.type === "agent" || item.type === "thought")) {
            item.text += u.content.text;
            this.emit({ t: "append", id: item.id, text: u.content.text });
            this.persist();
            return;
          }
        }
        const id = this.nextId(type === "agent" ? "a" : "th");
        this.streaming = { id, type };
        this.upsert({ id, type, text: u.content.text });
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        this.streaming = null;
        const prev = this.items.find((x) => x.id === u.toolCallId);
        const base = prev?.type === "tool" ? prev : null;
        const name = toolNameOf(u) ?? base?.name;
        let input = brief(u.rawInput) ?? base?.input;
        // A new entry's id is only known from the result.
        const created = JSON.stringify(u.rawOutput ?? "").match(/Created codex entry \\"([a-z0-9-]+)\\"/);
        if (created) input = { ...input, id: created[1] };
        this.upsert({
          id: u.toolCallId,
          type: "tool",
          name: name?.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name,
          title: u.title ?? base?.title ?? name ?? "Tool",
          status: u.status ?? base?.status ?? "pending",
          input,
        });
        return;
      }
      case "plan":
        this.streaming = null;
        this.upsert({
          id: "plan",
          type: "plan",
          entries: u.entries.map((e) => ({ content: e.content, status: e.status })),
        });
        return;
      case "config_option_update":
        this.setState({ config: visibleConfig(u.configOptions) });
        return;
      default:
        return; // user_message_chunk (echo), usage, commands, modes…
    }
  }
}

function toolNameOf(call: { _meta?: { [k: string]: unknown } | null; title?: string | null }): string | undefined {
  const meta = call._meta?.claudeCode as { toolName?: unknown } | undefined;
  if (typeof meta?.toolName === "string") return meta.toolName;
  return call.title?.startsWith("mcp__") ? call.title : undefined;
}

/** The writer only picks the model and how hard it thinks; modes stay default. */
function visibleConfig(options: SessionConfigOption[] | null | undefined) {
  return (options ?? []).filter(
    (o) => o.type === "select" && (o.category === "model" || o.category === "thought_level"),
  );
}

function describeContext(c: PromptContext) {
  const where = c.entry ? `the Codex entry "${c.entry}"` : "the manuscript";
  const lines = [`[The writer is looking at ${where}.`];
  if (c.selection) lines.push(`They have selected this text:\n"""\n${c.selection}\n"""`);
  if (c.paragraph && c.paragraph.trim() !== c.selection?.trim()) {
    lines.push(`It's in this paragraph (search for it to find its line):\n"""\n${c.paragraph}\n"""`);
  }
  return `${lines.join(" ")}]`;
}

// ─── Registry ────────────────────────────────────────────────

const g = globalThis as typeof globalThis & { __penConstruct?: Map<string, ConstructSession> };
const sessions = (g.__penConstruct ??= new Map());

if (!(g as { __penConstructExit?: boolean }).__penConstructExit) {
  (g as { __penConstructExit?: boolean }).__penConstructExit = true;
  process.on("exit", () => {
    for (const s of sessions.values()) s.stop();
  });
}

/** The project's session, with its stored chats loaded. */
export async function getSession(projectId: string, baseUrl: string): Promise<ConstructSession> {
  let s = sessions.get(projectId);
  if (!s) {
    s = new ConstructSession(projectId, baseUrl);
    sessions.set(projectId, s);
  }
  await s.loaded;
  return s;
}

/** Stop a project's session and forget it (the project was renamed). */
export function dropSession(projectId: string) {
  sessions.get(projectId)?.stop();
  sessions.delete(projectId);
}

/** The session an MCP request belongs to, by its bearer token. */
export function sessionForToken(token: string): ConstructSession | undefined {
  for (const s of sessions.values()) if (s.token === token) return s;
  return undefined;
}

export type { ConstructSession };
