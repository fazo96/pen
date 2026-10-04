"use client";

import { useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { type Citation, parseCitation } from "@/lib/cite";
import { matches, TOUCH } from "@/lib/media";
import { agentName, DEFAULT_AGENT } from "@/lib/construct/agentInfo";
import type { ConstructEvent, PromptContext } from "@/lib/construct/types";
import { useConstruct } from "@/lib/useConstruct";
import { useModels } from "@/lib/useModels";
import ConstructChats from "./ConstructChats";
import ConstructItem from "./ConstructItem";
import ConstructModelMenu from "./ConstructModelMenu";
import { IconChats, IconClose, IconCompact, IconPlus, IconSend, IconStop } from "./icons";

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
  /** What the rest of the page asks of it (see ConstructHandle). */
  handle: React.Ref<ConstructHandle>;
  /** Esc in the input: give the cursor back to the text. */
  onEscape?: () => void;
};

/** A message from elsewhere in pen (the look-up and grammar buttons): sent, or left in the input to finish. */
export type ConstructRequest = { text: string; context: PromptContext; send: boolean };

export type ConstructHandle = {
  ask: (request: ConstructRequest) => void;
  /** A new chat (from the command palette), once the conversation has loaded. */
  newChat: () => void;
  /** Compact the conversation (from the command palette), once it has loaded. */
  compact: () => void;
  /** The cursor into the input (Ctrl+Shift+A, the palette), if it's open: opening puts it there anyway. */
  focus: () => void;
};


/** 460, 12k, 1.2M: token counts at a glance. */
function tokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") : Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const isTouch = () => matches(TOUCH);

export default function Construct({
  projectId,
  open,
  onClose,
  getContext,
  beforeSend,
  onCodexChange,
  onOpen,
  onCite,
  handle,
  onEscape,
}: Props) {
  const c = useConstruct(projectId, open, onCodexChange);
  const models = useModels(open);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showChats, setShowChats] = useState(false);
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
  const ask = (request: ConstructRequest) => {
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
  };
  const newChat = () => {
    setShowChats(false);
    if (c.items.length) void c.reset();
    if (!isTouch()) input.current?.focus();
  };
  const compact = () => {
    setShowChats(false);
    stick.current = true;
    if (c.items.length && !busy) void c.compact();
  };
  // New chat and Compact wait for the conversation to load (opening the panel connects).
  const waiting = useRef<("newChat" | "compact")[]>([]);
  const later = { newChat, compact };
  const whenLoaded = (what: "newChat" | "compact") => (c.state ? later[what]() : waiting.current.push(what));
  const runWaiting = useEffectEvent(() => {
    for (const what of waiting.current.splice(0)) later[what]();
  });
  const loaded = !!c.state;
  useEffect(() => {
    if (loaded) runWaiting();
  }, [loaded]);
  useImperativeHandle(handle, () => ({
    ask,
    newChat: () => whenLoaded("newChat"),
    compact: () => whenLoaded("compact"),
    focus: () => open && !isTouch() && input.current?.focus(),
  }));

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
                <span className="label">{agentName(c.state?.agent ?? DEFAULT_AGENT)}</span>
              </>
            )}
          </div>
          <div className="construct-head-actions">
            <button
              type="button"
              className={`icon-btn ${showChats ? "is-on" : ""}`}
              onClick={() => setShowChats((s) => !s)}
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
              <ConstructModelMenu
                config={config}
                agent={c.state?.agent ?? DEFAULT_AGENT}
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
                {/* biome-ignore lint/a11y/useSemanticElements: a drawn bar; a <meter> can't be styled like it everywhere */}
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
          <ConstructChats
            chats={c.state?.chats ?? []}
            current={c.state?.chatId}
            busy={busy}
            onOpen={(id) => {
              setShowChats(false);
              stick.current = true;
              void c.openChat(id);
            }}
            onRename={(id, name) => void c.renameChat(id, name)}
            onDelete={(id) => void c.deleteChat(id)}
          />
        )}

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: delegates clicks from the citation chips inside, which are buttons */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: delegates clicks from the citation chips inside, which are buttons */}
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
          {c.items.map((item) => (
            <ConstructItem key={item.id} item={item} onOpenEntry={(entry) => onOpen(`/d/${projectId}/codex/${entry}`)} />
          ))}
          {status === "busy" && <div className="construct-working" role="img" aria-label="Working" />}
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
