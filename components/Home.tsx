"use client";

import { useRef, useState } from "react";
import type { DocMeta } from "@/lib/docs";
import { IMPORT_ACCEPT, useLibrary } from "@/lib/useLibrary";
import Drawer from "./Drawer";
import DropImport from "./DropImport";
import { IconImport, IconLock, IconOutline, IconPlus } from "./icons";
import Library from "./Library";
import LockSettings from "./LockSettings";
import ThemeButton from "./ThemeButton";

/** Nothing selected: the rail is the library, the page is a welcome. */
export default function Home({ docs, locked }: { docs: DocMeta[]; locked: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const lib = useLibrary();
  const total = docs.reduce((n, d) => n + d.words, 0);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-btn outline-toggle"
            onClick={() => setDrawerOpen((o) => !o)}
            aria-label="Library"
            aria-expanded={drawerOpen}
          >
            <IconOutline />
          </button>
          <span className="wordmark">pen</span>
          <span className="topbar-title">Library</span>
        </div>
        <div className="topbar-right">
          <button
            type="button"
            className={`icon-btn ${locked ? "is-on" : ""}`}
            onClick={() => document.getElementById("lock")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            aria-label={locked ? "Lock: on" : "Lock: off"}
            title={locked ? "Lock: on" : "Lock: off"}
          >
            <IconLock />
          </button>
          <ThemeButton />
        </div>
      </header>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        label="Library"
        head={
          <>
            <span className="label">Library</span>
            <button type="button" className="drawer-action" onClick={lib.createNew} disabled={lib.busy}>
              <IconPlus /> New
            </button>
          </>
        }
        foot={`${docs.length} ${docs.length === 1 ? "manuscript" : "manuscripts"} · ${total.toLocaleString()} words`}
      >
        <Library docs={docs} onDelete={lib.remove} busy={lib.busy} />
      </Drawer>

      <main className="page">
        <section className="welcome">
          <span className="label">pen · a quiet place to write</span>
          <h1 className="welcome-title">{docs.length ? "Welcome back." : "A blank desk."}</h1>
          <p className="welcome-lede">
            {docs.length
              ? "Choose a manuscript from the library, begin a new one, or bring one in from elsewhere."
              : "Bring in a manuscript you’ve already started, or begin a new one."}
          </p>

          <div className="welcome-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => picker.current?.click()}
              disabled={lib.busy}
            >
              <IconImport /> Import markdown
            </button>
            <button type="button" className="btn" onClick={lib.createNew} disabled={lib.busy}>
              <IconPlus /> New manuscript
            </button>
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

          {docs.length > 0 && (
            <button type="button" className="welcome-library" onClick={() => setDrawerOpen(true)}>
              Open library · {docs.length}
            </button>
          )}

          {lib.error && (
            <p className="welcome-error" role="alert">
              {lib.error}
            </p>
          )}
          <p className="welcome-hint label">.md · .markdown · .txt — or drop a file anywhere</p>

          <LockSettings locked={locked} />
        </section>
      </main>

      <DropImport onFile={lib.importFile} />
    </div>
  );
}
