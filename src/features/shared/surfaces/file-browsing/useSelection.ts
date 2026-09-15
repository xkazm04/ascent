"use client";

// selection-model: a set of IDENTITIES plus an anchor and a focus (identities too), never indices.
// The grammar: plain click replaces, the toggle modifier adds/removes and moves the anchor, the
// range modifier selects anchor→target in CURRENT visual order and stores the result as identities.
// Against a windowed listing "select all" is two honest gestures: all LOADED (materialized ids, the
// count says "loaded") or all MATCHING as a PREDICATE plus an exclusion list, resolved at mutation
// time by the store that owns the full set. `reconcile` intersects the set with a fresh listing.

import { useCallback, useState } from "react";

export type Selection = { mode: "ids"; ids: ReadonlySet<string> } | { mode: "predicate"; exclude: ReadonlySet<string> };
export type ClickMods = { toggle?: boolean; range?: boolean };

const EMPTY: Selection = { mode: "ids", ids: new Set() };

export function useSelection() {
  const [sel, setSel] = useState<Selection>(EMPTY);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);

  /** `order` is the visible order at the moment of the gesture — range is the one legitimately
   *  positional concept, resolved to identities right here and never stored as positions. */
  const click = useCallback(
    (id: string, mods: ClickMods, order: readonly string[]) => {
      setFocus(id);
      setSel((cur) => {
        if (mods.range && anchor) {
          const a = order.indexOf(anchor);
          const b = order.indexOf(id);
          if (a >= 0 && b >= 0) {
            const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
            const base = mods.toggle && cur.mode === "ids" ? new Set(cur.ids) : new Set<string>();
            span.forEach((x) => base.add(x));
            return { mode: "ids", ids: base };
          }
        }
        if (mods.toggle) {
          if (cur.mode === "predicate") {
            const exclude = new Set(cur.exclude);
            if (exclude.has(id)) exclude.delete(id);
            else exclude.add(id);
            return { mode: "predicate", exclude };
          }
          const ids = new Set(cur.ids);
          if (ids.has(id)) ids.delete(id);
          else ids.add(id);
          return { mode: "ids", ids };
        }
        return { mode: "ids", ids: new Set([id]) };
      });
      if (!mods.range) setAnchor(id);
    },
    [anchor],
  );

  const isSelected = useCallback((id: string): boolean => (sel.mode === "ids" ? sel.ids.has(id) : !sel.exclude.has(id)), [sel]);

  /** All LOADED: the materialized window, and the count will say so. */
  const selectLoaded = useCallback((loaded: readonly string[]) => setSel({ mode: "ids", ids: new Set(loaded) }), []);
  /** All MATCHING: a predicate, resolved by the store at mutation time — never a partial universe called everything. */
  const selectMatching = useCallback(() => setSel({ mode: "predicate", exclude: new Set() }), []);
  const invertLoaded = useCallback((loaded: readonly string[]) => setSel((cur) => ({ mode: "ids", ids: new Set(loaded.filter((id) => (cur.mode === "ids" ? !cur.ids.has(id) : cur.exclude.has(id)))) })), []);
  const clear = useCallback(() => {
    setSel(EMPTY);
    setAnchor(null);
    setDropped(0);
  }, []);

  /** After a refresh: intersect by identity. Survivors stay; vanished items drop out, counted, visibly. */
  const reconcile = useCallback(
    (live: ReadonlySet<string>) => {
      if (sel.mode === "predicate") setSel({ mode: "predicate", exclude: new Set([...sel.exclude].filter((id) => live.has(id))) });
      else {
        const ids = new Set([...sel.ids].filter((id) => live.has(id)));
        if (ids.size !== sel.ids.size) {
          setDropped((d) => d + (sel.ids.size - ids.size));
          setSel({ mode: "ids", ids });
        }
      }
      setFocus((f) => (f && live.has(f) ? f : null));
      setAnchor((a) => (a && live.has(a) ? a : null));
    },
    [sel],
  );

  /** The exact identity list a mutation receives — the count shown is `resolve(...).length`. */
  const resolve = useCallback((matching: readonly string[]): string[] => (sel.mode === "ids" ? matching.filter((id) => sel.ids.has(id)) : matching.filter((id) => !sel.exclude.has(id))), [sel]);

  return { sel, anchor, focus, dropped, click, isSelected, selectLoaded, selectMatching, invertLoaded, clear, reconcile, resolve, setFocus };
}

export type SelectionApi = ReturnType<typeof useSelection>;
