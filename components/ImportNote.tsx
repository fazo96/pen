"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ImportEvent, ImportMeta, ImportStatus } from "@/lib/imports";
import { readNdjson } from "@/lib/ndjson";
import { IconBack, IconStop } from "./icons";
import Logo from "./Logo";
import ThemeButton from "./ThemeButton";

type Props = {
  projectId: string;
  book: string;
  jobId: string;
  /** The job as the server had it, or null when it's gone (an hour after it ended, or a restart). */
  job: ImportMeta | null;
};

/**
 * A handwritten note being transcribed (lib/imports.ts): its photos, the
 * model's answer as it comes (a reasoning model's thinking first, folded away
 * once the answer starts), the entry it made.
 */
export default function ImportNote({ projectId, book, jobId, job }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<ImportStatus | null>(job?.status ?? null);
  const [text, setText] = useState("");
  const [thinking, setThinking] = useState("");
  const [entry, setEntry] = useState(job?.entry ?? null);
  const [error, setError] = useState(job?.error ?? null);
  const [lost, setLost] = useState(false);
  const [stopping, setStopping] = useState(false);
  const out = useRef<HTMLDivElement>(null);
  /** Follow the text down while the reader is at the bottom. */
  const pinned = useRef(true);
  const api = `/api/docs/${projectId}/imports/${jobId}`;
  const pages = job?.pages ?? 0;

  useEffect(() => {
    if (!job) return;
    const ctl = new AbortController();
    (async () => {
      // The stream can be cut (nginx, a phone asleep): pick it up again from the snapshot.
      for (let tries = 0; !ctl.signal.aborted && tries < 30; tries++) {
        let ended = false;
        try {
          const res = await fetch(api, { cache: "no-store", signal: ctl.signal });
          if (res.status === 404) {
            setLost(true);
            return;
          }
          if (!res.ok) throw new Error();
          await readNdjson<ImportEvent>(res, (e) => {
            if (e.t === "state") {
              setText(e.text);
              setThinking(e.thinking);
              setStatus(e.status);
              setEntry(e.entry ?? null);
              setError(e.error ?? null);
              ended = e.status !== "running";
            } else if (e.t === "text") setText((t) => t + e.text);
            else if (e.t === "thought") setThinking((t) => t + e.text);
            else if (e.t === "entry") {
              setEntry(e.id);
              setStatus("done");
              ended = true;
            } else if (e.t === "error") {
              setError(e.error);
              setStatus("failed");
              ended = true;
            }
          });
        } catch {
          if (ctl.signal.aborted) return;
        }
        if (ended) return;
        await new Promise((r) => setTimeout(r, 2000));
      }
    })();
    return () => ctl.abort();
  }, [api, job]);

  useEffect(() => {
    const el = out.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, thinking]);

  const stop = async () => {
    setStopping(true);
    await fetch(api, { method: "DELETE" }).catch(() => {});
    setStopping(false);
  };
  const dismiss = async () => {
    await fetch(api, { method: "DELETE" }).catch(() => {});
    router.push(`/d/${projectId}`);
  };

  const what = pages === 1 ? "a picture" : `${pages} pictures`;
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <Link href={`/d/${projectId}`} className="icon-btn" aria-label="Back to the book" title="Back to the book">
            <IconBack />
          </Link>
          <Link href="/?library" className="wordmark" aria-label="Library" title="Library">
            <Logo />
          </Link>
          <span className="topbar-title">Handwritten note</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className="welcome settings import-note">
          <span className="label">pen · {book} · codex</span>
          <h1 className="welcome-title">Handwritten note</h1>

          {!job || lost ? (
            <p className="welcome-lede">
              This import is no longer here: finished ones are kept for an hour, and a restart of pen ends them. Look for
              its entry in the <Link href={`/d/${projectId}`}>book’s Codex</Link>.
            </p>
          ) : (
            <>
              <p className="welcome-lede" role="status">
                {status === "running" &&
                  (text
                    ? `Transcribing ${what}…`
                    : thinking
                      ? `Transcribing ${what}… the model is thinking it over first.`
                      : `Transcribing ${what}… waiting for the model, which can take a minute, longer if a self-hosted one has to load.`)}
                {status === "done" && entry && (
                  <>
                    Done. <Link href={`/d/${projectId}/codex/${entry}`}>Open the entry</Link>
                  </>
                )}
                {status === "failed" && (error === "stopped" ? "Stopped." : `Couldn’t transcribe ${what}: ${error}`)}
              </p>

              <div className="import-pages">
                {Array.from({ length: pages }, (_, n) => (
                  <a key={n} href={`${api}/${n}`} target="_blank" rel="noreferrer" title={`Page ${n + 1}`}>
                    <img src={`${api}/${n}`} alt={`Page ${n + 1}`} />
                  </a>
                ))}
              </div>

              {thinking && text && (
                <details className="import-thinking-fold">
                  <summary>Thinking</summary>
                  <div className="import-thinking">{thinking}</div>
                </details>
              )}

              {(text || thinking) && (
                <div
                  ref={out}
                  className={`import-text ${status === "running" ? "is-running" : ""}`}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
                  }}
                >
                  {text || <span className="import-thinking">{thinking}</span>}
                  {status === "running" && <span className="import-caret" aria-hidden />}
                </div>
              )}

              <div className="settings-actions">
                {status === "running" && (
                  <button type="button" className="btn" onClick={stop} disabled={stopping}>
                    <IconStop /> Stop
                  </button>
                )}
                {status === "done" && entry && (
                  <Link className="btn btn-primary" href={`/d/${projectId}/codex/${entry}`}>
                    Open the entry
                  </Link>
                )}
                {status === "failed" && (
                  <button type="button" className="btn" onClick={dismiss}>
                    Dismiss
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
