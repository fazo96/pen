// A named queue: functions given to it run one at a time, in order, so a
// read-modify-write of a file never interleaves with another. Kept on
// globalThis by name, so a module loaded twice (route and page bundles, dev
// reloads) still shares one queue. A failure doesn't stop the ones after it.
// Imports nothing from pen, so tests load it with plain Node.

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

const g = globalThis as typeof globalThis & { __penQueues?: Map<string, Run> };
const queues = (g.__penQueues ??= new Map());

export function queue(name: string): Run {
  let run = queues.get(name);
  if (!run) {
    let tail: Promise<unknown> = Promise.resolve();
    run = <T>(fn: () => Promise<T>): Promise<T> => {
      const next = tail.then(fn);
      tail = next.catch(() => {});
      return next;
    };
    queues.set(name, run);
  }
  return run;
}
