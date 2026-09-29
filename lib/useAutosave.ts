"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "saved" | "unsaved" | "saving" | "offline" | "conflict";
export type Story = { id: string; content: string; version: string };

const IDLE_MS = 1200;
const RETRY_MS = 5000;

type Backup = { content: string; baseVersion: string };

function readBackup(key: string): Backup | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}

function writeBackup(key: string, b: Backup | null) {
  try {
    if (b) localStorage.setItem(key, JSON.stringify(b));
    else localStorage.removeItem(key);
  } catch {}
}

type Options = {
  initial: Story;
  /** Serialize the editor to markdown; null while the editor isn't ready. */
  getContent: () => string | null;
  /** Replace the editor contents without triggering a save. */
  setContent: (markdown: string) => void;
  ready: boolean;
};

/**
 * Saves the story to the server after the writer pauses.
 *
 * Every save carries the version it was based on. If another device saved in
 * between, the server answers 409 and we stop and ask instead of overwriting.
 */
export function useAutosave({ initial, getContent, setContent, ready }: Options) {
  const url = `/api/docs/${initial.id}`;
  const backupKey = `pen:backup:${initial.id}`;
  const backup = (b: Backup | null) => writeBackup(backupKey, b);

  const [status, setStatus] = useState<SaveStatus>("saved");
  const [conflict, setConflict] = useState<Story | null>(null);

  const version = useRef(initial.version);
  const saved = useRef(initial.content);
  const dirty = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocked = useRef(false); // true while a conflict is unresolved

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const flush = useCallback(async (force = false): Promise<void> => {
    clearTimer();
    if (inFlight.current || (blocked.current && !force)) return;
    const content = getContent();
    if (content === null) return;
    if (content === saved.current && !force) {
      dirty.current = false;
      backup(null);
      setStatus("saved");
      return;
    }

    backup({ content, baseVersion: version.current });
    inFlight.current = true;
    dirty.current = false;
    setStatus("saving");
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, baseVersion: version.current, force }),
      });
      if (res.status === 409) {
        blocked.current = true;
        dirty.current = true;
        setConflict((await res.json()) as Story);
        setStatus("conflict");
        return;
      }
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      const data = (await res.json()) as { version: string };
      version.current = data.version;
      saved.current = content;
      blocked.current = false;
      setConflict(null);
      if (dirty.current) {
        // More typing arrived while we were saving.
        setStatus("unsaved");
        timer.current = setTimeout(() => void flush(), IDLE_MS);
      } else {
        backup(null);
        setStatus("saved");
      }
    } catch {
      dirty.current = true;
      setStatus("offline");
      timer.current = setTimeout(() => void flush(), RETRY_MS);
    } finally {
      inFlight.current = false;
    }
  }, [getContent]);

  /** Call on every document change. */
  const touch = useCallback(() => {
    dirty.current = true;
    if (blocked.current) return;
    setStatus((s) => (s === "offline" ? s : "unsaved"));
    clearTimer();
    timer.current = setTimeout(() => void flush(), IDLE_MS);
  }, [flush]);

  /** Pull the server copy if it changed and we have nothing unsaved. */
  const pull = useCallback(async () => {
    if (dirty.current || inFlight.current || blocked.current) return;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      const remote = (await res.json()) as Story;
      if (remote.version === version.current || dirty.current) return;
      version.current = remote.version;
      saved.current = remote.content;
      setContent(remote.content);
      setStatus("saved");
    } catch {}
  }, [setContent]);

  const resolveConflict = useCallback(
    (choice: "theirs" | "mine") => {
      if (!conflict) return;
      if (choice === "theirs") {
        version.current = conflict.version;
        saved.current = conflict.content;
        dirty.current = false;
        blocked.current = false;
        backup(null);
        setContent(conflict.content);
        setConflict(null);
        setStatus("saved");
      } else {
        version.current = conflict.version;
        void flush(true);
      }
    },
    [conflict, flush, setContent],
  );

  // On first load, recover work that never reached the server.
  useEffect(() => {
    if (!ready) return;
    const stash = readBackup(backupKey);
    if (!stash || stash.content === initial.content) {
      backup(null);
      return;
    }
    setContent(stash.content);
    dirty.current = true;
    if (stash.baseVersion === initial.version) {
      // Server hasn't moved; just finish the interrupted save.
      void flush();
    } else {
      // Server moved on while this device had unsaved edits.
      blocked.current = true;
      setConflict(initial);
      setStatus("conflict");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Save when leaving; refresh when coming back (e.g. switching phone ↔ laptop).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (dirty.current) void flush();
      } else {
        void pull();
      }
    };
    const onPageHide = () => {
      if (!dirty.current || blocked.current) return;
      const content = getContent();
      if (content === null) return;
      backup({ content, baseVersion: version.current });
      navigator.sendBeacon(
        url,
        new Blob([JSON.stringify({ content, baseVersion: version.current })], {
          type: "application/json",
        }),
      );
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("focus", pull);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("focus", pull);
    };
  }, [flush, pull, getContent]);

  useEffect(() => clearTimer, []);

  /** Save anything pending before navigating away from this document. */
  const leave = useCallback(async () => {
    if (!dirty.current || blocked.current) return;
    // Wait out a save already in flight, then send what's left.
    while (inFlight.current) await new Promise((r) => setTimeout(r, 50));
    await flush();
  }, [flush]);

  return { status, conflict, touch, flush, leave, resolveConflict };
}
