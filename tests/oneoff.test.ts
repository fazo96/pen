import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { probeModels, runOnce, TimeoutError } from "../lib/oneoff.ts";

// One-off questions to an ACP agent (lib/oneoff.ts), against a stub that
// stands in for Claude Code's adapter and pi-acp.

const stub = fileURLToPath(new URL("fixtures/stub-acp-agent.mjs", import.meta.url));
const launch = (env: Record<string, string> = {}, timeoutMs?: number) => ({
  command: [process.execPath, stub],
  cwd: path.join(tmpdir(), "pen-oneoff-test"),
  env: { STUB_MODE: "ok", ...env },
  timeoutMs,
});
const jpeg = { type: "image" as const, data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64"), mimeType: "image/jpeg" };
const png = { type: "image" as const, data: "", mimeType: "image/png" };
const ask = { type: "text" as const, text: "Transcribe." };

test("sends the prompt and collects the answer, piece by piece", { timeout: 30_000 }, async () => {
  const pieces: string[] = [];
  const thoughts: string[] = [];
  const reply = await runOnce({
    launch: launch(),
    prompt: [jpeg, png, ask],
    onText: (t) => pieces.push(t),
    onThought: (t) => thoughts.push(t),
  });
  assert.equal(reply, "Here is the transcription:\n\n# Notes\n\n2 pages: image/jpeg, image/png (on small)");
  assert.equal(pieces.join(""), reply);
  assert.deepEqual(thoughts, ["Reading the pages."], "thinking is passed on, never part of the answer");
});

test("picks the model asked for, if the agent offers it", { timeout: 30_000 }, async () => {
  assert.match(await runOnce({ launch: launch(), prompt: [ask], model: "big" }), /\(on big\)$/);
  // Gone from the picker (say, a model taken off the server): the agent's default.
  assert.match(await runOnce({ launch: launch(), prompt: [ask], model: "huge" }), /\(on small\)$/);
});

test("leaves out pi-acp's hello and notices", { timeout: 30_000 }, async () => {
  const reply = await runOnce({ launch: launch({ STUB_PI: "1" }), prompt: [ask] });
  assert.equal(reply, "Here is the transcription:\n\n# Notes\n\n0 pages:  (on small)");
});

test("waits for a slow model", { timeout: 30_000 }, async () => {
  const reply = await runOnce({ launch: launch({ STUB_MODE: "slow", STUB_DELAY: "1500" }), prompt: [ask] });
  assert.match(reply, /# Notes/);
});

test("reports an agent that fails, can't see images, says nothing or runs too long", { timeout: 30_000 }, async () => {
  await assert.rejects(runOnce({ launch: launch({ STUB_MODE: "crash" }), prompt: [ask] }), /exited \(3\): not logged in/);
  const missing = { ...launch(), command: ["pen-no-such-agent"] };
  await assert.rejects(runOnce({ launch: missing, prompt: [ask] }), /couldn't start \(.*ENOENT/);
  await assert.rejects(probeModels(missing), /couldn't start/);
  await assert.rejects(runOnce({ launch: launch({ STUB_MODE: "blind" }), prompt: [jpeg, ask] }), /can't read images/);
  // Text alone is fine for an agent without eyes.
  assert.match(await runOnce({ launch: launch({ STUB_MODE: "blind" }), prompt: [ask] }), /# Notes/);
  await assert.rejects(runOnce({ launch: launch({ STUB_MODE: "silent" }), prompt: [ask] }), /no answer/);
  await assert.rejects(runOnce({ launch: launch({ STUB_MODE: "hang" }, 1000), prompt: [ask] }), TimeoutError);
});

test("stops when the question is withdrawn", { timeout: 30_000 }, async () => {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 500);
  await assert.rejects(runOnce({ launch: launch({ STUB_MODE: "hang" }), prompt: [ask], signal: ctrl.signal }), { name: "AbortError" });
});

test("lists an agent's models", { timeout: 30_000 }, async () => {
  assert.deepEqual(await probeModels(launch()), [
    { value: "small", name: "Small" },
    { value: "big", name: "Big" },
  ]);
});
