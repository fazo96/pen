// The browser's storage, for per-device conveniences. Reading or writing it
// throws in some private windows and when site data is blocked, and a full
// quota throws too: these never do, and read as empty instead.

type Storage = {
  get(key: string): string | null;
  /** null removes it. False if that failed (storage blocked or full). */
  set(key: string, value: string | null): boolean;
  keys(): string[];
};

function wrap(area: () => globalThis.Storage): Storage {
  return {
    get(key) {
      try {
        return area().getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (value === null) area().removeItem(key);
        else area().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    keys() {
      try {
        return Object.keys(area());
      } catch {
        return [];
      }
    },
  };
}

/** localStorage: kept on this device. */
export const local = wrap(() => localStorage);
/** sessionStorage: this tab, until it closes. */
export const session = wrap(() => sessionStorage);
