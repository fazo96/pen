import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { aiSwitchedOff, claudeFound, piFound } from "../lib/construct/detect.ts";

const nothing = () => false;

test("Claude Code is found by its command", () => {
  const ran: string[] = [];
  const run = (cmd: string) => {
    ran.push(cmd);
    return cmd === "claude";
  };
  assert.equal(claudeFound({ HOME: "/home/w" }, run, nothing), true);
  assert.deepEqual(ran, ["claude"]);
  assert.equal(claudeFound({ HOME: "/home/w", PEN_CLAUDE: "/opt/claude" }, run, nothing), false);
  assert.equal(claudeFound({ HOME: "/home/w", PEN_CLAUDE: "/opt/claude" }, (c) => c === "/opt/claude", nothing), true);
});

test("Claude Code is found by a credential, without its command (the Docker image)", () => {
  assert.equal(claudeFound({ CLAUDE_CODE_OAUTH_TOKEN: "t" }, nothing, nothing), true);
  assert.equal(claudeFound({ ANTHROPIC_API_KEY: "k" }, nothing, nothing), true);
  assert.equal(claudeFound({ CLAUDE_CODE_OAUTH_TOKEN: "" }, nothing, nothing), false);
  const login = (dir: string) => (p: string) => p === path.join(dir, ".credentials.json");
  assert.equal(claudeFound({ CLAUDE_CONFIG_DIR: "/data/.claude" }, nothing, login("/data/.claude")), true);
  assert.equal(claudeFound({ HOME: "/home/w" }, nothing, login("/home/w/.claude")), true);
  assert.equal(claudeFound({ HOME: "/home/w" }, nothing, login("/elsewhere")), false);
});

test("pi is found by its command", () => {
  assert.equal(piFound({}, (c) => c === "pi"), true);
  assert.equal(piFound({ PEN_PI: "/opt/pi" }, (c) => c === "pi"), false);
  assert.equal(piFound({}, nothing), false);
});

test("PEN_AI=off turns AI off", () => {
  for (const v of ["off", "OFF", "0", "false", "no"]) assert.equal(aiSwitchedOff({ PEN_AI: v }), true, v);
  for (const v of [undefined, "", "on", "1"]) assert.equal(aiSwitchedOff({ PEN_AI: v }), false, String(v));
});
