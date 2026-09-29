import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The Docker build asks for a self-contained server (see Dockerfile);
  // everywhere else `next start` serves the regular build.
  ...(process.env.PEN_STANDALONE ? { output: "standalone" as const } : {}),
};

export default nextConfig;
