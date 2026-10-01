// Old project ids and where they went, so links to a renamed book still
// work. Pure, shared by lib/renames.ts and the tests.

export type Renames = Record<string, string>;

/** The map after `from` is renamed to `to`: kept one hop deep, so every old id points at the current one. */
export function withRename(renames: Renames, from: string, to: string): Renames {
  const next: Renames = {};
  for (const [old, now] of Object.entries(renames)) {
    if (old === to) continue; // `to` is a real project again
    next[old] = now === from ? to : now;
  }
  next[from] = to;
  return next;
}
