"use client";

import { Marked } from "marked";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type Citation, parseCitation } from "@/lib/cite";
import type { ChatItem, ConstructEvent, PromptContext } from "@/lib/construct/types";
import { useConstruct } from "@/lib/useConstruct";
import { IconChats, IconClose, IconPlus, IconSend, IconStop, IconTrash } from "./icons";

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
};

export type ConstructRequest = { id: number; text: string; context: PromptContext; send: boolean };

const AGENT_NAMES: Record<string, string> = { claude: "Claude Code" };

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

function Markdown({ text }: { text: string }) {
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
}: Props) {
  const c = useConstruct(projectId, open, onCodexChange);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
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

  const config = c.state?.config ?? [];

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
            <span className="construct-name">Construct</span>
            <span className="label">{AGENT_NAMES[c.state?.agent ?? "claude"] ?? c.state?.agent}</span>
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

        {config.length > 0 && (
          <div className="construct-config">
            {config.map((o) =>
              o.type === "select" ? (
                <label key={o.id} className="construct-select">
                  <span className="label">{o.name}</span>
                  <select
                    value={o.currentValue}
                    disabled={busy}
                    onChange={(e) => void c.setConfig(o.id, e.target.value)}
                  >
                    {o.options.flatMap((opt) => ("group" in opt ? opt.options : [opt])).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null,
            )}
          </div>
        )}

        {showChats && (
          <ol className="construct-chats" aria-label="Chats">
            {(c.state?.chats ?? []).map((chat) => (
              <li key={chat.id} className={chat.id === c.state?.chatId ? "is-current" : ""}>
                {confirming === chat.id ? (
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
                      className="icon-btn construct-chat-delete"
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
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
                e.preventDefault();
                void send();
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
