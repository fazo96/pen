import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { keepsCopy, newerCopy, pageKey, readCopy, saveCopy } from "../lib/offline.ts";

// The service worker has its own copy of pageKey (it's plain JS in public/).
const swSource = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const swPageKey = new Function(`${/function pageKey\(url\) \{[\s\S]*?\n\}/.exec(swSource)?.[0]}; return pageKey;`)() as (
  url: URL,
) => string | null;

const URLS = [
  "/",
  "/?library",
  "/?library=1&x=2",
  "/d/rain",
  "/d/rain?entry=storm&cite=x",
  "/d/rain/codex/storm",
  "/codex/style",
  "/codex",
  "/d/rain/settings",
  "/d/rain/import/job",
  "/settings",
  "/unlock",
  "/api/docs/rain",
];

test("keeps the library, books and entries, by path (the library's ?library apart)", () => {
  const key = (u: string) => pageKey(new URL(u, "https://pen.test"));
  assert.equal(key("/"), "/");
  assert.equal(key("/?library"), "/?library");
  assert.equal(key("/d/rain?entry=storm&cite=x"), "/d/rain");
  assert.equal(key("/d/rain/codex/storm"), "/d/rain/codex/storm");
  assert.equal(key("/codex/style"), "/codex/style");
  assert.equal(key("/codex"), null, "a redirect to an entry");
  for (const u of ["/d/rain/settings", "/d/rain/import/job", "/settings", "/unlock", "/api/docs/rain"]) {
    assert.equal(key(u), null, u);
  }
});

test("the service worker's pageKey agrees", () => {
  for (const u of URLS) {
    const url = new URL(u, "https://pen.test");
    assert.equal(swPageKey(url), pageKey(url), u);
  }
});

test("copies the reads offline pages need, nothing else", () => {
  for (const p of ["/api/docs", "/api/docs/rain", "/api/docs/rain/codex", "/api/docs/rain/codex/storm", "/api/docs/_global/codex", "/api/docs/_global/codex/style"]) {
    assert.ok(keepsCopy(p), p);
  }
  for (const p of ["/api/docs/rain/versions", "/api/docs/rain/spot", "/api/docs/rain/imports", "/api/shelves", "/api/docs?x", "/api/docs/_global", "/api/docs/_global/spot"]) {
    assert.equal(keepsCopy(p), false, p);
  }
});

test("without Cache Storage, nothing is kept and nothing breaks", async () => {
  await saveCopy("/api/docs/rain", { id: "rain" });
  assert.equal(await readCopy("/api/docs/rain"), null);
  assert.equal(await newerCopy("/api/docs/rain"), null);
});
