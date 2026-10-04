import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionNotification } from "@agentclientprotocol/sdk";
import { chatTitle, cleanChatName } from "../lib/construct/chats.ts";
import { createdEntry, createdEntryIn, settled, Transcript, type TurnState } from "../lib/construct/transcript.ts";
import type { ChatItem } from "../lib/construct/types.ts";

// A Construct chat's transcript and how the agent's updates change it
// (lib/construct/transcript.ts), without an agent.

type Update = SessionNotification["update"];
const turn = (over: Partial<TurnState> = {}): TurnState => ({
  running: true,
  compacting: false,
  startupInfo: null,
  toolName: (call) => (call.title?.startsWith("mcp__pen__") ? call.title.slice(10) : undefined),
  ...over,
});
const say = (text: string, meta?: Record<string, unknown>): Update => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
  ...(meta && { _meta: meta }),
});
const think = (text: string): Update => ({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text } });

test("message chunks stream into one item until something else comes between", () => {
  const log = new Transcript();
  assert.deepEqual(log.apply(say("Hel"), turn()), [{ t: "item", item: { id: "a-1", type: "agent", text: "Hel" } }]);
  assert.deepEqual(log.apply(say("lo."), turn()), [{ t: "append", id: "a-1", text: "lo." }]);
  log.apply(think("Hmm."), turn());
  log.apply(say("Then."), turn());
  log.breakStream();
  log.apply(say("Again."), turn());
  assert.deepEqual(
    log.items.map((i) => (i.type === "agent" || i.type === "thought" ? [i.type, i.text] : i.type)),
    [
      ["agent", "Hello."],
      ["thought", "Hmm."],
      ["agent", "Then."],
      ["agent", "Again."],
    ],
  );
});

test("nothing said between turns, and pi-acp's notices and hello, is kept", () => {
  const log = new Transcript();
  assert.deepEqual(log.apply(say("Late."), turn({ running: false })), []);
  assert.deepEqual(log.apply(say("MCP: 1 servers connected", { piAcp: { notify: { level: "info" } } }), turn()), []);
  assert.deepEqual(log.apply(say("pi 1.0"), turn({ startupInfo: "pi 1.0" })), []);
  assert.equal(log.items.length, 0);
});

test("tool calls are one item, updated as they run; a new entry's id comes from the result", () => {
  const log = new Transcript();
  log.apply(say("Let me look."), turn());
  log.apply(
    { sessionUpdate: "tool_call", toolCallId: "t1", title: "mcp__pen__create_codex_entry", rawInput: { title: "Mara", body: "long…" } },
    turn(),
  );
  log.apply(
    { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: [{ type: "text", text: createdEntry("mara") }] },
    turn(),
  );
  log.apply(say("Done."), turn());
  assert.deepEqual(log.items[1], {
    id: "t1",
    type: "tool",
    name: "create_codex_entry",
    title: "mcp__pen__create_codex_entry",
    status: "completed",
    input: { id: "mara" },
  });
  // The tool call ended the message before it.
  assert.equal(log.items[2].type === "agent" && log.items[2].text, "Done.");
  assert.equal(createdEntryIn({ content: [{ text: createdEntry("the-harbour") }] }), "the-harbour");
  assert.equal(createdEntryIn("Updated."), null);
});

test("compactions: marked manual when the writer asked, summaries streamed, patches applied", () => {
  const log = new Transcript();
  log.apply({ sessionUpdate: "compaction_update", compactionId: "c1", status: "in_progress" } as Update, turn({ compacting: true }));
  log.apply(
    { sessionUpdate: "compaction_summary_chunk", compactionId: "c1", content: { type: "text", text: "Kept: " } } as Update,
    turn(),
  );
  log.apply(
    { sessionUpdate: "compaction_summary_chunk", compactionId: "c1", content: { type: "text", text: "Mara." } } as Update,
    turn(),
  );
  log.apply({ sessionUpdate: "compaction_update", compactionId: "c1", status: "completed" } as Update, turn());
  assert.deepEqual(log.items, [{ id: "compact-c1", type: "compaction", status: "completed", manual: true, summary: "Kept: Mara." }]);
});

test("titles, usage and settings are passed on, not kept as items", () => {
  const log = new Transcript();
  assert.deepEqual(log.apply({ sessionUpdate: "session_info_update", title: " Mara's arc " }, turn()), [{ t: "title", title: "Mara's arc" }]);
  assert.deepEqual(log.apply({ sessionUpdate: "session_info_update" }, turn()), []);
  assert.deepEqual(log.apply({ sessionUpdate: "usage_update", used: 10, size: 100 }, turn()), [
    { t: "usage", context: { used: 10, size: 100 } },
  ]);
  assert.deepEqual(log.apply({ sessionUpdate: "usage_update", used: 0, size: 0 }, turn()), []);
  const [change] = log.apply(
    {
      sessionUpdate: "config_option_update",
      configOptions: [
        { type: "select", id: "model", name: "Model", category: "model", currentValue: "a", options: [] },
        { type: "select", id: "mode", name: "Mode", category: "mode", currentValue: "x", options: [] },
      ],
    },
    turn(),
  );
  assert.deepEqual(change.t === "config" && change.config.map((o) => o.id), ["model"]);
  assert.equal(log.items.length, 0);
});

test("a transcript keeps its newest 400 items, and ids keep counting from a stored chat", () => {
  const log = new Transcript([], 41);
  for (let i = 0; i < 405; i++) log.notice(`n${i}`);
  assert.equal(log.items.length, 400);
  assert.equal(log.items[0].id, "n-47");
  assert.equal(log.nextId("u"), "u-447");
});

test("a stored chat cut short has its running tools failed and its compaction cancelled", () => {
  const items: ChatItem[] = [
    { id: "t1", type: "tool", title: "Outline", status: "in_progress" },
    { id: "t2", type: "tool", title: "Search", status: "completed" },
    { id: "c", type: "compaction", status: "in_progress" },
  ];
  assert.deepEqual(
    settled(items).map((i) => "status" in i && i.status),
    ["failed", "completed", "cancelled"],
  );
});

test("a chat's title: the writer's name, the agent's, then the first message", () => {
  const items: ChatItem[] = [{ id: "u-1", type: "user", text: "  Who is\nMara?  " }];
  assert.equal(chatTitle({ name: "Mine", autoTitle: "Agent's" }, items), "Mine");
  assert.equal(chatTitle({ autoTitle: "Agent's" }, items), "Agent's");
  assert.equal(chatTitle({}, items), "Who is Mara?");
  assert.equal(chatTitle({}, [{ id: "u-1", type: "user", text: "word ".repeat(30) }]).length, 58);
  assert.equal(chatTitle({}, []), "New chat");
  assert.equal(cleanChatName("  A\n name "), "A name");
  assert.equal(cleanChatName("   "), undefined);
});
