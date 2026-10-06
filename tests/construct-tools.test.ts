import assert from "node:assert/strict";
import { test } from "node:test";
import { createDoc, createEntry, GLOBAL, readEntry } from "../lib/docs.ts";
import { handleMcp } from "../lib/construct/mcp.ts";
import { callTool, type CodexChange, listTools } from "../lib/construct/tools/index.ts";

// Construct's tools (lib/construct/tools/) and the MCP endpoint that serves
// them (lib/construct/mcp.ts), on the scratch library.

const changes: CodexChange[] = [];
const ctx = (projectId: string) => ({ projectId, onCodexChange: (c: CodexChange) => void changes.push(c) });

test("edit_codex_entry replaces text found once, and refuses none or several unless asked", async () => {
  const { id } = await createDoc("# Tools Book");
  await createEntry(id, "# Mara\n\nShe sails. She sails far.");
  const edit = (args: Record<string, unknown>) => callTool("edit_codex_entry", { id: "mara", ...args }, ctx(id));

  assert.deepEqual(await edit({ old_text: "far", new_text: "north" }), { text: 'Edited "mara" (1 replacement).', isError: false });
  const twice = await edit({ old_text: "She sails", new_text: "She rows" });
  assert.ok(twice.isError);
  assert.match(twice.text, /matches 2 times/);
  assert.match((await edit({ old_text: "nowhere", new_text: "x" })).text, /not found/);
  assert.equal((await edit({ old_text: "She sails", new_text: "She rows", replace_all: true })).text, 'Edited "mara" (2 replacements).');
  assert.equal((await readEntry(id, "mara"))?.content, "# Mara\n\nShe rows. She rows north.");
  assert.deepEqual(changes.slice(-1), [{ entry: "mara", action: "edited" }]);
  assert.equal((await callTool("edit_codex_entry", { id: "../x", old_text: "a" }, ctx(id))).isError, true);
  assert.equal((await callTool("no_such_tool", {}, ctx(id))).isError, true);
});

test("the MCP endpoint speaks JSON-RPC: handshake, tool list, calls, batches and notifications", async () => {
  const { id } = await createDoc("# Mcp Book\n\nOne line.");
  const init = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, ctx(id))) as {
    result: { protocolVersion: string };
  };
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const list = (await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" }, ctx(id))) as { result: { tools: { name: string }[] } };
  assert.ok(list.result.tools.some((t) => t.name === "read_manuscript"));
  const call = (await handleMcp(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_manuscript", arguments: {} } },
    ctx(id),
  )) as { result: { content: { text: string }[]; isError: boolean } };
  assert.equal(call.result.isError, false);
  assert.match(call.result.content[0].text, /One line\./);
  // Notifications get no reply; a batch gets one per request.
  assert.equal(await handleMcp({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx(id)), null);
  const batch = (await handleMcp(
    [
      { jsonrpc: "2.0", id: 4, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 5, method: "nope" },
    ],
    ctx(id),
  )) as { id: number; error?: { code: number } }[];
  assert.deepEqual(
    batch.map((r) => [r.id, r.error?.code]),
    [
      [4, undefined],
      [5, -32601],
    ],
  );
});

