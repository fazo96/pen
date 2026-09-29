import Link from "next/link";
import { IconBack } from "./icons";
import LockSettings from "./LockSettings";
import ThemeButton from "./ThemeButton";

/** Settings for the whole desk. */
export default function Settings({ locked }: { locked: boolean }) {
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/?library" className="icon-btn" aria-label="Back to the library" title="Library">
            <IconBack />
          </Link>
          <Link href="/?library" className="wordmark">
            pen
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
          <LockSettings locked={locked} />
        </section>
      </main>
    </div>
  );
}
