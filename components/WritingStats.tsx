"use client";

import { useEffect, useMemo, useState } from "react";
import { duration, type Range, RANGES, summarize } from "@/lib/statsView";
import { local } from "@/lib/storage";
import type { WritingReport } from "@/lib/writing";
import { edited, type Totals, workOf, written } from "@/lib/writingStats";
import WritingChart, { bucketName, WritingLegend } from "./WritingChart";

const n = (x: number) => x.toLocaleString();
const signed = (x: number) => (x > 0 ? `+${n(x)}` : x < 0 ? `−${n(-x)}` : "0");

/** "120 pasted and 400 moved words aren’t counted." */
function notCounted({ pasted, moved }: Totals) {
  const parts = [pasted > 0 && `${n(pasted)} pasted`, moved > 0 && `${n(moved)} moved`].filter(Boolean);
  return `${parts.join(" and ")} words aren’t counted.`;
}

const RANGE_KEY = "pen:stats-range";
const BOOK_KEY = "pen:stats-book";

/** The time now, from after the first render (the server doesn't know the writer's time zone), each minute. */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "Mostly drafting (72%)". */
export function workLabel(t: Totals): string {
  const work = workOf(t);
  if (!work) return "Nothing written yet";
  const share = Math.round((100 * (work === "drafting" ? t.drafted : edited(t))) / (t.drafted + edited(t)));
  return `Mostly ${work} (${share}%)`;
}

/** Drafting against editing, as one bar. */
function Split({ t }: { t: Totals }) {
  const all = t.drafted + edited(t);
  if (!all) return null;
  const pct = (x: number) => `${Math.round((100 * x) / all)}%`;
  return (
    <div className="wsplit">
      <div className="wsplit-bar" role="img" aria-label={`Drafting ${pct(t.drafted)}, editing ${pct(edited(t))}`}>
        {t.drafted > 0 && <span className="wchart-draft" style={{ flexGrow: t.drafted }} />}
        {edited(t) > 0 && <span className="wsplit-edit" style={{ flexGrow: edited(t) }} />}
      </div>
      <p className="wsplit-legend">
        <span>
          <i className="wchart-key is-draft" /> Drafting {pct(t.drafted)}
        </span>
        <span>
          <i className="wchart-key is-edit" /> Editing {pct(edited(t))}
        </span>
      </p>
    </div>
  );
}

/** The writing stats page: Today, the last 7 or 30 days, all books or one. */
export default function WritingStats({ report }: { report: WritingReport }) {
  const now = useNow();
  const [range, setRange] = useState<Range>("today");
  const [book, setBook] = useState("");
  useEffect(() => {
    const r = local.get(RANGE_KEY);
    if (RANGES.some((x) => x.id === r)) setRange(r as Range);
    const b = local.get(BOOK_KEY);
    if (b && report.books[b]) setBook(b);
  }, [report.books]);
  const pick = (r: Range) => {
    setRange(r);
    local.set(RANGE_KEY, r);
  };
  const pickBook = (b: string) => {
    setBook(b);
    local.set(BOOK_KEY, b || null);
  };

  // Books written in lately, for the filter; gone ones last.
  const books = useMemo(() => {
    const ids = new Set(report.slots.filter((s) => s.kind === "manuscript").map((s) => s.book));
    return [...ids]
      .map((id) => ({ id, ...report.books[id] }))
      .sort((a, b) => Number(a.gone) - Number(b.gone) || a.title.localeCompare(b.title));
  }, [report]);
  const titleOf = (id: string) => {
    const b = report.books[id];
    return b ? `${b.title}${b.gone ? " (deleted)" : ""}` : id;
  };

  const summary = useMemo(
    () => (now === null ? null : summarize(report.slots, range, now, { book: book || undefined })),
    [report.slots, range, now, book],
  );

  return (
    <div className="wstats">
      <div className="wstats-controls">
        <div className="wstats-ranges" role="radiogroup" aria-label="Period">
          {RANGES.map((r) => (
            // biome-ignore lint/a11y/useSemanticElements: buttons drawn as a segmented control, announced as radios
            <button key={r.id} type="button" role="radio" aria-checked={range === r.id} onClick={() => pick(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        {books.length > 1 && (
          <label className="wstats-book">
            <span className="label">Book</span>
            <select value={book} onChange={(e) => pickBook(e.target.value)}>
              <option value="">All books</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {titleOf(b.id)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!summary ? (
        <p className="settings-hint">Counting…</p>
      ) : (
        <>
          <dl className="stats wstats-figures">
            <div>
              <dt className="label">Written</dt>
              <dd>{n(written(summary.totals))} words</dd>
            </div>
            <div>
              <dt className="label">Removed</dt>
              <dd>{n(summary.totals.removed)} words</dd>
            </div>
            <div>
              <dt className="label">Net</dt>
              <dd>{signed(written(summary.totals) - summary.totals.removed)}</dd>
            </div>
            <div>
              <dt className="label">Time writing</dt>
              <dd>{duration(summary.totals.activeMs)}</dd>
            </div>
          </dl>

          <p className="wstats-work">{workLabel(summary.totals)}</p>
          <Split t={summary.totals} />

          <WritingChart
            buckets={summary.buckets}
            range={range}
            label={range === "today" ? "Words written today, by hour" : `Words written each day, last ${RANGES.find((r) => r.id === range)!.days} days`}
          />
          <WritingLegend removed={summary.totals.removed > 0} />

          {(summary.totals.pasted > 0 || summary.totals.moved > 0) && (
            <p className="settings-hint">{notCounted(summary.totals)}</p>
          )}

          {!book && summary.books.length > 1 && (
            <section className="wstats-section" aria-labelledby="wstats-books">
              <h2 id="wstats-books" className="label">
                By book
              </h2>
              <table className="wstats-table">
                <thead>
                  <tr>
                    <th>Book</th>
                    <th>Written</th>
                    <th>Removed</th>
                    <th>Work</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.books.map(({ book: id, totals }) => (
                    <tr key={id}>
                      <td>{titleOf(id)}</td>
                      <td>{n(written(totals))}</td>
                      <td>{n(totals.removed)}</td>
                      <td>{workOf(totals) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {range !== "today" && (
            <section className="wstats-section" aria-labelledby="wstats-days">
              <h2 id="wstats-days" className="label">
                By day
              </h2>
              {written(summary.totals) || summary.totals.removed || summary.totals.activeMs ? (
                <table className="wstats-table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Written</th>
                      <th>Removed</th>
                      <th>Time</th>
                      <th>Work</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.buckets
                      .filter((b) => written(b.totals) || b.totals.removed || b.totals.activeMs)
                      .reverse()
                      .map((b) => (
                        <tr key={b.start}>
                          <td>{bucketName(b, range)}</td>
                          <td>{n(written(b.totals))}</td>
                          <td>{n(b.totals.removed)}</td>
                          <td>{duration(b.totals.activeMs)}</td>
                          <td>{workOf(b.totals) ?? "—"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="settings-hint">Nothing written in these days.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
