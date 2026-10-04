"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DocMeta, EntryMeta } from "@/lib/types";
import { type PaletteItem, type PaletteMode, pieces, rank } from "@/lib/palette";

export type { PaletteItem, PaletteMode };

const LIMIT = 60;

/** The Codex and the library, fetched afresh each time the palette opens. */
export function usePaletteLists(projectId: string, open: boolean) {
  const [entries, setEntries] = useState<EntryMeta[] | null>(null);
  const [books, setBooks] = useState<DocMeta[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const get = <T,>(url: string, set: (x: T) => void) =>
      api<T>(url)
        .then((x) => live && set(x))
        .catch(() => {});
    void get(`/api/docs/${projectId}/codex`, setEntries);
    void get("/api/docs", setBooks);
    return () => {
      live = false;
    };
  }, [projectId, open]);
  return { entries, books };
}

type Props = {
  mode: PaletteMode;
  places: PaletteItem[];
  commands: PaletteItem[];
  /** `refocus`: give the editor its cursor back. */
  onClose: (refocus: boolean) => void;
};

/** Ctrl+O and Ctrl+P: find a place to go or a thing to do, by typing a few letters. */
export default function Palette({ mode, places, commands, onClose }: Props) {
  const [query, setQuery] = useState(mode === "do" ? "> " : "");
  const [selected, setSelected] = useState(0);
  const [asking, setAsking] = useState<PaletteItem | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const doing = query.startsWith(">");
  const q = (doing ? query.slice(1) : query).trim();

  // The rows, with a heading over each section (unfiltered) or a tag on each (search).
  const rows = useMemo(() => {
    const pool = doing ? commands : places;
    if (!q) {
      const shown = pool.filter((i) => i.when !== "search");
      const order = [...new Set(shown.map((i) => i.section))];
      return order.flatMap((s) => shown.filter((i) => i.section === s).map((item) => ({ item, hits: [] as number[] })));
    }
    return rank(
      pool.filter((i) => i.when !== "empty"),
      q,
    ).slice(0, LIMIT);
  }, [doing, q, places, commands]);

  useEffect(() => setSelected(0), [q, doing]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (item: PaletteItem) => {
    if (item.ask) {
      setAsking(item);
      setQuery("");
      input.current?.focus();
      return;
    }
    onClose(!!item.refocus);
    item.run?.();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (asking) {
        setAsking(null);
        setQuery("> ");
      } else onClose(true);
      return;
    }
    if (asking) {
      if (e.key === "Enter") {
        e.preventDefault();
        onClose(!!asking.refocus);
        asking.ask!.submit(query.trim());
      }
      return;
    }
    const n = rows.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setSelected((s) => (s + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setSelected((s) => (s - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[selected];
      if (row) pick(row.item);
    } else if (e.key === "Backspace" && doing && query.trim() === ">") {
      // Out of commands, back to places.
      e.preventDefault();
      setQuery("");
    }
  };

  let lastSection = "";
  const active = rows[selected] ? `palette-${selected}` : undefined;

  return (
    <>
      <div className="palette-scrim" onMouseDown={() => onClose(true)} aria-hidden />
      <div className="palette" role="dialog" aria-modal="true" aria-label={doing ? "Commands" : "Go to"}>
        {asking && <div className="palette-asking label">{asking.label}</div>}
        <input
          ref={input}
          className="palette-input"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder={asking ? asking.ask!.placeholder : doing ? "Type a command" : "Search, or > for commands"}
          role="combobox"
          aria-expanded={!asking}
          aria-controls="palette-list"
          aria-activedescendant={asking ? undefined : active}
          aria-autocomplete="list"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={asking ? "done" : "go"}
        />
        {asking ? (
          <p className="palette-note">Enter to save · Esc to go back</p>
        ) : rows.length ? (
          <ul ref={list} id="palette-list" className="palette-list" role="listbox">
            {rows.map(({ item, hits }, i) => {
              const heading = !q && item.section !== lastSection ? item.section : null;
              lastSection = item.section;
              return [
                heading && (
                  <li key={`h:${heading}`} className="palette-section label" role="presentation">
                    {heading}
                  </li>
                ),
                <li
                  key={item.key}
                  id={`palette-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={i === selected}
                  className={`palette-item ${i === selected ? "is-selected" : ""}`}
                  onMouseMove={() => i !== selected && setSelected(i)}
                  // Keep the input focused (and the phone's keyboard up).
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                >
                  {item.prefix && <span className="palette-prefix">{item.prefix}</span>}
                  <span className="palette-label">
                    {pieces(item.label, hits).map((p, k) => (p.hit ? <mark key={k}>{p.text}</mark> : p.text))}
                  </span>
                  {q && <span className="palette-tag label">{item.section}</span>}
                  {item.hint && <kbd className="palette-hint">{item.hint}</kbd>}
                </li>,
              ];
            })}
          </ul>
        ) : (
          <p className="palette-note">{q ? "Nothing matches." : "Nothing here yet."}</p>
        )}
      </div>
    </>
  );
}
