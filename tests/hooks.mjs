// Module resolution the way Next does it, for tests: `@/` is the project
// root, relative imports may leave out `.ts`, and `server-only` (which throws
// outside React's server build) is empty.
const ROOT = new URL("../", import.meta.url);
const SERVER_ONLY = new URL("node_modules/server-only/empty.js", ROOT).href;

export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: SERVER_ONLY, shortCircuit: true };
  if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), ROOT).href;
  try {
    return await next(specifier, context);
  } catch (err) {
    const missing = err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "ERR_UNSUPPORTED_DIR_IMPORT";
    if (!missing || !/^(\.|\/|file:)/.test(specifier)) throw err;
    for (const ext of [".ts", "/index.ts"]) {
      try {
        return await next(specifier + ext, context);
      } catch {}
    }
    throw err;
  }
}
