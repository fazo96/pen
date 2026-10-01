"use client";

import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef } from "react";
import { placeOf, posOf, type Spot } from "./spot";

// Saves where the writer is in the manuscript (lib/spot.ts) a moment after they
// scroll or move the cursor, when leaving the page, and when it's hidden; puts
// them back there when it opens.

const MEASURE_MS = 200;
const SAVE_MS = 2000;
const RESTORING = "penSpotRestore";
const AT_TOP = { block: 0, q: "", off: 0 };

/** Where the text starts showing: below the fixed top bar. */
function textTop() {
  return Math.max(0, document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0);
}

function currentSpot(editor: Editor): Spot {
  const { view } = editor;
  const { doc, selection } = view.state;
  let top = AT_TOP;
  if (window.scrollY > 0) {
    // The first position on a line below the bar. Not posAtCoords: that hit-tests,
    // and finds nothing while the drawer covers the text.
    const edge = textTop();
    let lo = 0;
    let hi = doc.content.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (view.coordsAtPos(mid).bottom > edge) hi = mid;
      else lo = mid + 1;
    }
    top = placeOf(doc, lo);
  }
  return { anchor: placeOf(doc, selection.anchor), head: placeOf(doc, selection.head), top };
}

type Options = {
  editor: Editor | null;
  /** The project's spot endpoint; null turns the hook off (codex entries). */
  url: string | null;
  /** Where to open; skipped when the page opened somewhere else on purpose (a citation). */
  initial?: Spot;
  /** Don't record while the page shows something else (a version preview). */
  paused: boolean;
};

export function useSpot({ editor, url, initial, paused }: Options) {
  const sent = useRef(initial ? JSON.stringify(initial) : "");
  // The last spot measured, a moment after the writer stopped. Kept because by
  // the time the page unmounts (the back button) it may already have scrolled
  // for the next page.
  const latest = useRef<string | null>(null);
  const measureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const left = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const measure = useCallback(() => {
    clearTimeout(measureTimer.current);
    if (editor && !editor.isDestroyed && url && !pausedRef.current && !left.current) {
      latest.current = JSON.stringify(currentSpot(editor));
    }
  }, [editor, url]);

  const send = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const body = latest.current;
    if (!body || !url || body === sent.current) return;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => null);
    if (res?.ok) sent.current = body;
  }, [url]);

  /** Save where the writer is now and stop recording; awaited before navigating away. */
  const leave = useCallback(async () => {
    measure();
    left.current = true;
    await send();
  }, [measure, send]);

  // Open where the writer left off.
  useEffect(() => {
    if (!editor || !url || !initial) return;
    const { doc } = editor.state;
    const sel = TextSelection.between(doc.resolve(posOf(doc, initial.anchor)), doc.resolve(posOf(doc, initial.head)));
    // Not focused: on a phone that would bring up the keyboard.
    editor.view.dispatch(editor.state.tr.setSelection(sel).setMeta(RESTORING, true));
    if (initial.top.block === 0 && initial.top.off === 0 && !initial.top.q) return;
    const top = posOf(doc, initial.top);
    let cancelled = false;
    void (async () => {
      // Measure once the text is laid out in its own font.
      await document.fonts?.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled || editor.isDestroyed) return;
      window.scrollBy(0, editor.view.coordsAtPos(Math.min(top, editor.state.doc.content.size)).top - textTop());
    })();
    return () => {
      cancelled = true;
    };
    // Only when the editor first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor || !url) return;
    const schedule = () => {
      if (left.current) return;
      clearTimeout(measureTimer.current);
      clearTimeout(saveTimer.current);
      measureTimer.current = setTimeout(measure, MEASURE_MS);
      saveTimer.current = setTimeout(() => void send(), SAVE_MS);
    };
    const onTx = ({ transaction: tr }: { transaction: Transaction }) => {
      if ((tr.selectionSet || tr.docChanged) && !tr.getMeta(RESTORING)) schedule();
    };
    // fetch may not finish once the page goes away; a beacon does.
    const beacon = () => {
      clearTimeout(saveTimer.current);
      measure();
      const body = latest.current;
      if (body && body !== sent.current && navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))) {
        sent.current = body;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") beacon();
    };
    editor.on("transaction", onTx);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      editor.off("transaction", onTx);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(measureTimer.current);
      // Left without leave() (the back button): send the last spot measured.
      void send();
    };
  }, [editor, url, measure, send]);

  return { leave };
}
