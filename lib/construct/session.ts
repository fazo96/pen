import "server-only";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  Client,
  ContentBlock,
  LoadSessionResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { anchorCitations } from "../cite";
import { agentHome, GLOBAL, readChats, readDoc, readEntry, readVersion, trashChat, writeChat } from "../docs";
import { type AgentLaunch, type AgentProcess, initialize, modelOption, optionValues, spawnAgent, startupInfoOf } from "../acp";
import { titleOf } from "../text";
import { type CodexChange, listTools, type ToolContext } from "./tools";
import { DEFAULT_AGENT } from "./agentInfo";
import { type AgentId, type AgentPreset, AGENTS, fallbackAgent, isAgentId, launchFor, MCP_NAME, penToolName, toolNameOf } from "./agents";
import { type ChatNames, chatTitle, cleanChatName, isStoredChat, metaOf, newChatId, type StoredChat } from "./chats";
import { modelFor } from "./ask";
import { AGENTS_ENTRY, agentsText, agentsUpdate, bookAgents, describeContext, globalSystemPrompt, systemPrompt } from "./prompts";
import { type Change, settled, Transcript, visibleConfig } from "./transcript";
import type { ChatItem, ChatMeta, ConstructEvent, ConstructState, PromptContext } from "./types";

// One Construct conversation at a time per project, driving an ACP agent over
// stdio. Lives in the server process (on globalThis, so dev reloads keep it);
// the browser watches it through /api/docs/[id]/construct. Every chat is also
// stored in the project folder, with the agent's session id, so it can be
// picked up again after a restart (ACP session/resume).

const SAVE_EVERY_MS = 1500;

class ConstructSession {
  readonly token = randomBytes(24).toString("base64url");
  private log = new Transcript();
  private get items() {
    return this.log.items;
  }
  private state: ConstructState;
  private listeners = new Set<(e: ConstructEvent) => void>();
  private proc: AgentProcess | null = null;
  private get conn() {
    return this.proc?.conn ?? null;
  }
  private sessionId: string | null = null;
  private starting: Promise<void> | null = null;
  /** The agent the running process is, and how it was started. */
  private runningAgent: AgentId | null = null;
  private launched: (AgentLaunch & { mcpUrl: string }) | null = null;
  /** The AGENTS entry's text in the system prompt, and as the agent last saw it (an update can follow). */
  private agentsLaunched: string | null = null;
  private agentsSeen: string | null = null;
  private running = false;
  /** The turn running is the writer's Compact, not a message. */
  private compacting = false;
  /**
   * The chat shown; `sessionId` is the agent's, kept to resume it later, and
   * `model` the one to pick when the agent opens a new session for it.
   */
  private chat: { id: string; created: number; sessionId: string | null; agent: AgentId; model?: string } & ChatNames;
  private canResume = false;
  private canLoad = false;
  /** A loaded session replays its history: the chat has it already. */
  private replaying = false;
  /** pi-acp's hello, sent as if it were a message; see update(). */
  private startupInfo: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  readonly loaded: Promise<void>;

  constructor(
    readonly projectId: string,
    private baseUrl: string,
  ) {
    this.chat = { id: newChatId(), created: Date.now(), sessionId: null, agent: DEFAULT_AGENT };
    this.state = { agent: DEFAULT_AGENT, chatId: this.chat.id, chats: [], status: "idle", config: [] };
    this.loaded = this.load().catch((err) => console.error("construct: couldn't load chats", err));
  }

  // ─── Stored chats ───────────────────────────────────────────

  private async stored(): Promise<StoredChat[]> {
    const chats = (await readChats(this.projectId)).filter(isStoredChat);
    return chats.sort((a, b) => b.updated - a.updated);
  }

  /** Pick up where the newest stored chat left off, or get a new one ready. */
  private async load() {
    const chats = await this.stored();
    this.state = { ...this.state, chats: chats.map(metaOf) };
    if (chats[0]) this.adopt(chats[0]);
    else await this.fresh();
  }

  /** An empty chat, on the default model for chats. */
  private async fresh() {
    const { agent, model } = await modelFor("chat");
    this.chat = { id: newChatId(), created: Date.now(), sessionId: null, agent, model };
    this.log = new Transcript();
    this.state = { ...this.state, agent, chatId: this.chat.id, context: undefined };
  }

