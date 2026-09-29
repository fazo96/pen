"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { isImage, prepareCover } from "./cover";

const MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_ACCEPT = ".md,.markdown,.mdown,.txt,text/markdown,text/plain";
const IMPORT_EXT = /\.(md|markdown|mdown|txt)$/i;

async function fail(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error((body as { error?: string }).error ?? `request failed (${res.status})`);
}

/** Create, import and delete documents and set their covers, then navigate or refresh. */
export function useLibrary() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    (content: string, name?: string) =>
      run(async () => {
        const res = await fetch("/api/docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, name }),
        });
        if (!res.ok) await fail(res);
        const doc = (await res.json()) as { id: string };
        router.push(`/d/${doc.id}`);
      }),
    [router, run],
  );

  const createNew = useCallback(() => create("# Untitled\n\n", "untitled"), [create]);

  const importFile = useCallback(
    async (file: File) => {
      if (!IMPORT_EXT.test(file.name)) {
        setError(`${file.name} isn't a markdown or text file`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`${file.name} is larger than 5 MB`);
        return;
      }
      await create(await file.text(), file.name.replace(IMPORT_EXT, ""));
    },
    [create],
  );

  const remove = useCallback(
    (id: string) =>
      run(async () => {
        const res = await fetch(`/api/docs/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) await fail(res);
        try {
          localStorage.removeItem(`pen:backup:${id}`);
        } catch {}
        router.refresh();
      }),
    [router, run],
  );

  const setCover = useCallback(
    (id: string, file: File) =>
      run(async () => {
        if (!isImage(file)) throw new Error(`${file.name} isn't an image`);
        const res = await fetch(`/api/docs/${id}/cover`, { method: "PUT", body: await prepareCover(file) });
        if (!res.ok) await fail(res);
        router.refresh();
      }),
    [router, run],
  );

  const removeCover = useCallback(
    (id: string) =>
      run(async () => {
        const res = await fetch(`/api/docs/${id}/cover`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) await fail(res);
        router.refresh();
      }),
    [router, run],
  );

  return { busy, error, clearError: () => setError(null), createNew, importFile, remove, setCover, removeCover };
}
