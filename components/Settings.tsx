import Link from "next/link";
import type { LibraryStats } from "@/lib/library";
import SettingsHead from "./SettingsHead";
import ConstructSettings from "./ConstructSettings";
import EditorSettings from "./EditorSettings";
import GrammarSettings from "./GrammarSettings";
import KeySettings from "./KeySettings";
import { IconBack, IconBooks, IconChart, IconExport } from "./icons";
import Logo from "./Logo";
import LockSettings from "./LockSettings";
import Stats from "./Stats";
import ThemeButton from "./ThemeButton";

/** Settings for the whole desk. */
export default function Settings({
  locked,
  stats,
  agents,
  aiSwitchedOff,
}: {
  locked: boolean;
  stats: LibraryStats;
  /** The AI agents found on the server, by name. */
  agents: string[];
  aiSwitchedOff: boolean;
}) {
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
          <section className="settings-section" aria-labelledby="library-title">
            <SettingsHead icon={<IconBooks />} title="Library" id="library-title" />
            <Stats stats={stats} library={stats} />
            <p className="settings-text">
              Export everything as a zip: every book with its versions, Codex and Construct chats, the trash, the
              shelves and the writing stats. Unzipped, it’s a data folder pen can run from.
            </p>
            <div className="settings-actions">
              <Link className="btn" href="/stats">
                <IconChart /> Writing stats
              </Link>
              <a className="btn" href="/api/export" download>
                <IconExport /> Export library
              </a>
            </div>
          </section>
          <EditorSettings />
          <GrammarSettings />
          <ConstructSettings agents={agents} switchedOff={aiSwitchedOff} />
          <KeySettings />
          <LockSettings locked={locked} />
        </section>
      </main>
    </div>
  );
}
