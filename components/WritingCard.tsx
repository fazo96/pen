"use client";

import Link from "next/link";
import { useMemo } from "react";
import { duration, summarize } from "@/lib/statsView";
import type { WritingReport } from "@/lib/writing";
import { workOf, written } from "@/lib/writingStats";
import WritingChart from "./WritingChart";
import { useNow } from "./WritingStats";

const n = (x: number) => x.toLocaleString();

/** The library's glance at the writing stats: today, and the last 7 days, linking to /stats. */
export default function WritingCard({ report }: { report: WritingReport }) {
  const now = useNow();
  const [today, week] = useMemo(
    () => (now === null ? [null, null] : [summarize(report.slots, "today", now), summarize(report.slots, "7d", now)]),
    [report.slots, now],
  );
  const work = today && workOf(today.totals);

  return (
    <section className="wcard" aria-labelledby="wcard-title">
      <div className="wcard-head">
        <h2 id="wcard-title" className="label">
          Writing
        </h2>
        <Link href="/stats" className="wcard-more label">
          All stats →
        </Link>
      </div>
      {today && week && (
        <>
          <p className="wcard-today">
            {written(today.totals) || today.totals.removed ? (
              <>
                <strong>{n(written(today.totals))}</strong> words today
                {work && ` · mostly ${work}`}
                {today.totals.activeMs > 0 && ` · ${duration(today.totals.activeMs)}`}
              </>
            ) : (
              "Nothing written today yet."
            )}
          </p>
          <WritingChart buckets={week.buckets} range="7d" height={44} label="Words written each day, last 7 days" />
          <p className="wcard-week book-meta">
            Last 7 days: {n(written(week.totals))} written · {n(week.totals.removed)} removed
          </p>
        </>
      )}
    </section>
  );
}
