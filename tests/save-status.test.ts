import assert from "node:assert/strict";
import { test } from "node:test";
import { times, when } from "../lib/saveStatus.ts";

const at = (d: string) => new Date(d).getTime(); // local time
const now = at("2026-10-04T15:00:00");

test("today: the time and how long ago", () => {
  assert.equal(when(at("2026-10-04T14:59:40"), now), "14:59 (just now)");
  assert.equal(when(at("2026-10-04T14:58:00"), now), "14:58 (2 min ago)");
  assert.equal(when(at("2026-10-04T11:30:00"), now), "11:30 (3 h ago)");
});

test("earlier days by date, the year only when it isn't this one", () => {
  assert.equal(when(at("2026-10-03T18:02:00"), now), "yesterday at 18:02");
  assert.equal(when(at("2026-09-28T09:05:00"), now), "28 Sep at 09:05");
  assert.equal(when(at("2025-12-31T23:59:00"), now), "31 Dec 2025 at 23:59");
});

test("never yet", () => {
  assert.equal(when(null, now), "not yet");
});

test("offline, when the server last answered comes first", () => {
  assert.deepEqual(times("saved", 1, 2, now).map((t) => t.label), ["Last saved from this device", "Last reached the server"]);
  assert.deepEqual(times("offline", 1, 2, now).map((t) => t.label), ["Last reached the server", "Last saved from this device"]);
});
