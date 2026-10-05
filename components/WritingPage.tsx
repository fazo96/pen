import Link from "next/link";
import type { WritingReport } from "@/lib/writing";
import { IconBack } from "./icons";
import Logo from "./Logo";
import ThemeButton from "./ThemeButton";
import WritingStats from "./WritingStats";

/** /stats: what was written, and whether it was drafting or editing. */
export default function WritingPage({ report }: { report: WritingReport }) {
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
          <span className="topbar-title">Writing</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className="welcome settings">
          <span className="label">pen · writing stats</span>
          <h1 className="welcome-title">Writing</h1>
          <p className="welcome-lede">
            Words you typed into your manuscripts, counted at every save. New paragraphs and words added at the end of
            one are drafting; words changed inside existing text, and words removed, are editing. Pasted text isn’t
            counted.
          </p>
          <WritingStats report={report} />
        </section>
      </main>
    </div>
  );
}
