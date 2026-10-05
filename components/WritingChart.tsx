"use client";

import { useState } from "react";
import { type Bucket, duration, type Range } from "@/lib/statsView";
import { workOf } from "@/lib/writingStats";

const n = (x: number) => x.toLocaleString();

/** When a bucket is, for its tooltip and label. */
export function bucketName(b: Bucket, range: Range, short = false): string {
  const d = new Date(b.start);
  if (range === "today") return d.toLocaleTimeString(undefined, { hour: "numeric", minute: short ? undefined : "2-digit" });
  return short
    ? range === "7d"
      ? d.toLocaleDateString(undefined, { weekday: "short" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

// Which columns get a label under them: a few, so they never collide.
function labelled(i: number, count: number, range: Range) {
  if (range === "today") return i % 6 === 0;
  if (range === "7d") return true;
  return (count - 1 - i) % 7 === 0;
}

/**
 * Words per hour or day: drafted and edited words stacked up from the line,
 * removed ones hanging below it. Each column tells its numbers on hover, focus
 * or tap.
 */
export default function WritingChart({
  buckets,
  range,
  height = 132,
  label,
}: {
  buckets: Bucket[];
  range: Range;
  height?: number;
  label: string;
}) {
  const [at, setAt] = useState<number | null>(null);
  const up = Math.max(0, ...buckets.map((b) => b.totals.drafted + b.totals.editAdded));
  const down = Math.max(0, ...buckets.map((b) => b.totals.removed));
  const scale = Math.max(up, down, 1);
  // One scale above and below the line; the part below only as tall as it needs.
  const upH = Math.max(Math.round((height * up) / scale), 24);
  const downH = down ? Math.max(Math.round((height * down) / scale), 12) : 0;
  const px = (v: number, h: number, max: number) => (v ? Math.max(2, Math.round((v / max) * h)) : 0);
  const shown = at === null ? null : buckets[at];

  return (
    <figure className="wchart" aria-label={label} onMouseLeave={() => setAt(null)}>
      <div className="wchart-plot" style={{ "--up": `${upH}px`, "--down": `${downH}px` } as React.CSSProperties}>
        {buckets.map((b, i) => {
          const t = b.totals;
          const total = t.drafted + t.editAdded;
          const work = workOf(t);
          return (
            <button
              key={b.start}
              type="button"
              className={`wchart-col ${at === i ? "is-on" : ""}`}
              aria-label={`${bucketName(b, range)}: ${n(total)} words written, ${n(t.removed)} removed${work ? `, mostly ${work}` : ""}`}
              onMouseEnter={() => setAt(i)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
              onClick={() => setAt(i)}
            >
              <span className="wchart-up">
                {total > 0 && (
                  <span className="wchart-stack" style={{ height: px(total, upH, scale) }}>
                    {t.editAdded > 0 && <span className="wchart-edit" style={{ flexGrow: t.editAdded }} />}
                    {t.drafted > 0 && <span className="wchart-draft" style={{ flexGrow: t.drafted }} />}
                  </span>
                )}
              </span>
              {downH > 0 && (
                <span className="wchart-down">
                  {t.removed > 0 && <span className="wchart-removed" style={{ height: px(t.removed, downH, scale) }} />}
                </span>
              )}
            </button>
          );
        })}
        {shown && at !== null && (
          <div
            className={`wchart-tip ${at < buckets.length / 2 ? "is-left" : "is-right"}`}
            style={{ "--at": `${((at + 0.5) / buckets.length) * 100}%` } as React.CSSProperties}
            role="status"
          >
            <strong>{bucketName(shown, range)}</strong>
            <span>
              <i className="wchart-key is-draft" /> {n(shown.totals.drafted)} drafted
            </span>
            <span>
              <i className="wchart-key is-edit" /> {n(shown.totals.editAdded)} added in edits
            </span>
            <span>
              <i className="wchart-key is-removed" /> {n(shown.totals.removed)} removed
            </span>
            {shown.totals.activeMs > 0 && <span>{duration(shown.totals.activeMs)} writing</span>}
          </div>
        )}
      </div>
      <div className="wchart-axis" aria-hidden>
        {buckets.map((b, i) => (
          <span key={b.start}>{labelled(i, buckets.length, range) ? bucketName(b, range, true) : ""}</span>
        ))}
      </div>
    </figure>
  );
}

/** What the chart's colors mean. */
export function WritingLegend({ removed = true }: { removed?: boolean }) {
  return (
    <p className="wchart-legend">
      <span>
        <i className="wchart-key is-draft" /> Drafted
      </span>
      <span>
        <i className="wchart-key is-edit" /> Added in edits
      </span>
      {removed && (
        <span>
          <i className="wchart-key is-removed" /> Removed
        </span>
      )}
    </p>
  );
}
