"use client";

// useHashFlag: one nested level held in the URL hash (`#outcome`), so the level has a real URL, the browser Back
// button closes it, and a reload lands in it. `[open, setOpen]`: setOpen(true) pushes `#<name>`, setOpen(false) drops
// the hash WITHOUT a scroll jump. The server snapshot is `false` (a hash never reaches the server), so a level that
// is open on load appears on hydration; render the overview under it so nothing is blank meanwhile.
import { useCallback, useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function useHashFlag(name: string): readonly [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    subscribe,
    () => window.location.hash === `#${name}`,
    () => false,
  );
  const set = useCallback(
    (next: boolean) => {
      const { pathname, search } = window.location;
      if (next) window.location.hash = name;
      else history.pushState(null, "", `${pathname}${search}`);
      // pushState fires no hashchange: tell the subscribers ourselves so a close renders.
      if (!next) window.dispatchEvent(new HashChangeEvent("hashchange"));
    },
    [name],
  );
  return [open, set] as const;
}
