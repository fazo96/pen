import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Construct's grammar_check runs Harper in a worker thread that loads it
  // from node_modules at run time (lib/construct/harperWorker.ts), out of the
  // bundler's sight: make sure a standalone build still has it.
  outputFileTracingIncludes: {
    "/api/construct/mcp": ["./node_modules/harper.js/package.json", "./node_modules/harper.js/dist/*.js"],
  },
  // The Docker build asks for a self-contained server (see Dockerfile);
  // everywhere else `next start` serves the regular build.
  ...(process.env.PEN_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
