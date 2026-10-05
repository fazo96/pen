"use client";

import { useEffect, useId, useRef, useState } from "react";
import { STATUS_EXPLAINED, times } from "@/lib/saveStatus";
import { STATUS_LABEL, type SaveStatus as Status } from "@/lib/useAutosave";
import { useDismiss } from "@/lib/useDismiss";

type Props = {
  status: Status;
  savedAt: number | null;
  reachedAt: number | null;
  /** Just the dot (the Codex panel); the label stays for screen readers. */
  dotOnly?: boolean;
};

/** The save status, a dot and a word, explained on hover or tap: the state, when it last saved and reached the server. */
export default function SaveStatus({ status, savedAt, reachedAt, dotOnly = false }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useDismiss(open, root, () => setOpen(false), { escapeFirst: true });

  // "2 min ago" keeps counting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [savedAt, reachedAt]);

  return (
    <span className={`save-status ${open ? "is-open" : ""}`} ref={root}>
      <button
        type="button"
        className={`status status-${status}`}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="status-dot" aria-hidden />
        <span className={`status-label ${dotOnly ? "visually-hidden" : ""}`} role="status" aria-live="polite">
          {STATUS_LABEL[status]}
        </span>
      </button>
      <span className="save-status-pop" role="tooltip" id={id}>
        <span className="save-status-lead">{STATUS_EXPLAINED[status]}</span>
        {times(status, savedAt, reachedAt, now).map((t) => (
          <span key={t.label} className="save-status-time">
            <b>{t.label}</b> {t.value}
          </span>
        ))}
      </span>
    </span>
  );
}
