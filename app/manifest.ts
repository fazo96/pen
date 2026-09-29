import type { MetadataRoute } from "next";

// Installable, no service worker: saves need the server anyway, and a cache
// would only get in the way of autosave's conflict checks.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "pen",
    short_name: "pen",
    description: "A quiet place to write.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f3ead3",
    theme_color: "#f3ead3",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
