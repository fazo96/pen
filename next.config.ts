import type { NextConfig } from "next";

// Harper runs in a worker thread that loads it from node_modules at run time
// (lib/harperWorker.ts), out of the bundler's sight: the routes that check
// grammar list it, so a standalone build still has it.
const HARPER = ["./node_modules/harper.js/package.json", "./node_modules/harper.js/dist/*.js"];

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingIncludes: {
    "/api/construct/mcp": HARPER,
    "/api/grammar/check": HARPER,
  },
  // The Docker build asks for a self-contained server (see Dockerfile);
  // everywhere else `next start` serves the regular build.
  ...(process.env.PEN_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
