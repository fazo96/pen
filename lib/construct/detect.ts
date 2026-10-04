import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Whether Construct's agents can run on this server. pen's AI features are
// off unless one is found: Claude Code (its command, or a login it can use)
// or pi. Imports nothing from pen, so tests load it with plain Node.

type Env = Record<string, string | undefined>;

/** Whether `cmd --version` runs. */
export const runs = (cmd: string) => spawnSync(cmd, ["--version"], { stdio: "ignore", timeout: 10_000 }).status === 0;

/**
 * Claude Code: the `claude` command (`PEN_CLAUDE` names another), or a
 * credential the agent can use without it (the Docker image has only the ACP
 * agent, with a token in the environment, or a login in CLAUDE_CONFIG_DIR).
 */
export function claudeFound(env: Env = process.env, run = runs, exists: (file: string) => boolean = existsSync): boolean {
  if (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY) return true;
  const config = env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
  if (exists(path.join(config, ".credentials.json"))) return true;
  return run(env.PEN_CLAUDE || "claude");
}

/** pi: the `pi` command (`PEN_PI` names another). */
export const piFound = (env: Env = process.env, run = runs) => run(env.PEN_PI || "pi");

/** `PEN_AI=off` turns AI off even with an agent installed. */
export const aiSwitchedOff = (env: Env = process.env) => /^(off|0|false|no)$/i.test(env.PEN_AI ?? "");
