// A stand-in for Claude Code's ACP adapter: reads the prompt and "transcribes"
// it by naming what it was sent. STUB_MODE picks a misbehaviour.
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const mode = process.env.STUB_MODE ?? "ok";
if (mode === "crash") {
  console.error("not logged in");
  process.exit(3);
}

new AgentSideConnection(
  (conn) => ({
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { promptCapabilities: { image: mode !== "blind" } },
    }),
    newSession: async () => ({ sessionId: "s1" }),
    authenticate: async () => ({}),
    cancel: async () => {},
    prompt: async ({ sessionId, prompt }) => {
      if (mode === "hang") await new Promise(() => {});
      const images = prompt.filter((b) => b.type === "image").map((b) => b.mimeType);
      const say = (text) => conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
      if (mode !== "silent") {
        await say("Here is the transcription:\n\n# Notes\n\n");
        await say(`${images.length} pages: ${images.join(", ")}`);
      }
      return { stopReason: "end_turn" };
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
