import assert from "node:assert/strict";
import { test } from "node:test";
import { ndjsonResponse, readNdjson } from "../lib/ndjson.ts";

// Long answers streamed as JSON lines, with heartbeats for nginx (lib/ndjson.ts).

const collect = async (res: Response) => {
  const got: unknown[] = [];
  await readNdjson(res, (v) => got.push(v));
  return got;
};

test("streams the values sent, with heartbeats while it waits", async () => {
  const res = ndjsonResponse(
    async (send) => {
      send({ t: "text", text: "a" });
      await new Promise((r) => setTimeout(r, 120));
      send({ t: "done" });
    },
    { heartbeatMs: 25 },
  );
  assert.equal(res.headers.get("Content-Type"), "application/x-ndjson; charset=utf-8");
  const raw = await res.clone().text();
  assert.match(raw, /^\{"t":"text","text":"a"\}\n\n+\{"t":"done"\}\n$/);
  assert.deepEqual(await collect(res), [{ t: "text", text: "a" }, { t: "done" }]);
});

test("a failure becomes an error line", async () => {
  const res = ndjsonResponse(async () => {
    throw new Error("the agent exited (1)");
  });
  assert.deepEqual(await collect(res), [{ t: "error", error: "the agent exited (1)" }]);
});

test("carries on when the reader goes away", async () => {
  let finished = false;
  const res = ndjsonResponse(async (send) => {
    await new Promise((r) => setTimeout(r, 50));
    send({ t: "entry", id: "x" });
    finished = true;
  });
  await res.body!.cancel();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(finished, true);
});
