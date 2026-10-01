import Link from "next/link";
import type { LibraryStats } from "@/lib/library";
import { IconBack, IconBooks, IconExport } from "./icons";
import Logo from "./Logo";
import LockSettings from "./LockSettings";
import Stats from "./Stats";
import ThemeButton from "./ThemeButton";

/** Settings for the whole desk. */
export default function Settings({ locked, stats }: { locked: boolean; stats: LibraryStats }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/?library" className="icon-btn" aria-label="Back to the library" title="Library">
            <IconBack />
          </Link>
          <Link href="/?library" className="wordmark" aria-label="pen">
            <Logo />
          </Link>
          <span className="topbar-title">Settings</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className="welcome settings">
          <span className="label">pen · settings</span>
          <h1 className="welcome-title">Settings</h1>
          <section className="lock" aria-labelledby="library-title">
            <div className="lock-head">
              <IconBooks />
              <h2 id="library-title" className="label">
                Library
              </h2>
            </div>
            <Stats stats={stats} library={stats} />
            <p className="lock-text">
              Export everything as a zip: every book with its versions, Codex and Construct chats, the trash, and the
              shelves. Unzipped, it’s a data folder pen can run from.
            </p>
            <div className="lock-actions">
              <a className="btn" href="/api/export" download>
                <IconExport /> Export library
              </a>
            </div>
          </section>
          <LockSettings locked={locked} />
        </section>
      </main>
    </div>
  );
}
