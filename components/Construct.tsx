"use client";

import { Marked } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Citation, parseCitation } from "@/lib/cite";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { AgentModels } from "@/lib/construct/models";
import type { ChatItem, ConstructEvent, PromptContext } from "@/lib/construct/types";
import { useConstruct } from "@/lib/useConstruct";
import { useModels } from "@/lib/useModels";
import { IconChats, IconClose, IconCompact, IconDown, IconPencil, IconPlus, IconSend, IconStop, IconTrash } from "./icons";

type CodexChange = Extract<ConstructEvent, { t: "codex" }>["change"];

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** Where the writer is and what they've selected, sent along with each message. */
  getContext: () => PromptContext;
  /** Save the open document first, so Construct reads the latest words. */
  beforeSend: () => Promise<void>;
  onCodexChange: (change: CodexChange) => void;
  /** Navigate (saving first). */
  onOpen: (href: string) => void;
  /** Jump to a passage Construct cited; false if it can't be found any more. */
  onCite: (c: Exclude<Citation, { kind: "codex" }>, href: string) => boolean | Promise<boolean>;
  /** A message from elsewhere in pen (a new `id` each time): sent, or left in the input to finish. */
  request?: ConstructRequest | null;
  /** Bumped to start a new chat (from the command palette). */
  newChat?: number;
  /** Bumped to compact the conversation (from the command palette). */
  compact?: number;
  /** Bumped to put the cursor in the input (Ctrl+Shift+A, the palette). */
  focus?: number;
  /** Esc in the input: give the cursor back to the text. */
  onEscape?: () => void;
};

export type ConstructRequest = { id: number; text: string; context: PromptContext; send: boolean };