  private adopt(c: StoredChat) {
    // A chat stays with the agent it was started on: only that one can resume it.
    const agent = isAgentId(c.agent) && AGENTS[c.agent].available() ? c.agent : fallbackAgent();
    this.chat = { id: c.id, created: c.created, sessionId: c.sessionId, agent, name: c.name, autoTitle: c.autoTitle };
    this.log = new Transcript(settled(c.items), c.seq);
    this.state = { ...this.state, agent, chatId: c.id, context: c.context };
  }

  private title() {
    return chatTitle(this.chat, this.items);
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
      agent: this.chat.agent,
      sessionId: this.chat.sessionId,
      seq: this.log.seq,
      items: this.items,
      ...(this.state.context && { context: this.state.context }),
      ...(this.chat.name && { name: this.chat.name }),
      ...(this.chat.autoTitle && { autoTitle: this.chat.autoTitle }),
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
    else await this.fresh();
    this.emit({ t: "snapshot", items: this.items, state: this.state });
    await this.starting?.catch(() => {});
    if (this.conn && this.runningAgent !== this.chat.agent) {
      // The chat is another agent's: start that one instead.
      this.stop();
      await this.start().catch(() => {});
    } else if (this.conn) {
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

  /** Talk to another agent's model: a new chat, since an agent can't take over another's conversation. */
  async switchAgent(agent: AgentId, model?: string) {
    if (!AGENTS[agent].available()) throw new Error(`${AGENTS[agent].name} isn’t available here.`);
    await this.cancel().catch(() => {});
    for (let i = 0; this.running && i < 100; i++) await new Promise((r) => setTimeout(r, 50));
    await this.save();
    const wasRunning = !!this.conn || !!this.starting;
    await this.starting?.catch(() => {}); // let a launch finish before stopping it
    this.stop();
    this.chat = { id: newChatId(), created: Date.now(), sessionId: null, agent, model };
    this.log = new Transcript();
    this.state = { ...this.state, agent, chatId: this.chat.id, context: undefined, config: [] };
    this.emit({ t: "snapshot", items: this.items, state: this.state });
    if (wasRunning) await this.start().catch(() => {});
  }

  async openChat(chatId: string) {
    if (chatId === this.chat.id) return;
    const found = (await this.stored()).find((c) => c.id === chatId);
    if (!found) throw new Error("That chat is gone.");
    await this.show(found);
  }

  /** Name a chat; an empty name gives it back its automatic title. */
  async renameChat(chatId: string, name: string) {
    const clean = cleanChatName(name);
    let title: string;
    if (chatId === this.chat.id) {
      this.chat.name = clean;
      title = this.title();
      await this.save();
    } else {
      const found = (await this.stored()).find((c) => c.id === chatId);
      if (!found) throw new Error("That chat is gone.");
      const next: StoredChat = { ...found, name: clean };
      title = next.title = chatTitle(next, next.items);
      await writeChat(this.projectId, chatId, next);
    }
    this.setState({ chats: this.state.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) });
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

  /** Pass a change to the transcript on: to the panel now, to the chat file shortly. */
  private tell(change: Change) {
    switch (change.t) {
      case "item":
      case "append":
        this.emit(change);
        break;
      case "config":
        return this.setState({ config: change.config });
      case "title":
        this.chat.autoTitle = change.title;
        break;
      case "usage":
        this.setState({ context: change.context });
        break;
    }
    this.persist();
  }

  private upsert(item: ChatItem) {
    this.tell(this.log.upsert(item));
  }

  private notice(text: string, tone: "info" | "error" = "info") {
    this.tell(this.log.notice(text, tone));
  }

  // ─── Agent process ──────────────────────────────────────────

  /** Start the agent of the chat shown (or reuse it, running) and open its session. */
  start(baseUrl = this.baseUrl): Promise<void> {
    this.baseUrl = baseUrl;
    if (this.conn && this.sessionId && this.runningAgent === this.chat.agent) return Promise.resolve();
    this.starting ??= this.launch(this.chat.agent).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async launch(agent: AgentId) {
    const preset: AgentPreset = AGENTS[agent];
    this.setState({ agent, status: "starting", error: undefined, config: [] });
    let proc: AgentProcess | null = null;
    try {
      const doc = await readDoc(this.projectId);
      const agents = await this.readAgents();
      this.agentsLaunched = this.agentsSeen = agents;
      const mcpUrl = `${this.baseUrl}/api/construct/mcp`;
      const launch = await launchFor(agent, {
        cwd: path.join(os.tmpdir(), "pen-construct", await agentHome(this.projectId)),
        systemPrompt:
          this.projectId === GLOBAL
            ? globalSystemPrompt(agents)
            : systemPrompt(doc ? titleOf(doc.content, this.projectId) : this.projectId, agents),
        mcp: { url: mcpUrl, token: this.token, tools: listTools(this.projectId).map((t) => t.name) },
      });
      this.launched = { ...launch, mcpUrl };
      const p = (proc = await spawnAgent(launch, this.client(), 40));
      this.proc = p;
      this.runningAgent = agent;
      void p.exited.then((why) => {
        if (this.proc !== p) return; // stopped on purpose
        this.proc = null;
        this.sessionId = null;
        this.runningAgent = null;
        const detail = p.stderrTail();
        this.setState({ status: "error", error: `${preset.name} ${why}${detail ? `: ${detail}` : ""}` });
      });

      const init = await Promise.race([
        // No fs, no terminal: everything goes through pen's tools. Compaction
        // comes as its own updates rather than a made-up tool call.
        initialize(p.conn, { session: { compaction: {} } }),
        p.exited.then((why) => Promise.reject(new Error(why))),
      ]);
      if (preset.mcp === "acp" && init.agentCapabilities?.mcpCapabilities?.http !== true) {
        throw new Error(`${preset.name} can't use pen's tools (no HTTP MCP support).`);
      }
      this.canResume = !!init.agentCapabilities?.sessionCapabilities?.resume;
      this.canLoad = !!init.agentCapabilities?.loadSession;
      await this.openSession();
    } catch (err) {
      this.stop();
      const detail = proc?.stderrTail();
      this.setState({ status: "error", error: `${(err as Error).message}${detail ? ` (${detail})` : ""}` });
      throw err;
    }
  }

  private async openSession() {
    const conn = this.conn!;
    const launched = this.launched!;
    const preset: AgentPreset = AGENTS[this.runningAgent!];
    const params = {
      cwd: launched.cwd,
      // An agent that takes its MCP servers from ACP gets pen's here; the others were set up at launch.
      mcpServers:
        preset.mcp === "acp"
          ? [
              {
                type: "http" as const,
                name: MCP_NAME,
                url: launched.mcpUrl,
                headers: [{ name: "Authorization", value: `Bearer ${this.token}` }],
              },
            ]
          : [],
      _meta: launched.sessionMeta,
    };
    const chat = this.chat;
    this.startupInfo = null;

    // A stored chat continues the agent's own session, memory and all:
    // resumed, or loaded (which replays the history the chat already shows).
    if (chat.sessionId && (this.canResume || this.canLoad)) {
      try {
        let res: ResumeSessionResponse | LoadSessionResponse;
        if (this.canResume) res = await conn.resumeSession({ ...params, sessionId: chat.sessionId });
        else {
          this.replaying = true;
          try {
            res = await conn.loadSession({ ...params, sessionId: chat.sessionId });
          } finally {
            this.replaying = false;
          }
        }
        if (this.chat !== chat) return; // switched meanwhile
        this.sessionId = chat.sessionId;
        this.startupInfo = startupInfoOf(res._meta);
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
    this.startupInfo = startupInfoOf(res._meta);
    chat.sessionId = res.sessionId;
    if (this.items.length) void this.save();
    let config = res.configOptions;
    // A new chat's model: the one picked for it, or the default for chats.
    const picker = modelOption(config);
    if (chat.model && picker && picker.currentValue !== chat.model && optionValues(picker).includes(chat.model)) {
      try {
        config = (await conn.setSessionConfigOption({ sessionId: res.sessionId, configId: picker.id, value: chat.model })).configOptions;
      } catch (err) {
        console.error("construct: couldn't pick the model", chat.model, err);
      }
    }
    this.setState({ status: "ready", config: visibleConfig(config) });
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.sessionId = null;
    this.runningAgent = null;
    this.log.breakStream();
    proc?.stop();
    if (this.state.status !== "error") this.setState({ status: "idle", config: [] });
  }

  // ─── Conversation ───────────────────────────────────────────

  get busy() {
    return this.running;
  }

  /** Send a message and wait for the turn to end. Errors end up in the chat. */
  async prompt(text: string, context: PromptContext) {
    if (this.running) return;
    this.log.breakStream();
    const userId = this.log.nextId("u");
    this.upsert({ id: userId, type: "user", text, context });
    await this.runTurn(
      async () => [
        // After the agent started, which read AGENTS into its system prompt.
        ...(await this.agentsChange()),
        { type: "text", text: describeContext(context) },
        { type: "text", text },
      ],
      { failure: "Construct failed.", after: () => this.anchorCitations(userId) },
    );
  }

  /** Have the agent summarize the conversation so far, to free its context. */
  async compact() {
    if (this.running) return;
    this.log.breakStream();
    // Claude Code's own command; it has to be the whole prompt to count as one.
    await this.runTurn(() => [{ type: "text", text: "/compact" }], {
      compacting: true,
      failure: "Construct couldn’t compact the conversation.",
    });
  }

  /** The AGENTS entry, if it changed since the agent last saw it: as a block to send ahead of a message. */
  private async agentsChange(): Promise<ContentBlock[]> {
    const agents = await this.readAgents();
    if (agents === this.agentsSeen) return [];
    this.agentsSeen = agents;
    return [{ type: "text", text: agentsUpdate(agents) }];
  }

  /** The standing instructions: a book's are the Global Codex's AGENTS and its own. */
  private async readAgents() {
    const global = (await readEntry(GLOBAL, AGENTS_ENTRY))?.content;
    if (this.projectId === GLOBAL) return agentsText(global);
    return bookAgents(global, (await readEntry(this.projectId, AGENTS_ENTRY))?.content);
  }

  /** One turn: start the agent if needed, send `prompt`, wait for the end; failures become notices. */
  private async runTurn(
    prompt: () => ContentBlock[] | Promise<ContentBlock[]>,
    opts: { compacting?: boolean; failure: string; after?: () => Promise<void> },
  ) {
    this.running = true;
    this.compacting = !!opts.compacting;
    try {
      await this.start();
      this.setState({ status: "busy" });
      const res = await this.conn!.prompt({ sessionId: this.sessionId!, prompt: await prompt() });
      this.log.breakStream();
      if (res.stopReason === "max_tokens" || res.stopReason === "max_turn_requests") {
        this.notice("Construct stopped: it hit its limit for one answer.");
      } else if (res.stopReason === "refusal") {
        this.notice("Construct declined to answer.");
      }
      if (this.state.status === "busy") this.setState({ status: "ready" });
    } catch (err) {
      if (this.conn) this.setState({ status: "ready" });
      this.notice((err as Error).message || opts.failure, "error");
    } finally {
      await opts.after?.().catch((err) => console.error("construct: after a turn", err));
      this.compacting = false;
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
      if (item.type !== "agent") continue;
      const text = await anchorCitations(item.text, linesOf);
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
    const name = toolNameOf(this.runningAgent ?? this.chat.agent, p.toolCall);
    const allowed = !!name && penToolName(name, MCP_NAME) !== null;
    const option =
      p.options.find((o) => o.kind === (allowed ? "allow_once" : "reject_once")) ??
      p.options.find((o) => o.kind.startsWith(allowed ? "allow" : "reject"));
    if (!allowed) this.notice(`Blocked “${p.toolCall.title ?? name ?? "a tool"}”: Construct can only use pen’s tools.`);
    return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
  }

  private update({ sessionId, update: u }: SessionNotification) {
    // While loading, the agent retells the conversation (shown already); only its numbers count.
    if (this.replaying && u.sessionUpdate !== "usage_update" && u.sessionUpdate !== "config_option_update") return;
    // (A session being loaded has no `sessionId` yet: it's the chat's.)
    if (sessionId !== (this.sessionId ?? this.chat.sessionId)) return;
    const agent = this.runningAgent ?? this.chat.agent;
    const changes = this.log.apply(u, {
      running: this.running,
      compacting: this.compacting,
      startupInfo: this.startupInfo,
      toolName: (call) => {
        const name = toolNameOf(agent, call);
        return name && (penToolName(name, MCP_NAME) ?? name);
      },
    });
    for (const change of changes) this.tell(change);
    // A compaction may drop an AGENTS update sent with a message; the system prompt's version stays.
    if (u.sessionUpdate === "compaction_update") this.agentsSeen = this.agentsLaunched;
  }
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
