"use client";

import type { ChatItem, ToolName } from "@/lib/construct/types";
import { Markdown } from "./ConstructMarkdown";

// One item of Construct's transcript: a message, the agent's thinking, a
// tool it used (in the writer's terms), its plan, a compaction, a notice.

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
type ToolText = { text: string; entry?: string };

/** What each of pen's tools did, from the bits of its input the session keeps (`brief`). */
const TOOL_TEXT: Record<ToolName, (i: Record<string, string>, lines: string) => ToolText> = {
  outline: (i) => ({ text: i.version ? `Read the outline of ${versionName(i.version)}` : "Read the outline" }),
  read_manuscript: (i, lines) => ({ text: `Read ${i.heading ?? "the manuscript"}${lines}` }),
  search: (i) => ({ text: i.query ? `Searched for “${i.query}”` : "Searched" }),
  grammar_check: (i, lines) =>
    i.entry
      ? { text: `Checked the grammar of Codex · ${i.entry}${lines}`, entry: i.entry }
      : { text: `Checked the grammar of ${i.heading ?? "the manuscript"}${lines}` },
  list_versions: () => ({ text: "Looked through the history" }),
  read_version: (i, lines) => ({ text: `Read ${versionName(i.id)}${i.heading ? `: ${i.heading}` : ""}${lines}` }),
  diff_versions: (i) => ({
    text: `Compared ${versionName(i.from)} with ${i.to ? versionName(i.to) : "the current draft"}${i.heading ? ` · ${i.heading}` : ""}`,
  }),
  list_codex: () => ({ text: "Looked through the Codex" }),
  read_codex_entry: (i) => ({ text: `Read Codex · ${i.id ?? ""}`, entry: i.id }),
  create_codex_entry: (i) => ({ text: i.id ? `Created Codex · ${i.id}` : "Created a Codex entry", entry: i.id }),
  edit_codex_entry: (i) => ({ text: `Edited Codex · ${i.id ?? ""}`, entry: i.id }),
  write_codex_entry: (i) => ({ text: `Edited Codex · ${i.id ?? ""}`, entry: i.id }),
  rename_codex_entry: (i) => ({ text: `Renamed Codex · ${i.id ?? ""} → ${i.new_id ?? ""}`, entry: i.new_id }),
  delete_codex_entry: (i) => ({ text: `Deleted Codex · ${i.id ?? ""}` }),
};

function describeTool(item: Extract<ChatItem, { type: "tool" }>): ToolText {
  const i = item.input ?? {};
  const lines = i.from_line || i.to_line ? ` (lines ${i.from_line ?? "1"}–${i.to_line ?? "end"})` : "";
  const describe = item.name && Object.hasOwn(TOOL_TEXT, item.name) ? TOOL_TEXT[item.name as ToolName] : null;
  return describe ? describe(i, lines) : { text: item.title };
}

export default function ConstructItem({ item, onOpenEntry }: { item: ChatItem; onOpenEntry: (entry: string) => void }) {
  switch (item.type) {
    case "user":
      return (
        <div className="construct-msg is-user">
          {item.context?.selection && <blockquote className="construct-quote">{item.context.selection}</blockquote>}
          <p>{item.text}</p>
        </div>
      );
    case "agent":
      return (
        <div className="construct-msg is-agent">
          <Markdown text={item.text} />
        </div>
      );
    case "thought":
      return (
        <details className="construct-thought">
          <summary className="label">Thinking</summary>
          <p>{item.text}</p>
        </details>
      );
    case "tool": {
      const { text, entry } = describeTool(item);
      const done = item.status === "completed";
      return (
        <div className={`construct-tool is-${item.status}`}>
          <span className="construct-tool-dot" aria-hidden />
          {entry && done && !item.name?.startsWith("delete") ? (
            <button type="button" onClick={() => onOpenEntry(entry)}>
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
        <ol className="construct-plan">
          {item.entries.map((e, i) => (
            <li key={i} className={`is-${e.status}`}>
              {e.content}
            </li>
          ))}
        </ol>
      );
    case "compaction":
      return (
        <div className={`construct-compaction is-${item.status}`}>
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
          {item.status === "completed" && <p className="construct-notice">Construct now remembers what’s above only as a summary.</p>}
          {item.summary && (
            <details className="construct-thought construct-compaction-summary">
              <summary className="label">Summary</summary>
              <Markdown text={item.summary} />
            </details>
          )}
        </div>
      );
    case "notice":
      return <p className={`construct-notice is-${item.tone}`}>{item.text}</p>;
  }
}
