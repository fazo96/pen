"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { roman, sceneNumber } from "@/lib/outline";
import { dropTargets, sectionEnd, staysPut, stepTarget } from "@/lib/sections";

export type Heading = {
  pos: number;
  level: number;
  text: string;
  /** Words in its section, down to the next heading of the same or higher rank, not counting comments. */
  words: number;
};

type Props = {
  headings: Heading[];
  active: number | null;
  onJump: (h: Heading) => void;
  /** Move heading i's section before heading j, or to the end (j = headings.length). None: read-only. */
  onMove?: (i: number, j: number) => void;
  /** Codex entries: no part/chapter numbering, just indentation. */
  plain?: boolean;
};

type Drag = { i: number; j: number; x: number; y: number };
type Press = { i: number; pointerId: number; x: number; y: number; touch: boolean; timer?: number };

// Like the library's shelves: mice pick a section up once it moves a little;
// fingers after a long press, so a swipe still scrolls the list.
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 350;
const EDGE = 48;

/** Where heading i's section would land with the pointer at y: the allowed gap between rows nearest to it. */
function targetAt(list: HTMLElement, levels: number[], i: number, y: number): number {
  const rows = [...list.querySelectorAll<HTMLElement>(":scope > li")];
  let best = i;
  let dist = Infinity;
  for (const j of dropTargets(levels, i)) {
    const r = rows[Math.min(j, rows.length - 1)].getBoundingClientRect();
    const d = Math.abs(y - (j < rows.length ? r.top : r.bottom));
    if (d < dist) {
      dist = d;
      best = j;
    }
  }
  return best;
}

// H1 = title, H2 = part, H3 = chapter, H4 = scene. Numbering matches the
// counters drawn in the manuscript: parts in roman numerals, chapters straight
// through, scenes within their chapter. Sections are dragged, or moved with
// Alt+↑/↓, to reorder them.
export default function Outline({ headings, active, onJump, onMove, plain = false }: Props) {
  const levels = headings.map((h) => h.level);
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const levelsRef = useRef(levels);
  useEffect(() => {
    levelsRef.current = levels;
  });
  const suppressClick = useRef(0);
  const endPress = useRef<() => void>(() => {});
  /** The row to focus once a keyboard move has been scanned back in. */
  const refocus = useRef<number | null>(null);

  const update = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const retarget = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d || !list.current) return;
      update({ ...d, x, y, j: targetAt(list.current, levelsRef.current, d.i, y) });
    },
    [update],
  );

  // The list scrolls when a section is held near its top or bottom.
  useEffect(() => {
    if (!drag) return;
    const body = list.current?.closest<HTMLElement>(".outline-body");
    if (!body) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      if (d) {
        const r = body.getBoundingClientRect();
        const dy = d.y < r.top + EDGE ? d.y - (r.top + EDGE) : d.y > r.bottom - EDGE ? d.y - (r.bottom - EDGE) : 0;
        if (dy) {
          body.scrollTop += dy / 4;
          retarget(d.x, d.y);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null, retarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // A held finger mustn't scroll the list. Touch listeners on the element
  // itself, not added mid-gesture, so the browser waits for them.
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, [headings.length === 0]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => endPress.current(), []);

  // The headings changed: a press or drag on the old ones is over.
  useEffect(() => {
    endPress.current();
    const i = refocus.current;
    if (i === null) return;
    refocus.current = null;
    list.current?.querySelectorAll<HTMLButtonElement>(".outline-item")[i]?.focus();
  }, [headings]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>, i: number) => {
    if (!onMove || e.button !== 0 || !e.isPrimary || press.current || levels[i] === 1) return;
    const p: Press = { i, pointerId: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch" };
    press.current = p;
    let last = { x: e.clientX, y: e.clientY };
    const lift = () => {
      if (p.touch) navigator.vibrate?.(8);
      update({ i, j: i, x: last.x, y: last.y });
    };
    if (p.touch) p.timer = window.setTimeout(lift, LONG_PRESS_MS);

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      last = { x: ev.clientX, y: ev.clientY };
      if (dragRef.current) {
        ev.preventDefault();
        retarget(ev.clientX, ev.clientY);
        return;
      }
      const dist = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      if (p.touch) {
        if (dist > TOUCH_SLOP) end(); // a swipe: let it scroll
      } else if (dist > MOUSE_SLOP) {
        lift();
        retarget(ev.clientX, ev.clientY);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      const d = dragRef.current;
      end();
      if (d && !staysPut(levelsRef.current, d.i, d.j)) onMove(d.i, d.j);
    };
    const cancel = (ev: PointerEvent) => ev.pointerId === p.pointerId && end();
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && end();
    const menuOff = (ev: Event) => ev.preventDefault(); // the long-press menu
    const end = () => {
      clearTimeout(p.timer);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", key);
      removeEventListener("contextmenu", menuOff);
      press.current = null;
      endPress.current = () => {};
      if (dragRef.current) {
        suppressClick.current = Date.now();
        update(null);
      }
    };
    endPress.current = end;
    addEventListener("pointermove", move, { passive: false });
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    addEventListener("keydown", key);
    addEventListener("contextmenu", menuOff);
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (!onMove || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const j = stepTarget(levels, i, e.key === "ArrowUp" ? -1 : 1);
    if (j === null) return;
    // Where the section's heading will be once it's moved.
    refocus.current = j < i ? j : j - (sectionEnd(levels, i) - i);
    onMove(i, j);
  };

  if (headings.length === 0) {
    return <p className="outline-empty">Headings you write will gather here.</p>;
  }
  let part = 0;
  let chapter = 0;
  let scene = 0;
  /** The gap the section would drop into: before row `drop`, or after the last. */
  const drop = drag && !staysPut(levels, drag.i, drag.j) ? drag.j : null;
  const lifted = drag ? [drag.i, sectionEnd(levels, drag.i)] : null;

  return (
    <ol className={`outline-list ${drag ? "is-dragging" : ""}`} ref={list}>
      {headings.map((h, i) => {
        const kind =
          h.level === 1 ? "title"
          : plain ? `note lvl-${h.level}`
          : h.level === 2 ? "part"
          : h.level === 3 ? "chapter"
          : "scene";
        if (kind === "chapter") scene = 0;
        const num =
          kind === "part" ? `Part ${roman(++part)}`
          : kind === "chapter" ? String(++chapter).padStart(2, "0")
          : kind === "scene" ? sceneNumber(chapter, ++scene)
          : "";
        const classes = [
          "outline-item",
          `is-${kind}`,
          active === h.pos && "is-active",
          lifted && i >= lifted[0] && i < lifted[1] && "is-lifted",
          drop === i && "drop-before",
          drop === headings.length && i === headings.length - 1 && "drop-after",
        ];
        return (
          <li key={h.pos}>
            <button
              type="button"
              className={classes.filter(Boolean).join(" ")}
              onClick={() => Date.now() - suppressClick.current > 300 && onJump(h)}
              onPointerDown={(e) => onPointerDown(e, i)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="outline-num">{num}</span>
              <span className="outline-text">{h.text || "Untitled"}</span>
              <span className="outline-words">
                {h.words.toLocaleString()}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
