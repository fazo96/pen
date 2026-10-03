"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { COVER_ACCEPT, isImage } from "@/lib/cover";
import type { DocMeta } from "@/lib/docs";
import type { Stats as Figures } from "@/lib/library";
import { findBook, type Layout, moveBook } from "@/lib/shelfLayout";
import { pageCount, slugify } from "@/lib/text";
import { useLibrary } from "@/lib/useLibrary";
import { ago, Cover } from "./Book";
import { IconBack, IconBooks, IconClose, IconExport, IconImage, IconPencil, IconShelf, IconTrash } from "./icons";
import Logo from "./Logo";
import Stats from "./Stats";
import ThemeButton from "./ThemeButton";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** What an address can hold, tidied as it's typed: lowercase, hyphens for spaces. */
const typedId = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .slice(0, 80);

type Section = "cover" | "shelf" | "address" | "delete";

/** One book's settings: cover, shelf, address (its id in URLs), and deleting it. */
export default function BookSettings({ doc, shelves, stats }: { doc: DocMeta; shelves: Layout; stats: Figures }) {
  const router = useRouter();
  const lib = useLibrary();
  const picker = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<Section | null>(null);
  const [dropping, setDropping] = useState(false);
  const [layout, setLayout] = useState(shelves);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ at: Section; text: string } | null>(null);
  const [address, setAddress] = useState(doc.id);
  const [confirming, setConfirming] = useState(false);

  const act = (at: Section) => {
    setSection(at);
    setNotice(null);
    setShelfError(null);
  };
  const errorIn = (at: Section) =>
    section === at && (lib.error || (at === "shelf" && shelfError)) ? (
      <p className="welcome-error" role="alert">
        {at === "shelf" ? shelfError : lib.error}
      </p>
    ) : notice?.at === at ? (
      <p className="lock-notice" role="status">
        {notice.text}
      </p>
    ) : null;

  const cover = (file: File) => {
    act("cover");
    void lib.setCover(doc.id, file);
  };

  const shelf = findBook(layout, doc.id)?.shelf ?? layout.shelves[0].id;
  const moveTo = async (to: string) => {
    act("shelf");
    const next = moveBook(layout, doc.id, to, Infinity);
    const before = layout;
    setLayout(next);
    try {
      const res = await fetch("/api/shelves", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      const name = next.shelves.find((s) => s.id === to)?.name;
      setNotice({ at: "shelf", text: `Moved to ${name ? `“${name}”` : "the unnamed shelf"}.` });
    } catch (e) {
      setLayout(before);
      setShelfError(`Couldn’t move it: ${e instanceof Error ? e.message : e}`);
    }
  };

  // An address that follows the title, when it doesn't already ("untitled", or a
  // title changed since). "the-tide-2" beside "the-tide" is left alone.
  const fromTitle = slugify(doc.title);
  const suggested =
    fromTitle && ID_RE.test(fromTitle) && fromTitle !== doc.id && !new RegExp(`^${fromTitle}-\\d+$`).test(doc.id)
      ? fromTitle
      : address;
  const wanted = address.replace(/-+$/, "");
  const addressOk = ID_RE.test(wanted);
  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressOk || wanted === doc.id || lib.busy) return;
    act("address");
    if (await lib.rename(doc.id, wanted)) router.replace(`/d/${wanted}/settings`);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <Link href={`/d/${doc.id}`} className="icon-btn" aria-label="Back to the book" title="Back to the book">
            <IconBack />
          </Link>
          <Link href="/?library" className="wordmark" aria-label="Library" title="Library">
            <Logo />
          </Link>
          <span className="topbar-title">Book settings</span>
        </div>
        <div className="topbar-right">
          <ThemeButton />
        </div>
      </header>

      <main className="page page-bare">
        <section className="welcome settings book-settings">
          <span className="label">pen · book settings</span>
          <h1 className="welcome-title">{doc.title}</h1>
          <p className="welcome-lede" suppressHydrationWarning>
            {doc.words.toLocaleString()} {doc.words === 1 ? "word" : "words"} (about {pageCount(doc.words).toLocaleString()} {pageCount(doc.words) === 1 ? "page" : "pages"}), last written {ago(doc.modified, Date.now())}.
            The title is the manuscript’s first heading: <Link href={`/d/${doc.id}`}>change it there</Link>.
          </p>

          <section className="lock" aria-labelledby="contents-title">
            <div className="lock-head">
              <IconBooks />
              <h2 id="contents-title" className="label">
                Contents
              </h2>
            </div>
            <Stats stats={stats} />
            <p className="lock-text">
              Export it as a zip: the manuscript, versions, Codex, Construct chats, cover, and whatever of it is in the
              trash.
            </p>
            <div className="lock-actions">
              <a className="btn" href={`/api/docs/${doc.id}/export`} download>
                <IconExport /> Export book
              </a>
            </div>
          </section>

          <section className="lock" aria-labelledby="cover-title">
            <div className="lock-head">
              <IconImage />
              <h2 id="cover-title" className="label">
                Cover
              </h2>
            </div>
            <div className="book-settings-cover">
              <div
                className={`book-settings-art ${dropping ? "is-drop" : ""} ${lib.busy && section === "cover" ? "is-binding" : ""}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes("Files")) return;
                  e.preventDefault();
                  setDropping(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropping(false);
                  const file = e.dataTransfer.files[0];
                  if (file && isImage(file)) cover(file);
                }}
              >
                <Cover doc={doc} />
              </div>
              <div>
                <p className="lock-text">
                  {doc.cover
                    ? "Shown on the shelf. Drop another image on it to replace it."
                    : "Without art the book is bound in cloth with its title. Drop an image here, or pick one."}
                </p>
                <div className="lock-actions">
                  <button type="button" className="btn" disabled={lib.busy} onClick={() => picker.current?.click()}>
                    <IconImage /> {doc.cover ? "Change cover" : "Set cover"}
                  </button>
                  {doc.cover && (
                    <button
                      type="button"
                      className="btn btn-quiet"
                      disabled={lib.busy}
                      onClick={() => {
                        act("cover");
                        void lib.removeCover(doc.id);
                      }}
                    >
                      <IconClose /> Remove
                    </button>
                  )}
                </div>
                {errorIn("cover")}
              </div>
            </div>
            <input
              ref={picker}
              type="file"
              accept={COVER_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) cover(file);
              }}
            />
          </section>

          <section className="lock" aria-labelledby="shelf-title">
            <div className="lock-head">
              <IconShelf />
              <h2 id="shelf-title" className="label">
                Shelf
              </h2>
            </div>
            {layout.shelves.length > 1 ? (
              <label className="field book-settings-field">
                <span className="lock-text">Which shelf it sits on in the library. It goes at the end.</span>
                <select value={shelf} onChange={(e) => void moveTo(e.target.value)}>
                  {layout.shelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || "Unnamed shelf"}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="lock-text">
                Every book shares one shelf for now. <Link href="/?library">Add shelves in the library</Link> to
                sort them.
              </p>
            )}
            {errorIn("shelf")}
          </section>

          <section className="lock" aria-labelledby="address-title">
            <div className="lock-head">
              <IconPencil />
              <h2 id="address-title" className="label">
                Address
              </h2>
            </div>
            <p className="lock-text">The name in this book’s links. Old links keep working after a change.</p>
            <form className="book-settings-address" onSubmit={rename}>
              <label className="field">
                <span className="book-settings-url">
                  <span aria-hidden>/d/</span>
                  <input
                    value={address}
                    aria-label="Address"
                    aria-invalid={!addressOk}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => setAddress(typedId(e.target.value))}
                  />
                </span>
              </label>
              <button type="submit" className="btn" disabled={!addressOk || wanted === doc.id || lib.busy}>
                Save
              </button>
            </form>
            {!addressOk ? (
              <p className="lock-hint">Letters, digits and hyphens.</p>
            ) : (
              suggested !== address && (
                <p className="lock-hint">
                  It doesn’t match the title.{" "}
                  <button type="button" className="link-btn" onClick={() => setAddress(suggested)}>
                    Use /d/{suggested}
                  </button>
                </p>
              )
            )}
            {errorIn("address")}
          </section>

          <section className="lock" aria-labelledby="delete-title">
            <div className="lock-head">
              <IconTrash />
              <h2 id="delete-title" className="label">
                Delete
              </h2>
            </div>
            {confirming ? (
              <div className="library-confirm">
                Move <em>{doc.title}</em> to the trash, with its versions, Codex and Construct chats?
                <div className="library-confirm-actions">
                  <button type="button" onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={lib.busy}
                    onClick={() => {
                      act("delete");
                      void lib.remove(doc.id, "/?library");
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="lock-text">
                  The book, its versions, Codex and Construct chats go to the trash folder on the server.
                </p>
                <div className="lock-actions">
                  <button type="button" className="btn" onClick={() => setConfirming(true)}>
                    <IconTrash /> Delete book…
                  </button>
                </div>
              </>
            )}
            {errorIn("delete")}
          </section>
        </section>
      </main>
    </div>
  );
}
