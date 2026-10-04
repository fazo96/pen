import assert from "node:assert/strict";
import { test } from "node:test";
import { createDoc, createEntry, readEntry } from "../lib/docs.ts";
import { handleMcp } from "../lib/construct/mcp.ts";
import { callTool, type CodexChange } from "../lib/construct/tools.ts";

// Construct's tools (lib/construct/tools.ts) and the MCP endpoint that serves
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
