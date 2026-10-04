"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/lib/useDismiss";
import { api } from "@/lib/api";
import type { DocMeta } from "@/lib/types";
import {
  addShelf,
  findBook,
  moveBook,
  moveShelf,
  newShelfId,
  removeShelf,
  renameShelf,
  type Layout,
  MAX_SHELF_NAME,
} from "@/lib/shelfLayout";
import ConfirmRow from "./ConfirmRow";
import Book, { Cover } from "./Book";
import { IconDown, IconMore, IconPencil, IconPlus, IconTrash, IconUp } from "./icons";

type Props = {
  docs: DocMeta[];
  layout: Layout;
  onCover: (id: string, file: File) => Promise<void>;
};

type Target = { shelf: string; index: number };
type Drag = {
  book: string;
  from: Target;
  target: Target;
  x: number;
  y: number;
  /** Where the pointer grabbed the cover, and its size, for the ghost. */
  dx: number;
  dy: number;
  w: number;
};
type Press = { book: string; pointerId: number; x: number; y: number; touch: boolean; timer?: number; grab: DOMRect };

// Mice pick a book up once it moves a little; fingers after a long press, so
// a swipe still scrolls the page.
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;
const LONG_PRESS_MS = 350;
const EDGE = 72;

const sameTarget = (a: Target, b: Target) => a.shelf === b.shelf && a.index === b.index;

/** Where a book dropped at (x, y) would land, or null when it's over no shelf. */
function targetAt(x: number, y: number, book: string): Target | "same" | null {
  const el = document.elementFromPoint(x, y);
  const shelf = el?.closest<HTMLElement>("[data-shelf]");
  if (!shelf) return null;
  // Over the gap the book leaves behind: nothing changes.
  if (el!.closest<HTMLElement>("[data-book]")?.dataset.book === book) return "same";
  const others = [...shelf.querySelectorAll<HTMLElement>("[data-book]")].filter((b) => b.dataset.book !== book);
  let index = others.length;
  for (let i = 0; i < others.length; i++) {
    const r = others[i].getBoundingClientRect();
    if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
      index = i;
      break;
    }
  }
  return { shelf: shelf.dataset.shelf!, index };
}

