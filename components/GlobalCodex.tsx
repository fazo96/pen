"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { GLOBAL } from "@/lib/ids";
import Codex from "./Codex";
import { IconBack } from "./icons";
import Logo from "./Logo";
import ThemeButton from "./ThemeButton";

/** The Global Codex with nothing in it yet (/codex): what it's for, and a way to start. */
export default function GlobalCodex({ ai }: { ai: boolean }) {
  const router = useRouter();
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <Link href="/?library" className="wordmark" aria-label="Library" title="Library">
            <Logo />
          </Link>
          <span className="topbar-title">Global Codex</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className="welcome global-codex">
          <span className="label">pen · global codex</span>
          <h1 className="welcome-title">Notes for every book.</h1>
          <p className="welcome-lede">
            A style sheet, a world several books share, research, ideas still waiting for a book. Every book’s Codex lists these
            too, and Construct can read them from any book.
          </p>
          <Codex projectId={GLOBAL} activeId={null} onOpen={(href) => router.push(href)} ai={ai} />
          <Link href="/?library" className="btn global-codex-back">
            <IconBack /> Library
          </Link>
        </section>
      </main>
    </div>
  );
}
