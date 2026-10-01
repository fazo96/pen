import type { LibraryStats, Stats as Figures } from "@/lib/library";

const n = (x: number) => x.toLocaleString("en-US");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

export function bytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = b / 1024;
  let i = 0;
  for (; v >= 1024 && i < units.length - 1; i++) v /= 1024;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** What a book (or the whole library) holds: words, Codex, versions, and room on disk. */
export default function Stats({ stats, library }: { stats: Figures; library?: LibraryStats }) {
  const rows: [string, string][] = [
    ...(library ? ([["Books", `${n(library.books)} on ${plural(library.shelves, "shelf", "shelves")}`]] as [string, string][]) : []),
    ["Manuscript" + (library ? "s" : ""), plural(stats.words, "word")],
    ["Codex", stats.codexEntries ? `${plural(stats.codexEntries, "entry", "entries")} · ${plural(stats.codexWords, "word")}` : "Empty"],
    [
      "Versions",
      stats.namedVersions + stats.autoVersions
        ? `${n(stats.namedVersions)} named · ${n(stats.autoVersions)} automatic`
        : "None yet",
    ],
    [library ? "Books on disk" : "On disk", bytes(stats.bytes)],
    ["Trash", stats.trashBytes ? bytes(stats.trashBytes) : "Empty"],
    ...(library ? ([["Data folder", `${bytes(library.totalBytes)} in all`]] as [string, string][]) : []),
  ];
  return (
    <dl className="stats">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="label">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
