"use client";

import { useEffect, useState } from "react";
import type { PromptContext, QuickLine } from "./construct/types";
import { readNdjson } from "./ndjson";

// A question answered once by Construct's quick-action model, outside the
// chat (POST /api/docs/<id>/construct/quick), streamed in as it comes: for
// the popover over the text (components/QuickAnswer.tsx) and Cadence's
// questions. A new `ask` (by identity) asks again; dropping it stops the answer.

// A self-hosted model may be loading: say so if nothing has come by then.
const SLOW_MS = 10_000;

export type QuickAsk = { prompt: string; context: PromptContext };
export type QuickStatus = "asking" | "slow" | "done" | "error";

export function useQuickAnswer(projectId: string, ask: QuickAsk) {
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<QuickStatus>("asking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setAnswer("");
    setStatus("asking");
    setError(null);
    const slow = setTimeout(() => setStatus((s) => (s === "asking" ? "slow" : s)), SLOW_MS);
    (async () => {
      const res = await fetch(`/api/docs/${projectId}/construct/quick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: ask.prompt, context: ask.context }),
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new Error("Locked. Unlock pen to ask Construct.");
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn’t ask Construct.");
      let ended = false;
      await readNdjson<QuickLine>(res, (line) => {
        if (line.t === "text") {
          clearTimeout(slow);
          setAnswer((a) => a + line.text);
          setStatus((s) => (s === "slow" ? "asking" : s));
        } else if (line.t === "done") {
          ended = true;
          setStatus("done");
        } else if (line.t === "error") {
          ended = true;
          setError(line.error);
          setStatus("error");
        }
      });
      if (!ended) throw new Error("The answer was cut off.");
    })()
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message || "Couldn’t reach pen.");
        setStatus("error");
      })
      .finally(() => clearTimeout(slow));
    return () => {
      ctrl.abort();
      clearTimeout(slow);
    };
  }, [projectId, ask]);

  return { answer, status, error };
}