/** The library as rows of shelves. Books are dragged between them to order them. */
export default function Shelves({ docs, layout, onCover }: Props) {
  // Changes show at once and are saved behind; a failed save puts back the last saved layout.
  const [local, setLocal] = useState(layout);
  const [seen, setSeen] = useState(layout);
  if (layout !== seen) {
    setSeen(layout);
    setLocal(layout);
  }
  const saved = useRef(layout);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [error, setError] = useState<string | null>(null);

  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [binding, setBinding] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const now = Date.now();

  useEffect(() => {
    saved.current = layout;
  }, [layout]);

  const save = useCallback((next: Layout) => {
    setLocal(next);
    setError(null);
    saving.current = saving.current.then(async () => {
      try {
        saved.current = await api<Layout>("/api/shelves", { method: "PUT", json: next });
      } catch (e) {
        setLocal(saved.current);
        setError(`Couldn't save the shelves: ${e instanceof Error ? e.message : e}`);
      }
    });
  }, []);

  useDismiss(!!menu, (t) => !!t.closest(".popover-menu, [data-menu-toggle]"), () => {
    setMenu(null);
    setConfirming(null);
  });

  // ─── Dragging ───────────────────────────────────────────────
  const press = useRef<Press | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const localRef = useRef(local);
  useEffect(() => {
    localRef.current = local;
  }, [local]);
  const suppressClick = useRef(0);
  const endPress = useRef<() => void>(() => {});

  const update = useCallback((next: Drag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const retarget = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const t = targetAt(x, y, d.book);
      const target = t && t !== "same" ? t : d.target;
      update({ ...d, x, y, target: sameTarget(target, d.target) ? d.target : target });
    },
    [update],
  );

  const lift = useCallback(
    (x: number, y: number) => {
      const p = press.current;
      if (!p) return;
      const from = findBook(localRef.current, p.book);
      if (!from) return;
      setMenu(null);
      if (p.touch) navigator.vibrate?.(8);
      update({ book: p.book, from, target: from, x, y, dx: p.x - p.grab.left, dy: p.y - p.grab.top, w: p.grab.width });
    },
    [update],
  );

  // Page scrolls when the book is held near the top or bottom of the window.
  useEffect(() => {
    if (!drag) return;
    let frame = 0;
    const tick = () => {
      const d = dragRef.current;
      if (d) {
        const dy = d.y < EDGE ? d.y - EDGE : d.y > innerHeight - EDGE ? d.y - (innerHeight - EDGE) : 0;
        if (dy) {
          scrollBy(0, dy / 4);
          retarget(d.x, d.y);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null, retarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // A held finger mustn't scroll the page. Touch listeners on the element
  // itself, not added mid-gesture, so the browser waits for them.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);

  const onBookPointerDown = (e: React.PointerEvent<HTMLLIElement>, book: string) => {
    if (e.button !== 0 || !e.isPrimary || press.current || editing) return;
    if ((e.target as Element).closest("[data-menu-toggle], .popover-menu")) return;
    const cover = e.currentTarget.querySelector(".book-cover");
    if (!cover) return;
    const p: Press = {
      book,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType === "touch",
      grab: cover.getBoundingClientRect(),
    };
    press.current = p;
    let last = { x: e.clientX, y: e.clientY };
    if (p.touch) p.timer = window.setTimeout(() => lift(last.x, last.y), LONG_PRESS_MS);

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
        lift(ev.clientX, ev.clientY);
        retarget(ev.clientX, ev.clientY);
      }
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== p.pointerId) return;
      const d = dragRef.current;
      if (d) {
        suppressClick.current = Date.now();
        if (!sameTarget(d.from, d.target)) save(moveBook(localRef.current, d.book, d.target.shelf, d.target.index));
      }
      end();
    };
    const cancel = (ev: PointerEvent) => ev.pointerId === p.pointerId && end();
    const key = (ev: KeyboardEvent) => ev.key === "Escape" && end();
    const menuOff = (ev: Event) => ev.preventDefault(); // Android's long-press menu on the link
    const end = () => {
      clearTimeout(p.timer);
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
      removeEventListener("keydown", key);
      removeEventListener("contextmenu", menuOff);
      press.current = null;
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

  useEffect(() => () => endPress.current(), []);

  // ─── Shelves ────────────────────────────────────────────────
  const startRename = (id: string, name: string) => {
    setMenu(null);
    setDraft(name);
    setEditing(id);
  };
  const commitRename = () => {
    if (!editing) return;
    const shelf = local.shelves.find((s) => s.id === editing);
    setEditing(null);
    if (shelf && draft.trim() !== shelf.name) save(renameShelf(local, editing, draft));
  };
  const newShelf = () => {
    const id = newShelfId();
    save(addShelf(local, id));
    startRename(id, "");
  };

  const cover = async (id: string, file: File) => {
    setBinding(id);
    try {
      await onCover(id, file);
    } finally {
      setBinding(null);
    }
  };

  const byId = new Map(docs.map((d) => [d.id, d]));
  const shown = drag ? moveBook(local, drag.book, drag.target.shelf, drag.target.index) : local;
  const heads = shown.shelves.length > 1 || shown.shelves[0].name !== "";
  const dragged = drag ? byId.get(drag.book) : undefined;

  return (
    <div
      ref={root}
      className={`shelves ${drag ? "is-dragging" : ""}`}
      onClickCapture={(e) => {
        if (Date.now() - suppressClick.current < 400) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {shown.shelves.map((s, i) => {
        const books = s.books.map((id) => byId.get(id)).filter((d): d is DocMeta => !!d);
        const menuKey = `shelf:${s.id}`;
        const into = local.shelves[i === 0 ? 1 : 0];
        return (
          <section key={s.id} className="shelf" data-shelf={s.id} aria-label={s.name || "Unnamed shelf"}>
            {heads && (
              <div className="shelf-head">
                {editing === s.id ? (
                  <input
                    className="shelf-name-input"
                    value={draft}
                    placeholder="Name this shelf"
                    maxLength={MAX_SHELF_NAME}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className={`shelf-name ${s.name ? "" : "shelf-unnamed"}`}
                    title="Rename shelf"
                    onClick={() => startRename(s.id, s.name)}
                  >
                    {s.name || "Unnamed shelf"}
                  </button>
                )}
                <span className="shelf-count">{books.length}</span>
                <span className="shelf-rule" aria-hidden />
                <button
                  type="button"
                  className="icon-btn shelf-more"
                  data-menu-toggle
                  aria-label={`Options for ${s.name || "unnamed shelf"}`}
                  aria-expanded={menu === menuKey}
                  onClick={() => {
                    setConfirming(null);
                    setMenu((m) => (m === menuKey ? null : menuKey));
                  }}
                >
                  <IconMore />
                </button>
                {menu === menuKey && (
                  <div className="popover-menu shelf-menu" role="menu">
                    {confirming === s.id ? (
                      <ConfirmRow
                        className="book-confirm"
                        action="Remove"
                        onKeep={() => setConfirming(null)}
                        onConfirm={() => {
                          setMenu(null);
                          setConfirming(null);
                          save(removeShelf(local, s.id));
                        }}
                      >
                        Remove <em>{s.name || "this shelf"}</em>? Its {books.length === 1 ? "book moves" : `${books.length} books move`} to{" "}
                        <em>{into.name || "the unnamed shelf"}</em>.
                      </ConfirmRow>
                    ) : (
                      <>
                        <button type="button" role="menuitem" onClick={() => startRename(s.id, s.name)}>
                          <IconPencil /> Rename
                        </button>
                        {i > 0 && (
                          <button type="button" role="menuitem" onClick={() => save(moveShelf(local, s.id, -1))}>
                            <IconUp /> Move up
                          </button>
                        )}
                        {i < local.shelves.length - 1 && (
                          <button type="button" role="menuitem" onClick={() => save(moveShelf(local, s.id, 1))}>
                            <IconDown /> Move down
                          </button>
                        )}
                        {local.shelves.length > 1 && (
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => {
                              if (books.length) setConfirming(s.id);
                              else {
                                setMenu(null);
                                save(removeShelf(local, s.id));
                              }
                            }}
                          >
                            <IconTrash /> Remove shelf{books.length ? "…" : ""}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {books.length ? (
              <ul className="shelf-books">
                {books.map((d) => (
                  <Book
                    key={d.id}
                    doc={d}
                    now={now}
                    binding={binding === d.id}
                    lifted={drag?.book === d.id}
                    onPointerDown={(e) => onBookPointerDown(e, d.id)}
                    onCover={(file) => void cover(d.id, file)}
                  />
                ))}
              </ul>
            ) : (
              <p className="shelf-empty">{drag ? "Drop it here" : "An empty shelf. Drag books here to fill it."}</p>
            )}
          </section>
        );
      })}

      <button type="button" className="shelf-add" onClick={newShelf}>
        <IconPlus /> New shelf
      </button>

      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}

      {drag && dragged && (
        <div
          className="book-ghost"
          aria-hidden
          style={{ width: drag.w, transform: `translate(${drag.x - drag.dx}px, ${drag.y - drag.dy}px) rotate(-3deg)` }}
        >
          <Cover doc={dragged} />
        </div>
      )}
    </div>
  );
}
