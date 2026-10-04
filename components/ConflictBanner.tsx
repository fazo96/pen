"use client";

/** A save refused because the text changed elsewhere: keep this version or load that one. */
export default function ConflictBanner({
  what,
  className = "",
  onResolve,
}: {
  /** "This manuscript was changed on another device." */
  what: string;
  className?: string;
  onResolve: (keep: "mine" | "theirs") => void;
}) {
  return (
    <div className={`conflict ${className}`} role="alert">
      <p>
        <span className="label">Conflict</span>
        {what}
      </p>
      <div className="conflict-actions">
        <button type="button" onClick={() => onResolve("theirs")}>
          Load theirs
        </button>
        <button type="button" className="primary" onClick={() => onResolve("mine")}>
          Keep mine
        </button>
      </div>
    </div>
  );
}
