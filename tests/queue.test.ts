import assert from "node:assert/strict";
import { test } from "node:test";
import { queue } from "../lib/queue.ts";

// Named queues that serialize file updates (lib/queue.ts).

const tick = () => new Promise((r) => setTimeout(r, 5));

test("runs one at a time, in order", async () => {
  const run = queue("test-order");
  const log: string[] = [];
  const job = (name: string) => async () => {
    log.push(`${name} start`);
    await tick();
    log.push(`${name} end`);
    return name;
  };
  assert.deepEqual(await Promise.all([run(job("a")), run(job("b"))]), ["a", "b"]);
  assert.deepEqual(log, ["a start", "a end", "b start", "b end"]);
});

test("a failure rejects its own call and doesn't stop the next", async () => {
  const run = queue("test-failure");
  const failed = run(async () => {
    throw new Error("boom");
  });
  const next = run(async () => "ok");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
});

test("the same name gives the same queue, even from another copy of the module", async () => {
  assert.equal(queue("test-shared"), queue("test-shared"));
  const again = await import(`../lib/queue.ts?copy=${Date.now()}`);
  assert.equal(again.queue("test-shared"), queue("test-shared"));
  assert.notEqual(queue("test-shared"), queue("test-other"));
});