const AGENT_NAMES: Record<string, string> = { claude: "Claude Code", pi: "pi" };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Agent replies are markdown. Raw HTML is shown as text; only web links link.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      // Citations (see lib/cite.ts) become chips; the log handles their clicks.
      const cite = parseCitation(href);
      if (cite) {
        const quote = cite.kind !== "codex" && cite.q ? ` title="${escapeHtml(`“${cite.q}…”`)}"` : "";
        return `<button type="button" class="cite is-${cite.kind}" data-cite="${escapeHtml(href)}"${quote}>${inner}</button>`;
      }
      return /^https?:\/\//i.test(href)
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${inner}</a>`
        : inner;
    },
  },
});

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => md.parse(text, { async: false }), [text]);
  return <div className="construct-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** "the version from 29 Sep, 14:00", from a version id (its UTC timestamp). */
function versionName(id: string | undefined) {
  const m = id?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return "a past version";
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const day = date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `the version from ${day}, ${time}`;
}

/** What a tool call did, in the writer's terms. */
function describeTool(item: Extract<ChatItem, { type: "tool" }>): { text: string; entry?: string } {
  const i = item.input ?? {};
  const lines = i.from_line || i.to_line ? ` (lines ${i.from_line ?? "1"}–${i.to_line ?? "end"})` : "";
  switch (item.name) {
    case "read_manuscript":
      return { text: `Read ${i.heading ?? "the manuscript"}${lines}` };
    case "search":
      return { text: i.query ? `Searched for “${i.query}”` : "Searched" };
    case "list_versions":
      return { text: "Looked through the history" };
    case "outline":
      return { text: i.version ? `Read the outline of ${versionName(i.version)}` : "Read the outline" };
    case "read_version":
      return { text: `Read ${versionName(i.id)}${i.heading ? `: ${i.heading}` : ""}${lines}` };
    case "diff_versions":
      return {
        text: `Compared ${versionName(i.from)} with ${i.to ? versionName(i.to) : "the current draft"}${i.heading ? ` · ${i.heading}` : ""}`,
      };
    case "list_codex":
      return { text: "Looked through the Codex" };
    case "read_codex_entry":
      return { text: `Read Codex · ${i.id ?? ""}`, entry: i.id };
    case "create_codex_entry":
      return { text: i.id ? `Created Codex · ${i.id}` : "Created a Codex entry", entry: i.id };
    case "edit_codex_entry":
    case "write_codex_entry":
      return { text: `Edited Codex · ${i.id ?? ""}`, entry: i.id };
    case "rename_codex_entry":
      return { text: `Renamed Codex · ${i.id ?? ""} → ${i.new_id ?? ""}`, entry: i.new_id };
    case "delete_codex_entry":
      return { text: `Deleted Codex · ${i.id ?? ""}` };
    default:
      return { text: item.title };
  }
}

function when(t: number) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** 460, 12k, 1.2M: token counts at a glance. */
function tokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * The model and effort pickers, folded behind one button: "Opus 5.5 · High".
 * The model list has every agent's models; another agent's starts a new chat.
 */
function ModelMenu({
  config,
  agent,
  agents,
  disabled,
  onChange,
  onSwitch,
}: {
  config: SessionConfigOption[];
  agent: string;
  agents: AgentModels[] | null;
  disabled: boolean;
  onChange: (configId: string, value: string) => void;
  onSwitch: (agent: string, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const selects = config.flatMap((o) => (o.type === "select" ? [o] : []));
  const flat = (o: (typeof selects)[number]) => o.options.flatMap((opt) => ("group" in opt ? opt.options : [opt]));
  // Only what's been changed ("Opus 5.5 · High"); all defaults is "Default model".
  const summary =
    selects
      .map((o) => flat(o).find((opt) => opt.value === o.currentValue)?.name ?? String(o.currentValue))
      .filter((name) => !/^default\b/i.test(name))
      .join(" · ") || "Default model";
  const others = (agents ?? []).filter((a) => a.agent !== agent && a.models.length);
  const agentName = AGENT_NAMES[agent] ?? agent;

  return (
    <div className="construct-model" ref={root}>
      <button
        type="button"
        className="construct-model-btn"
        onClick={() => setOpen((x) => !x)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Model and effort"
      >
        <span>
          {agent !== "claude" && `${agentName} · `}
          {summary}
        </span>
        <IconDown />
      </button>
      {open && (
        <div className="popover-menu construct-model-menu" role="dialog" aria-label="Model and effort">
          {selects.map((o) =>
            o.category === "model" && others.length ? (
              <label key={o.id} className="construct-select">
                <span className="label">{o.name}</span>
                <select
                  value={`${agent}\u0000${o.currentValue}`}
                  disabled={disabled}
                  onChange={(e) => {
                    const [a, value] = e.target.value.split("\u0000");
                    if (a === agent) onChange(o.id, value);
                    else {
                      setOpen(false);
                      onSwitch(a, value);
                    }
                  }}
                >
                  <optgroup label={agentName}>
                    {flat(o).map((opt) => (
                      <option key={opt.value} value={`${agent}\u0000${opt.value}`}>
                        {opt.name}
                      </option>
                    ))}
                  </optgroup>
                  {others.map((a) => (
                    <optgroup key={a.agent} label={`${a.name} · new chat`}>
                      {a.models.map((m) => (
                        <option key={m.value} value={`${a.agent}\u0000${m.value}`}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label key={o.id} className="construct-select">
                <span className="label">{o.name}</span>
                <select value={o.currentValue} disabled={disabled} onChange={(e) => onChange(o.id, e.target.value)}>
                  {flat(o).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </label>
            ),
          )}
          {others.length > 0 && <p className="construct-model-hint">A model of another agent starts a new chat.</p>}
        </div>
      )}
    </div>
  );
}

const isTouch = () => typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

export default function Construct({
  projectId,
  open,
  onClose,
  getContext,
  beforeSend,
  onCodexChange,
  onOpen,
  onCite,
  request,
  newChat,
  compact,
  focus,
  onEscape,
}: Props) {
  const c = useConstruct(projectId, open, onCodexChange);
  const models = useModels(open);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The chat whose name is being edited, and the name so far. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const renameCancelled = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const status = c.state?.status ?? "idle";
  const busy = status === "busy" || sending;

  // Wake the agent the first time the panel opens.
  useEffect(() => {
    if (open && c.state?.status === "idle") void c.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, c.state?.status]);

  useEffect(() => {
    if (open && !isTouch()) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (focus && open && !isTouch()) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Follow the conversation unless the writer has scrolled up to reread.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [c.items]);

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setSending(true);
    const context = getContext();
    await beforeSend();
    const ok = await c.send(text, context);
    setSending(false);
    if (ok) {
      setDraft("");
      stick.current = true;
    }
  };

  // Look-up and grammar buttons: send right away, unless Construct is still
  // answering (then the message waits in the input) or it's a question to finish.
  const handled = useRef(0);
  useEffect(() => {
    if (!request || request.id === handled.current) return;
    handled.current = request.id;
    if (!request.send || busy) {
      setDraft(request.text);
      requestAnimationFrame(() => {
        const el = input.current;
        el?.focus();
        el?.setSelectionRange(request.text.length, request.text.length);
      });
      return;
    }
    void (async () => {
      setSending(true);
      await beforeSend();
      const ok = await c.send(request.text, request.context);
      setSending(false);
      if (ok) stick.current = true;
      else setDraft(request.text);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  // The command palette's New chat: once the conversation has loaded, if there is one.
  const handledNew = useRef(0);
  useEffect(() => {
    if (!newChat || newChat === handledNew.current || !c.state) return;
    handledNew.current = newChat;
    setShowChats(false);
    if (c.items.length) void c.reset();
    if (!isTouch()) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChat, c.state]);

  // The command palette's Compact: once the conversation has loaded.
  const handledCompact = useRef(0);
  useEffect(() => {
    if (!compact || compact === handledCompact.current || !c.state) return;
    handledCompact.current = compact;
    setShowChats(false);
    stick.current = true;
    if (c.items.length && !busy) void c.compact();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, c.state]);

  const config = c.state?.config ?? [];
  // A chat is listed once it has a message; until then the header says "Construct".
  const chatTitle = c.state?.chats.find((x) => x.id === c.state?.chatId)?.title;
  const context = c.state?.context;
  const filled = context ? Math.min(1, context.used / context.size) : 0;

  /** Citation chips in replies: open the entry, or jump to the passage. */
  const onLogClick = async (e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>("[data-cite]");
    const cite = chip && parseCitation(chip.dataset.cite ?? "");
    if (!chip || !cite) return;
    if (cite.kind === "codex") return onOpen(`/d/${projectId}/codex/${cite.entry}`);
    const found = await onCite(cite, chip.dataset.cite!);
    chip.classList.toggle("is-missing", !found);
    if (!found) chip.title = "Couldn’t find this passage any more";
  };

  return (
    <>
      <div className={`scrim construct-scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
      <aside className={`construct ${open ? "is-open" : ""}`} aria-label="Construct" aria-hidden={!open}>
        <div className="construct-head">
          <div className="construct-title">
            {chatTitle ? (
              <span className="construct-name is-chat" title={chatTitle}>
                {chatTitle}
              </span>
            ) : (
              <>
                <span className="construct-name">Construct</span>
                <span className="label">{AGENT_NAMES[c.state?.agent ?? "claude"] ?? c.state?.agent}</span>
              </>
            )}
          </div>
          <div className="construct-head-actions">
            <button
              type="button"
              className={`icon-btn ${showChats ? "is-on" : ""}`}
              onClick={() => {
                setShowChats((s) => !s);
                setConfirming(null);
              }}
              disabled={!c.state?.chats?.length}
              aria-label="Chats"
              aria-pressed={showChats}
              title="Chats"
            >
              <IconChats />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setShowChats(false);
                void c.reset();
              }}
              disabled={!c.items.length}
              aria-label="New chat"
              title="New chat"
            >
              <IconPlus />
            </button>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Construct">
              <IconClose />
            </button>
          </div>
        </div>

        {(config.length > 0 || context) && (
          <div className="construct-config">
            {config.length > 0 && (
              <ModelMenu
                config={config}
                agent={c.state?.agent ?? "claude"}
                agents={models.agents}
                disabled={busy}
                onChange={(id, v) => void c.setConfig(id, v)}
                onSwitch={(agent, model) => {
                  setShowChats(false);
                  void c.switchAgent(agent, model);
                }}
              />
            )}
            {context && (
              <div className={`construct-context ${filled >= 0.8 ? "is-full" : ""}`}>
                <span
                  className="construct-context-meter"
                  role="meter"
                  aria-label="Context used"
                  aria-valuemin={0}
                  aria-valuemax={context.size}
                  aria-valuenow={context.used}
                  title={`Context: ${context.used.toLocaleString()} of ${context.size.toLocaleString()} tokens`}
                >
                  <span style={{ width: `${filled * 100}%` }} />
                </span>
                <span className="construct-context-text">
                  {Math.round(filled * 100)}%
                  <span className="construct-context-tokens">
                    {" "}
                    · {tokens(context.used)}/{tokens(context.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="icon-btn construct-context-compact"
                  onClick={() => {
                    stick.current = true;
                    void c.compact();
                  }}
                  disabled={busy || !c.items.length}
                  aria-label="Compact the conversation"
                  title="Compact: summarize the conversation so far, to free up context"
                >
                  <IconCompact />
                </button>
              </div>
            )}
          </div>
        )}

        {showChats && (
          <ol className="construct-chats" aria-label="Chats">
            {(c.state?.chats ?? []).map((chat) => (
              <li key={chat.id} className={chat.id === c.state?.chatId ? "is-current" : ""}>
                {renaming?.id === chat.id ? (
                  <form
                    className="construct-chat-rename"
                    onSubmit={(e) => {
                      e.preventDefault();
                      e.currentTarget.querySelector("input")?.blur();
                    }}
                  >
                    <input
                      autoFocus
                      value={renaming.name}
                      maxLength={80}
                      placeholder="Automatic name"
                      aria-label="Chat name"
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setRenaming({ id: chat.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          renameCancelled.current = true;
                          setRenaming(null);
                        }
                      }}
                      onBlur={() => {
                        setRenaming(null);
                        if (renameCancelled.current) renameCancelled.current = false;
                        else if (renaming.name.trim() !== chat.title) void c.renameChat(chat.id, renaming.name);
                      }}
                    />
                  </form>
                ) : confirming === chat.id ? (
                  <div className="construct-chat-confirm">
                    <span>Delete this chat?</span>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => {
                        setConfirming(null);
                        void c.deleteChat(chat.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="construct-chat"
                      disabled={busy}
                      onClick={() => {
                        setShowChats(false);
                        stick.current = true;
                        void c.openChat(chat.id);
                      }}
                    >
                      <span className="construct-chat-title">{chat.title}</span>
                      <span className="label">{when(chat.updated)}</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn construct-chat-action"
                      onClick={() => {
                        setConfirming(null);
                        renameCancelled.current = false;
                        setRenaming({ id: chat.id, name: chat.title });
                      }}
                      aria-label={`Rename “${chat.title}”`}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      className="icon-btn construct-chat-action"
                      disabled={busy && chat.id === c.state?.chatId}
                      onClick={() => setConfirming(chat.id)}
                      aria-label={`Delete “${chat.title}”`}
                    >
                      <IconTrash />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        <div
          className="construct-log"
          hidden={showChats}
          ref={scroller}
          onClick={onLogClick}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          aria-live="polite"
        >
          {c.items.length === 0 && (
            <div className="construct-empty">
              <p>
                Construct reads your manuscript and its history, and keeps the Codex with you: characters, places,
                threads, timelines.
              </p>
              <p>It can’t change the manuscript, and it won’t write prose unless you ask: feedback points at passages, the words stay yours.</p>
            </div>
          )}
          {c.items.map((item) => {
            switch (item.type) {
              case "user":
                return (
                  <div key={item.id} className="construct-msg is-user">
                    {item.context?.selection && (
                      <blockquote className="construct-quote">{item.context.selection}</blockquote>
                    )}
                    <p>{item.text}</p>
                  </div>
                );
              case "agent":
                return (
                  <div key={item.id} className="construct-msg is-agent">
                    <Markdown text={item.text} />
                  </div>
                );
              case "thought":
                return (
                  <details key={item.id} className="construct-thought">
                    <summary className="label">Thinking</summary>
                    <p>{item.text}</p>
                  </details>
                );
              case "tool": {
                const { text, entry } = describeTool(item);
                const done = item.status === "completed";
                return (
                  <div key={item.id} className={`construct-tool is-${item.status}`}>
                    <span className="construct-tool-dot" aria-hidden />
                    {entry && done && !item.name?.startsWith("delete") ? (
                      <button type="button" onClick={() => onOpen(`/d/${projectId}/codex/${entry}`)}>
                        {text}
                      </button>
                    ) : (
                      <span>{text}</span>
                    )}
                  </div>
                );
              }
              case "plan":
                return (
                  <ol key={item.id} className="construct-plan">
                    {item.entries.map((e, i) => (
                      <li key={i} className={`is-${e.status}`}>
                        {e.content}
                      </li>
                    ))}
                  </ol>
                );
              case "compaction":
                return (
                  <div key={item.id} className={`construct-compaction is-${item.status}`}>
                    <p className="label">
                      {item.status === "in_progress"
                        ? "Compacting the conversation…"
                        : item.status === "failed"
                          ? "Compacting failed"
                          : item.status === "cancelled"
                            ? "Compacting stopped"
                            : item.manual
                              ? "Conversation compacted"
                              : "Compacted to make room"}
                    </p>
                    {item.error && <p className="construct-notice is-error">{item.error}</p>}
                    {item.status === "completed" && (
                      <p className="construct-notice">Construct now remembers what’s above only as a summary.</p>
                    )}
                    {item.summary && (
                      <details className="construct-thought construct-compaction-summary">
                        <summary className="label">Summary</summary>
                        <Markdown text={item.summary} />
                      </details>
                    )}
                  </div>
                );
              case "notice":
                return (
                  <p key={item.id} className={`construct-notice is-${item.tone}`}>
                    {item.text}
                  </p>
                );
            }
          })}
          {status === "busy" && <div className="construct-working" aria-label="Working" />}
        </div>

        {(c.error || status === "error") && (
          <p className="construct-error" role="alert">
            {c.error ?? c.state?.error}{" "}
            {status === "error" && (
              <button type="button" onClick={() => void c.start()}>
                Retry
              </button>
            )}
          </p>
        )}

        <form
          className="construct-input"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={input}
            value={draft}
            rows={1}
            placeholder={status === "starting" ? "Waking Construct…" : "Ask Construct"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "Enter" && !e.shiftKey && !isTouch()) {
                e.preventDefault();
                void send();
              } else if (e.key === "Escape" && onEscape) {
                e.preventDefault();
                onEscape();
              }
            }}
          />
          {status === "busy" ? (
            <button type="button" className="construct-send" onClick={() => void c.cancel()} aria-label="Stop" title="Stop">
              <IconStop />
            </button>
          ) : (
            <button type="submit" className="construct-send" disabled={!draft.trim() || busy} aria-label="Send">
              <IconSend />
            </button>
          )}
        </form>
      </aside>
    </>
  );
}
