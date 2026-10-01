"use client";

import Link from "next/link";
import { useRef } from "react";
import type { DocMeta } from "@/lib/docs";
import type { Layout } from "@/lib/shelfLayout";
import { IMPORT_ACCEPT, useLibrary } from "@/lib/useLibrary";
import DropImport from "./DropImport";
import { IconGithub, IconImport, IconPlus, IconSettings } from "./icons";
import Logo from "./Logo";
import Shelves from "./Shelves";
import ThemeButton from "./ThemeButton";

/** The welcome page, and the library as a shelf once there's something on it. */
export default function Home({ docs, shelves }: { docs: DocMeta[]; shelves: Layout }) {
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
          <a
            href="https://github.com/fazo96/pen"
            className="icon-btn"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Pen on GitHub"
            title="Pen on GitHub"
          >
            <IconGithub />
          </a>
        </div>
      </header>

      <main className="page page-bare">
        <section className={`welcome ${shelved ? "is-shelved" : ""}`}>
          <span className="label">pen · a quiet place to write</span>
          <h1 className="welcome-title">{shelved ? "Welcome back." : "A blank desk."}</h1>
          <p className="welcome-lede">
            {shelved
              ? `${docs.length} ${docs.length === 1 ? "manuscript" : "manuscripts"} in the library, ${total.toLocaleString()} words between them.`
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
            <Shelves
              docs={docs}
              layout={shelves}
              busy={lib.busy}
              onDelete={lib.remove}
              onCover={lib.setCover}
              onRemoveCover={lib.removeCover}
            />
          )}

          <p className="welcome-hint label">
            {shelved
              ? "Drag books between shelves to arrange them. Drop a manuscript anywhere to import it, or an image on a book for its cover"
              : ".md · .markdown · .txt — or drop a file anywhere"}
          </p>
        </section>
      </main>

      <DropImport onFile={lib.importFile} passImages />
    </div>
  );
}
