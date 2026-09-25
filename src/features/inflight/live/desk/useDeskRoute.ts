"use client";

// The inner layer's address, kept in the URL hash (deskRoute.ts): opening a round pushes a history
// entry, so the browser's Back button walks out of the layer the way Esc does. Closing removes the hash
// entirely rather than leaving a bare "#".

import { useCallback, useEffect, useState } from "react";
import { parseRoute, routeHash, type DeskRoute } from "./deskRoute";

const read = (): DeskRoute | null => (typeof window === "undefined" ? null : parseRoute(window.location.hash));

export function useDeskRoute(): [DeskRoute | null, (to: DeskRoute | null) => void] {
  // Null on the server and on the first client render, so hydration matches; the hash is read after.
  const [route, setRoute] = useState<DeskRoute | null>(null);

  useEffect(() => {
    const sync = () => setRoute(read());
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const go = useCallback((to: DeskRoute | null) => {
    if (to) {
      const hash = routeHash(to);
      if (window.location.hash !== hash) window.location.hash = hash;
      setRoute(to);
      return;
    }
    if (window.location.hash) window.history.pushState(null, "", window.location.pathname + window.location.search);
    setRoute(null);
  }, []);

  return [route, go];
}
