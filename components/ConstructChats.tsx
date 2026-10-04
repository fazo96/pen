"use client";

import { useRef, useState } from "react";
import type { ChatMeta } from "@/lib/construct/types";
import { IconPencil, IconTrash } from "./icons";

// Construct's stored chats, newest first: open one, rename it, delete it.

function when(t: number) {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function ConstructChats({
  chats,
  current,
  busy,
  onOpen,
  onRename,
  onDelete,
}: {
  chats: ChatMeta[];
  /** The chat shown. */
  current: string | undefined;
  busy: boolean;
  onOpen: (id: string) => void;
  /** An empty name gives it back its automatic title. */
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const renameCancelled = useRef(false);

  return (
    <ol className="construct-chats" aria-label="Chats">
      {chats.map((chat) => (
        <li key={chat.id} className={chat.id === current ? "is-current" : ""}>
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
                  else if (renaming.name.trim() !== chat.title) onRename(chat.id, renaming.name);
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
                  onDelete(chat.id);
                }}
              >
                Delete
              </button>
            </div>
          ) : (
            <>
              <button type="button" className="construct-chat" disabled={busy} onClick={() => onOpen(chat.id)}>
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
                disabled={busy && chat.id === current}
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
  );
}
