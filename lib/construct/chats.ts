import { randomBytes } from "node:crypto";
import type { ChatItem, ChatMeta, ContextUsage } from "./types.ts";

// Construct's chats as stored in <project>/construct/<id>.json (read and
// written by lib/docs.ts). Pure, so tests load it with plain Node.

export type ChatNames = {
  /** The writer's name for it. */
  name?: string;
  /** The agent's (Claude Code names a session after its first exchange). */
  autoTitle?: string;
};

export type StoredChat = ChatMeta &
  ChatNames & {
    v: 1;
    agent: string;
    /** The agent's session, to resume it. */
    sessionId: string | null;
    /** The last item id's number. */
    seq: number;
    items: ChatItem[];
    /** The last context reading: the agent doesn't repeat it when a chat is resumed. */
    context?: ContextUsage;
  };

/** The writer's name, else the agent's title, else the opening of the first message. */
export function chatTitle({ name, autoTitle }: ChatNames, items: ChatItem[]) {
  if (name) return name;
  if (autoTitle) return autoTitle;
  const first = items.find((i) => i.type === "user");
  const text = first?.type === "user" ? first.text.replace(/\s+/g, " ").trim() : "";
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text || "New chat";
}

/** A chat name as typed: one line, up to 80 characters; empty is none. */
export const cleanChatName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, 80) || undefined;

export const newChatId = () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

export function isStoredChat(x: unknown): x is StoredChat {
  const c = x as StoredChat;
  return !!c && typeof c === "object" && c.v === 1 && typeof c.id === "string" && Array.isArray(c.items);
}

export const metaOf = ({ id, title, created, updated }: ChatMeta): ChatMeta => ({ id, title, created, updated });