test("arguments are checked against each tool's schema", async () => {
  const { id } = await createDoc("# Args Book\n\n## Part One\n\nLine three.\nLine four.");
  const call = (name: string, args: Record<string, unknown>) => callTool(name, args, ctx(id));

  assert.deepEqual(await call("search", {}), { text: 'Missing "query".', isError: true });
  assert.deepEqual(await call("search", { query: "" }), { text: 'Missing "query".', isError: true });
  assert.deepEqual(await call("search", { query: 3 }), { text: '"query" must be a string.', isError: true });
  assert.deepEqual(await call("search", { query: "line", scope: "web" }), {
    text: '"scope" must be one of: all, manuscript, codex.',
    isError: true,
  });
  assert.equal((await call("search", { query: "line four", scope: "manuscript" })).text, "manuscript:6 [Part I]  Line four.");
  // Integers may come as strings; anything else is refused.
  assert.equal((await call("read_manuscript", { from_line: "5", to_line: 5 })).text, "Lines 5–5 of 6:\n5\tLine three.");
  assert.deepEqual(await call("read_manuscript", { from_line: 0 }), { text: '"from_line" must be a positive integer.', isError: true });
  assert.deepEqual(await call("read_manuscript", { to_line: 1.5 }), { text: '"to_line" must be a positive integer.', isError: true });
  assert.match((await call("grammar_check", { entry: "Not An Id" })).text, /not a valid entry id/);
  // Arguments the schema doesn't name are ignored.
  assert.equal((await call("list_versions", { anything: true })).isError, false);

  // new_text may be empty; replace_all takes "true" as true.
  await createEntry(id, "# Kit\n\nOne. A cat. A cat.");
  assert.equal((await call("edit_codex_entry", { id: "kit", old_text: " A cat.", new_text: "" })).isError, true); // twice
  assert.equal((await call("edit_codex_entry", { id: "kit", old_text: " A cat.", new_text: "", replace_all: "true" })).isError, false);
  assert.equal((await readEntry(id, "kit"))?.content, "# Kit\n\nOne.");
  assert.deepEqual(await call("edit_codex_entry", { id: "kit", old_text: "cat", new_text: "dog", replace_all: "yes" }), {
    text: '"replace_all" must be true or false.',
    isError: true,
  });
});

test("a book's Construct reaches the Global Codex with global: true; the Global Codex's own has its tools alone", async () => {
  const { id } = await createDoc("# Shared Tools Book");
  await createEntry(id, "# Mara\n\nA sailor.");
  const made = await callTool("create_codex_entry", { content: "# Tools Style\n\nSerial commas.", global: true }, ctx(id));
  assert.equal(made.isError, false);
  assert.deepEqual(changes.slice(-1), [{ entry: "tools-style", action: "created", global: true }]);
  assert.equal((await readEntry(GLOBAL, "tools-style"))?.content, "# Tools Style\n\nSerial commas.");
  assert.equal(await readEntry(id, "tools-style"), null);
  const listed = (await callTool("list_codex", {}, ctx(id))).text;
  assert.match(listed, /^This book's Codex:\nmara {2}"Mara"/);
  assert.match(listed, /Global Codex \(pass global: true to reach these\):[\s\S]*tools-style {2}"Tools Style"/);
  assert.equal((await callTool("read_codex_entry", { id: "tools-style" }, ctx(id))).isError, true, "not without global");

  // In the Global Codex's own chats: no manuscript, and every Codex tool works there.
  assert.equal((await callTool("read_manuscript", {}, ctx(GLOBAL))).isError, true);
  assert.equal((await callTool("read_codex_entry", { id: "tools-style" }, ctx(GLOBAL))).text, "# Tools Style\n\nSerial commas.");
  assert.doesNotMatch((await callTool("list_codex", {}, ctx(GLOBAL))).text, /mara/);
  await callTool("edit_codex_entry", { id: "tools-style", old_text: "Serial", new_text: "Oxford" }, ctx(GLOBAL));
  assert.deepEqual(changes.slice(-1), [{ entry: "tools-style", action: "edited", global: true }]);

  const book = listTools(id);
  const global = listTools(GLOBAL);
  assert.ok(book.some((t) => t.name === "read_manuscript"));
  assert.ok("global" in (book.find((t) => t.name === "read_codex_entry")?.inputSchema.properties ?? {}));
  assert.deepEqual(
    global.map((t) => t.name),
    ["list_codex", "read_codex_entry", "create_codex_entry", "edit_codex_entry", "write_codex_entry", "rename_codex_entry", "delete_codex_entry"],
  );
  for (const t of global) assert.ok(!("global" in t.inputSchema.properties), t.name);
});
