// What pen keeps on this device so it opens without a connection
// (docs/editor.md, "Offline"). The service worker (public/sw.js) keeps the
// pages; this keeps copies of a few API reads, and of each document as this
// device last saved or read it, in Cache Storage. Nothing here is the source
// of truth: saves still go to the server with their baseVersion.
// Every function is safe where Cache Storage is missing or blocked (plain
// http, some private windows): it reads as empty and writes nothing.

const PAGES = "pen-pages"; // the service worker's
const COPIES = "pen-copies";
/** Set on kept pages by the service worker: when, by this device's clock. */
const KEPT_AT = "x-pen-kept-at";

type Copy<T> = { at: number; data: T };

/** The page's key in the service worker's cache; null for pages it doesn't keep. Same as pageKey in public/sw.js. */
export function pageKey(url: URL): string | null {
  if (url.pathname === "/") return url.searchParams.has("library") ? "/?library" : "/";
  if (/^\/d\/[^/]+(\/codex\/[^/]+)?$/.test(url.pathname) || /^\/codex\/[^/]+$/.test(url.pathname)) return url.pathname;
  return null;
}

/** API reads worth a copy: the books, a manuscript, a book's Codex (or the Global Codex, _global), an entry. */
export const keepsCopy = (path: string) =>
  /^\/api\/docs(\/[a-z0-9-]+(\/codex(\/[a-z0-9-]+)?)?)?$/.test(path) || /^\/api\/docs\/_global\/codex(\/[a-z0-9-]+)?$/.test(path);

async function open(name: string): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(name);
  } catch {
    return null;
  }
}

/** Keep `data` as the latest copy of `path` on this device. */
export async function saveCopy(path: string, data: unknown): Promise<void> {
  try {
    await (await open(COPIES))?.put(path, Response.json({ at: Date.now(), data }));
  } catch {}
}

export async function readCopy<T>(path: string): Promise<Copy<T> | null> {
  try {
    const res = await (await open(COPIES))?.match(path);
    return res ? ((await res.json()) as Copy<T>) : null;
  } catch {
    return null;
  }
}

/** When the service worker kept the page now open; null if it didn't. */
async function pageKeptAt(): Promise<number | null> {
  try {
    const key = pageKey(new URL(location.href));
    if (!key) return null;
    const at = Number((await (await open(PAGES))?.match(key))?.headers.get(KEPT_AT));
    return at || null;
  } catch {
    return null;
  }
}

/**
 * Offline, the page may be the copy the service worker kept when it was last
 * opened, older than what this device saved since: that newer copy of `path`,
 * if there is one. A page that came from the server (not kept, or kept after
 * the copy) wins.
 */
export async function newerCopy<T>(path: string): Promise<T | null> {
  const [copy, keptAt] = await Promise.all([readCopy<T>(path), pageKeptAt()]);
  return copy && keptAt !== null && copy.at > keptAt ? copy.data : null;
}

/** Drop the kept pages and copies (signed out: they'd be readable without the password). */
export async function forgetOffline(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all([PAGES, COPIES].map((name) => caches.delete(name).catch(() => false)));
}
