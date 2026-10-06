// The browser's side of pen's JSON API. `api` is fetch for the common case: it
// sends `json` as the body, never uses the HTTP cache, and on an error status
// throws an ApiError carrying the server's own message ({ error } in the body).
// Reads of the books, the Codex and its entries keep a copy on this device
// (lib/offline.ts), answered with when the network fails.
// Saves (lib/useAutosave.ts), beacons and streamed answers use fetch directly:
// they need the raw response.

import { keepsCopy, readCopy, saveCopy } from "./offline";
import type { VersionMeta } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Init = Omit<RequestInit, "body" | "headers"> & { json?: unknown; body?: BodyInit; headers?: Record<string, string> };

/** The response's JSON (undefined for a 204). Throws ApiError on an error status, TypeError when offline (and no copy is kept). */
export async function api<T = unknown>(path: string, { json, ...init }: Init = {}): Promise<T> {
  const kept = (init.method ?? "GET") === "GET" && keepsCopy(path);
  let res: Response;
  try {
    res = await fetch(path, {
      cache: "no-store",
      ...init,
      ...(json !== undefined
        ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...init.headers } }
        : {}),
    });
  } catch (err) {
    const copy = kept ? await readCopy<T>(path) : null;
    if (copy) return copy.data;
    throw err;
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new ApiError(res.status, typeof data?.error === "string" ? data.error : `request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json()) as T;
  if (kept) void saveCopy(path, data);
  return data;
}

/** A DELETE that's done when it succeeds or the thing is already gone (404). */
export async function apiDelete(path: string): Promise<void> {
  try {
    await api(path, { method: "DELETE" });
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err;
  }
}

/** Save a named version of the manuscript as it is on the server. */
export const saveVersion = (docId: string, label: string) =>
  api<VersionMeta>(`/api/docs/${docId}/versions`, { method: "POST", json: { label } });

/** A new, untitled Codex entry (from the Codex list or the command palette); its id. */
export const createEntry = async (projectId: string) =>
  (
    await api<{ id: string }>(`/api/docs/${projectId}/codex`, {
      method: "POST",
      json: { content: "# Untitled entry\n\n", name: "entry" },
    })
  ).id;

/** Move an entry to another Codex: a book's, or the Global Codex (GLOBAL); its id there. */
export const moveEntry = async (owner: string, eid: string, to: string) =>
  (await api<{ id: string }>(`/api/docs/${owner}/codex/${eid}/move`, { method: "POST", json: { to } })).id;
