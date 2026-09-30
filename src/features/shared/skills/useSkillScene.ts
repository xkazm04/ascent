"use client";

// The open skill is the URL hash (`#skill-<id>`), so Back, reload and Esc share one address.
// The server snapshot is null: a hash never reaches the server, and the level appears after hydration.
import { useCallback, useSyncExternalStore } from "react";

const PREFIX = "skill-";

function readId(): string | null {
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw.startsWith(PREFIX)) return null;
  try {
    return decodeURIComponent(raw.slice(PREFIX.length)) || null;
  } catch {
    return null;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useSkillScene(): readonly [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribe, readId, () => null);
  const set = useCallback((next: string | null) => {
    const { pathname, search } = window.location;
    if (next) window.location.hash = PREFIX + encodeURIComponent(next);
    else {
      history.pushState(null, "", `${pathname}${search}`);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, []);
  return [id, set] as const;
}
