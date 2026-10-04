import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  type Client,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";

// Photos of handwritten notes, read into a Codex entry by a one-off ACP agent
// (Construct's Claude Code, with no tools at all): one prompt with the pages,
// its reply is the entry. Nothing here touches Construct's chats. Imports
// nothing from pen, so tests load it with plain Node and a stub agent.

/** Pages per entry, and bytes per page (Claude's own limit is 5 MB). */
export const MAX_PAGES = 10;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 3 * 60_000;

/** The formats Claude reads, by their first bytes: the MIME type sent can't be trusted. */
export function imageTypeOf(data: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...data.subarray(from, to));
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return "image/gif";
  return null;
}

/** What the book already calls things, so names in the notes come out spelled right. */
export type Hints = { book: string; entries: string[] };

export function transcribePrompt(pages: number, { book, entries }: Hints): string {
  const names = entries.slice(0, 200).map((t) => `- ${t}`).join("\n");
  return `${pages > 1 ? `These ${pages} photos are pages of one handwritten note, in order.` : "This photo is a handwritten note."} Transcribe it into markdown for the Codex (the notes kept beside a novel) of the book "${book}".

- Transcribe faithfully: the writer's own words, spelling and order. Don't correct, summarize, complete or tidy the writing.
- Keep the structure: headings, lists, numbering, indentation, arrows (→), underlined or boxed words as **bold**. Lines that run on into each other are one paragraph.
- Start with an H1 ("# ") that is the note's title: its own heading if it has one, else a short title made from what it's about.
- The handwriting is hard to read, and the point is to save the writer from retyping it: a wrong guess is far better than a gap. Transcribe every word you can see, giving your best reading of each, using the context of the sentence and the book's names. Never skip, shorten or summarize a part because it's hard to read.
- Put a ? in brackets right after a word you guessed, like harbour[?], so the writer can check it; don't bracket words you're fairly sure of. Write [illegible] only when you can't even guess at a word, never for a whole line or passage you could partly read.
- Mention a drawing or diagram in one line in italics, e.g. *[sketch of the harbour]*, and still transcribe any words written on it.
- Crossed-out words are left out.
- Use straight quotes (" and ').
- Reply with the markdown only: no preamble, no remarks, no code fence.${names ? `\n\nThe book's Codex already has these entries; prefer their spelling for names that look alike:\n${names}` : ""}`;
}

/** The agent's reply as an entry: fences and stray preamble gone, an H1 on top. */
export function entryFromReply(reply: string): string {
  let text = reply.replace(/\r\n?/g, "\n").trim();
  const fenced = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  // Anything said before the title ("Here's the transcription:") goes.
  const h1 = text.search(/^# /m);
  if (h1 > 0 && text.slice(0, h1).trim().split("\n").length <= 2) text = text.slice(h1);
  text = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  if (!/^# /.test(text)) text = `# Handwritten note\n\n${text}`;
  return `${text}\n`;
}

export type AgentLaunch = {
  command: string[];
  cwd: string;
  /** `_meta` for session/new (the agent's lockdown options). */
  sessionMeta?: Record<string, unknown>;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type Page = { data: string; mimeType: string };

/** Ask a fresh agent to read the pages; resolves to its reply's text. */
export async function runTranscription(pages: Page[], prompt: string, launch: AgentLaunch): Promise<string> {
  await mkdir(launch.cwd, { recursive: true });
  const [cmd, ...args] = launch.command;
  const child = spawn(cmd, args, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (chunk: string) => {
    stderr.push(...chunk.split("\n").filter(Boolean));
    if (stderr.length > 20) stderr.splice(0, stderr.length - 20);
  });
  const detail = () => (stderr.length ? `: ${stderr.slice(-3).join(" · ")}` : "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const failed = new Promise<never>((_, reject) => {
    child.on("error", (err) => reject(new Error(`couldn't start the agent (${err.message})`)));
    child.on("exit", (code, signal) => reject(new Error(`the agent exited (${signal ?? code})${detail()}`)));
    timer = setTimeout(() => reject(new TimeoutError()), launch.timeoutMs ?? TIMEOUT_MS);
  });

  let reply = "";
  let sessionId = "";
  const client: Client = {
    // It has no tools to ask about; refuse whatever it asks anyway.
    requestPermission: async (p) => {
      const reject = p.options.find((o) => o.kind.startsWith("reject"));
      return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
    },
    sessionUpdate: async ({ sessionId: sid, update: u }) => {
      if (sid === sessionId && u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") reply += u.content.text;
    },
  };

  try {
    const conn = new ClientSideConnection(
      () => client,
      ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>,
      ),
    );
    const run = async () => {
      const init = await conn.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "pen", version: "0.1.0" },
      });
      if (!init.agentCapabilities?.promptCapabilities?.image) throw new Error("the agent can't read images");
      const session = await conn.newSession({ cwd: launch.cwd, mcpServers: [], _meta: launch.sessionMeta });
      sessionId = session.sessionId;
      const blocks: ContentBlock[] = [
        ...pages.map((p): ContentBlock => ({ type: "image", data: p.data, mimeType: p.mimeType })),
        { type: "text", text: prompt },
      ];
      const res = await conn.prompt({ sessionId, prompt: blocks });
      if (res.stopReason === "refusal") throw new Error("the agent declined to read it");
      if (!reply.trim()) throw new Error("the agent gave no transcription");
      return reply;
    };
    return await Promise.race([
      run().catch(async (err) => {
        // A crash reaches the connection ("closed") before the exit: say why it exited instead.
        await Promise.race([failed, new Promise((r) => setTimeout(r, 500))]);
        throw err;
      }),
      failed,
    ]);
  } finally {
    clearTimeout(timer);
    failed.catch(() => {}); // the exit we cause below isn't news
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    }
  }
}

export class TimeoutError extends Error {
  constructor() {
    super("the agent took too long");
  }
}
