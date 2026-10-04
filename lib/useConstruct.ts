"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { ChatItem, ConstructAction, ConstructEvent, ConstructState, PromptContext } from "./construct/types";

type CodexChange = Extract<ConstructEvent, { t: "codex" }>["change"];

/**
 * Follow a project's Construct conversation (it lives on the server, so it
 * survives reloads and is shared between tabs) and send it messages.
 * Connects only once `enabled` turns true, and stays connected after.
 */
export function useConstruct(projectId: string, enabled: boolean, onCodexChange: (c: CodexChange) => void) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [state, setState] = useState<ConstructState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const codexRef = useRef(onCodexChange);
  codexRef.current = onCodexChange;
  const url = `/api/docs/${projectId}/construct`;
  const [active, setActive] = useState(enabled);
  if (enabled && !active) setActive(true);

  useEffect(() => {
    if (!active) return;
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as ConstructEvent;
      switch (e.t) {
        case "snapshot":
          setItems(e.items);
          setState(e.state);
          break;
        case "state":
          setState(e.state);
          break;
        case "item":
          setItems((xs) => {
            const i = xs.findIndex((x) => x.id === e.item.id);
            if (i < 0) return [...xs, e.item];
            const next = xs.slice();
            next[i] = e.item;
            return next;
          });
          break;
        case "append":
          setItems((xs) =>
            xs.map((x) => (x.id === e.id && (x.type === "agent" || x.type === "thought") ? { ...x, text: x.text + e.text } : x)),
          );
          break;
        case "codex":
          codexRef.current(e.change);
          break;
      }
    };
    return () => es.close();
  }, [url, active]);

  const post = useCallback(
    async (body: ConstructAction) => {
      setError(null);
      try {
        await api(url, { method: "POST", json: body });
        return true;
      } catch (err) {
        const locked = err instanceof ApiError && err.status === 401;
        setError(locked ? "Locked. Unlock pen to use Construct." : (err as Error).message);
        return false;
      }
    },
    [url],
  );

  return {
    items,
    state,
    error,
    connected,
    clearError: () => setError(null),
    start: () => post({ action: "start" }),
    /** Another agent's model: a new chat on it. */
    switchAgent: (agent: string, model?: string) => post({ action: "switch", agent, model }),
    send: (text: string, context: PromptContext) => post({ action: "prompt", text, context }),
    cancel: () => post({ action: "cancel" }),
    compact: () => post({ action: "compact" }),
    reset: () => post({ action: "reset" }),
    openChat: (chatId: string) => post({ action: "open-chat", chatId }),
    deleteChat: (chatId: string) => post({ action: "delete-chat", chatId }),
    renameChat: (chatId: string, title: string) => post({ action: "rename-chat", chatId, title }),
    setConfig: (configId: string, value: string) => post({ action: "config", configId, value }),
  };
}
