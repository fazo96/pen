// A stand-in for an ACP agent (Claude Code's adapter, pi-acp): it "answers"
// by naming what it was sent and which model it's on. STUB_MODE picks a
// misbehaviour; STUB_PI=1 adds pi-acp's habits (a hello and notices sent as
// message text, marked as such in `_meta`).
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const mode = process.env.STUB_MODE ?? "ok";
const pi = process.env.STUB_PI === "1";
if (mode === "crash") {
  console.error("not logged in");
  process.exit(3);
}

let model = "small";
const config = () => [
  {
    type: "select",
    id: "model",
    category: "model",
    name: "Model",
    currentValue: model,
    options: [
      { value: "small", name: "Small" },
      { value: "big", name: "Big" },
    ],
  },
];
const stops = new Map();

new AgentSideConnection(
  (conn) => {
    const say = (sessionId, text, _meta) =>
      conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text }, ...(_meta && { _meta }) } });
    return {
      initialize: async () => ({
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, promptCapabilities: { image: mode !== "blind" } },
      }),
      newSession: async () => {
        if (pi) setTimeout(() => void say("s1", "Hello from stub"), 0);
        return { sessionId: "s1", configOptions: config(), ...(pi && { _meta: { piAcp: { startupInfo: "Hello from stub" } } }) };
      },
      setSessionConfigOption: async ({ value }) => {
        model = value;
        return { configOptions: config() };
      },
      authenticate: async () => ({}),
      cancel: async ({ sessionId }) => stops.get(sessionId)?.(),
      prompt: async ({ sessionId, prompt }) => {
        if (mode === "hang") return new Promise((resolve) => stops.set(sessionId, () => resolve({ stopReason: "cancelled" })));
        if (mode === "slow") await new Promise((r) => setTimeout(r, Number(process.env.STUB_DELAY ?? 1000)));
        const images = prompt.filter((b) => b.type === "image").map((b) => b.mimeType);
        if (pi) await say(sessionId, "MCP: 1 servers connected", { piAcp: { notify: { level: "info" } } });
        if (mode !== "silent") {
          await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Reading the pages." } } });
          await say(sessionId, "Here is the transcription:\n\n# Notes\n\n");
          await say(sessionId, `${images.length} pages: ${images.join(", ")} (on ${model})`);
        }
        return { stopReason: "end_turn" };
      },
    };
  },
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
