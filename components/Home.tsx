"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { DocMeta } from "@/lib/types";
import type { Layout } from "@/lib/shelfLayout";
import type { WritingReport } from "@/lib/writing";
import { IMPORT_ACCEPT, useLibrary } from "@/lib/useLibrary";
import DropImport from "./DropImport";
import LastEdited from "./LastEdited";
import { IconGithub, IconImport, IconPlus, IconSettings } from "./icons";
import Logo from "./Logo";
import Shelves from "./Shelves";
import ThemeButton from "./ThemeButton";
import WritingCard from "./WritingCard";

/** Books in the library before the last edited one is shown over the shelves. */
const LAST_EDITED_FROM = 4;

/** The welcome page, and the library as a shelf once there's something on it. */
export default function Home({ docs, shelves, writing }: { docs: DocMeta[]; shelves: Layout; writing: WritingReport }) {
  const picker = useRef<HTMLInputElement>(null);
  const lib = useLibrary();
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState("");
  const total = docs.reduce((n, d) => n + d.words, 0);
  const shelved = docs.length > 0;
  // With a few books it would only repeat the shelf.
  const last = docs.length >= LAST_EDITED_FROM ? docs.reduce((a, b) => (b.modified > a.modified ? b : a)) : null;

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
            <button
              type="button"
              className={`btn ${naming ? "is-on" : ""}`}
              onClick={() => {
                setTitle("");
                setNaming((n) => !n);
              }}
              disabled={lib.busy}
              aria-expanded={naming}
            >
              <IconPlus /> New manuscript
            </button>
            <Link href="/settings" className="btn">
              <IconSettings /> Settings
            </Link>
          </div>
          {naming && (
            <form
              className="new-book"
              onSubmit={(e) => {
                e.preventDefault();
                if (!lib.busy) void lib.createNew(title);
              }}
            >
              <label className="field">
                <span className="label">Title</span>
                <input
                  value={title}
                  placeholder="Untitled"
                  maxLength={200}
                  autoFocus
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
                />
              </label>
              <div className="settings-actions">
                <button type="submit" className="btn btn-primary" disabled={lib.busy}>
                  Create
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </div>
              <p className="settings-hint">It also names the book’s address. No title yet? Leave it empty and set one later.</p>
            </form>
          )}
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
            <div className="library-glance">
              <WritingCard report={writing} />
              {last && <LastEdited doc={last} />}
            </div>
          )}

          {shelved && (
            <Shelves
              docs={docs}
              layout={shelves}
              onCover={lib.setCover}
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
