// Photos of a handwritten note being transcribed (lib/transcribe.ts): each
// import is a job that runs in the server process, outliving the request that
// started it, so its page (/d/<id>/import/<job>) can be left and opened again,
// and the Codex list can show it while it runs. Kept in memory only, on
// globalThis so dev reloads keep it: a restart ends the agent anyway. The
// photos never touch the disk. Imports nothing from pen, so tests load it
// with plain Node.

import { randomBytes } from "node:crypto";

/** How long a finished job (its page, its link to the entry) stays around. */
export const KEEP_MS = 60 * 60_000;

export type Page = { data: Buffer; mimeType: string };
export type ImportStatus = "running" | "done" | "failed";

/** What the Codex list shows of a job. */
export type ImportMeta = {
  id: string;
  pages: number;
  status: ImportStatus;
  started: number;
  entry?: string;
  error?: string;
};

/**
 * A job's stream, as the page reads it: a snapshot, the text (and a reasoning
 * model's thinking before it) as it comes, then how it ended.
 */
export type ImportEvent =
  | { t: "state"; pages: number; status: ImportStatus; text: string; thinking: string; entry?: string; error?: string }
  | { t: "text"; text: string }
  | { t: "thought"; text: string }
  | { t: "entry"; id: string }
  | { t: "error"; error: string };

/** The work itself: transcribe the pages (`onText` as the answer arrives), save the entry, give its id. */
export type Work = (job: {
  pages: Page[];
  onText: (text: string) => void;
  onThought: (text: string) => void;
  signal: AbortSignal;
}) => Promise<string>;

type Job = Omit<ImportMeta, "pages"> & {
  project: string;
  photos: Page[];
  text: string;
  thinking: string;
  ended?: number;
  abort: AbortController;
  listeners: Set<(e: ImportEvent) => void>;
};

const g = globalThis as typeof globalThis & { __penImports?: Map<string, Job> };
const jobs = (g.__penImports ??= new Map());

const meta = (j: Job): ImportMeta => ({
  id: j.id,
  pages: j.photos.length,
  status: j.status,
  started: j.started,
  ...(j.entry && { entry: j.entry }),
  ...(j.error && { error: j.error }),
});

/** Forget finished jobs older than KEEP_MS. */
function sweep(now = Date.now()) {
  for (const [id, j] of jobs) if (j.ended && now - j.ended > KEEP_MS) jobs.delete(id);
}

const emit = (j: Job, e: ImportEvent) => {
  for (const l of j.listeners) l(e);
};

/** Start transcribing `photos` for `project`; the job's id, at once. */
export function startImport(project: string, photos: Page[], work: Work): string {
  sweep();
  const id = randomBytes(8).toString("hex");
  const job: Job = {
    id,
    project,
    photos,
    status: "running",
    started: Date.now(),
    text: "",
    thinking: "",
    abort: new AbortController(),
    listeners: new Set(),
  };
  jobs.set(id, job);
  const onText = (text: string) => {
    if (job.status !== "running") return;
    job.text += text;
    emit(job, { t: "text", text });
  };
  const onThought = (text: string) => {
    if (job.status !== "running") return;
    job.thinking += text;
    emit(job, { t: "thought", text });
  };
  work({ pages: photos, onText, onThought, signal: job.abort.signal }).then(
    (entry) => {
      job.status = "done";
      job.entry = entry;
      job.ended = Date.now();
      emit(job, { t: "entry", id: entry });
    },
    (err) => {
      job.status = "failed";
      job.error = job.abort.signal.aborted ? "stopped" : err instanceof Error ? err.message : String(err);
      job.ended = Date.now();
      emit(job, { t: "error", error: job.error });
    },
  );
  return id;
}

const find = (project: string, id: string) => {
  const j = jobs.get(id);
  return j && j.project === project ? j : undefined;
};

/** The project's jobs, oldest first. */
export function listImports(project: string): ImportMeta[] {
  sweep();
  return [...jobs.values()].filter((j) => j.project === project).map(meta);
}

export function getImport(project: string, id: string): ImportMeta | null {
  const j = find(project, id);
  return j ? meta(j) : null;
}

/** The job's nth photo (from 0). */
export function importPage(project: string, id: string, n: number): Page | null {
  return find(project, id)?.photos[n] ?? null;
}

/**
 * Follow a job: `on` gets a snapshot first, then what happens next, ending with
 * an `entry` or `error` event. Returns a function to stop following, or null
 * for an unknown job.
 */
export function watchImport(project: string, id: string, on: (e: ImportEvent) => void): (() => void) | null {
  const j = find(project, id);
  if (!j) return null;
  on({
    t: "state",
    pages: j.photos.length,
    status: j.status,
    text: j.text,
    thinking: j.thinking,
    ...(j.entry && { entry: j.entry }),
    ...(j.error && { error: j.error }),
  });
  if (j.status !== "running") return () => {};
  j.listeners.add(on);
  return () => j.listeners.delete(on);
}

/** Stop a running job, or forget a finished one. False for an unknown job. */
export function dropImport(project: string, id: string): boolean {
  const j = find(project, id);
  if (!j) return false;
  if (j.status === "running") j.abort.abort();
  else jobs.delete(id);
  return true;
}
