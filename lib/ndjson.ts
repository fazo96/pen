// Long answers (a note transcribed, a look-up question) as a stream of JSON
// lines. A self-hosted model can take minutes to load, and nginx gives up on
// a reply that's silent for 60 s, so a bare newline goes out every 20 s until
// the end. The status is sent before the work starts, so errors are lines too.
// Web APIs only: route handlers, the browser and tests all use it.

export const HEARTBEAT_MS = 20_000;

/** A response that streams what `run` sends, one JSON value per line (a failure ends it with `{ t: "error", error }`). */
export function ndjsonResponse<T = unknown>(
  run: (send: (value: T) => void) => Promise<void>,
  { heartbeatMs = HEARTBEAT_MS }: { heartbeatMs?: number } = {},
): Response {
  const enc = new TextEncoder();
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true; // the reader went away
        }
      };
      const beat = setInterval(() => write("\n"), heartbeatMs);
      run((value) => write(`${JSON.stringify(value)}\n`))
        .catch((err) => write(`${JSON.stringify({ t: "error", error: err instanceof Error ? err.message : String(err) })}\n`))
        .finally(() => {
          clearInterval(beat);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {}
        });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Read a JSON-lines response, skipping the heartbeats. */
export async function readNdjson<T>(res: Response, onValue: (value: T) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onValue(JSON.parse(line) as T);
    }
    if (done) break;
  }
  if (buffer.trim()) onValue(JSON.parse(buffer) as T);
}
