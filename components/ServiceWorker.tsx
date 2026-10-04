"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { forgetOffline } from "@/lib/offline";
import { local } from "@/lib/storage";

// Registers the service worker (public/sw.js) that opens pen offline, and
// tells it what to keep: the page after an in-app navigation (which fetched no
// HTML it could keep), and on first load the files the page loaded before it
// was running. Production builds only, since next dev's files change under the
// same names; the browser tests turn it on there with localStorage `pen:sw`.

const enabled = () =>
  "serviceWorker" in navigator && (process.env.NODE_ENV === "production" || local.get("pen:sw") === "1");

/** pen's own files this page has loaded so far. */
const loadedFiles = () =>
  performance
    .getEntriesByType("resource")
    .map((e) => e.name)
    .filter((url) => new URL(url).pathname.startsWith("/_next/static/"));

export default function ServiceWorker() {
  const pathname = usePathname();
  const firstLoad = useRef(true);

  useEffect(() => {
    if (!enabled()) return;
    const first = firstLoad.current;
    firstLoad.current = false;
    if (pathname === "/unlock") {
      // Signed out: what's kept would be readable here without the password.
      void forgetOffline();
      return;
    }
    // A load the worker handled kept its page already.
    const kept = first && !!navigator.serviceWorker.controller;
    void (async () => {
      try {
        if (first) await navigator.serviceWorker.register("/sw.js");
        const worker = (await navigator.serviceWorker.ready).active;
        if (first) worker?.postMessage({ files: loadedFiles() });
        if (!kept) worker?.postMessage({ keep: location.href });
      } catch {} // registration refused (private window, storage blocked): pen works as before
    })();
  }, [pathname]);

  return null;
}
