"use client";

import Link from "next/link";
import { useRef } from "react";
import type { DocMeta } from "@/lib/docs";
import { IMPORT_ACCEPT, useLibrary } from "@/lib/useLibrary";
import DropImport from "./DropImport";
import { IconImport, IconPlus, IconSettings } from "./icons";
import Logo from "./Logo";
import Shelf from "./Shelf";
import ThemeButton from "./ThemeButton";

/** The welcome page, and the library as a shelf once there's something on it. */
export default function Home({ docs }: { docs: DocMeta[] }) {
  const picker = useRef<HTMLInputElement>(null);
  const lib = useLibrary();
  const total = docs.reduce((n, d) => n + d.words, 0);
  const shelved = docs.length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <span className="wordmark" aria-hidden>
            <Logo />
          </span>
          <span className="topbar-title">Pen</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className={`welcome ${shelved ? "is-shelved" : ""}`}>
          <span className="label">pen · a quiet place to write</span>
          <h1 className="welcome-title">{shelved ? "Welcome back." : "A blank desk."}</h1>
          <p className="welcome-lede">
            {shelved
              ? `${docs.length} ${docs.length === 1 ? "manuscript" : "manuscripts"} on the shelf, ${total.toLocaleString()} words between them.`
              : "Bring in a manuscript you’ve already started, or begin a new one."}
          </p>

          <div className="welcome-actions">
            <button
              type="button"
              className={`btn ${shelved ? "" : "btn-primary"}`}
              onClick={() => picker.current?.click()}
              disabled={lib.busy}
            >
              <IconImport /> Import markdown
            </button>
            <button type="button" className="btn" onClick={lib.createNew} disabled={lib.busy}>
              <IconPlus /> New manuscript
            </button>
            <Link href="/settings" className="btn">
              <IconSettings /> Settings
            </Link>
          </div>
          <input
            ref={picker}
            type="file"
            accept={IMPORT_ACCEPT}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void lib.importFile(file);
            }}
          />

          {lib.error && (
            <p className="welcome-error" role="alert">
              {lib.error}
            </p>
          )}

          {shelved && (
            <Shelf
              docs={docs}
              busy={lib.busy}
              onDelete={lib.remove}
              onCover={lib.setCover}
              onRemoveCover={lib.removeCover}
            />
          )}

          <p className="welcome-hint label">
            {shelved
              ? "Drop a manuscript anywhere to import it, or an image on a book for its cover"
              : ".md · .markdown · .txt — or drop a file anywhere"}
          </p>
        </section>
      </main>

      <DropImport onFile={lib.importFile} passImages />
    </div>
  );
}
