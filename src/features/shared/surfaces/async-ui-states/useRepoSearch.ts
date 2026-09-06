"use client";

// The repository search's orchestration: three key coordinates classified ONCE (KEY_CLASS), one request
// region, one surface-scoped seen-set, and the change log the key-classification region reads. Every
// handler below applies the classification's consumer table: an identifying change drops content,
// resets the settled bit, the scroll, the page and the seen-set; a windowing change keeps content
// (marked superseded), touches none of those, and never resets the identifying coordinate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { KEY_CLASS, LATENCY, type Axis, type KeyName, type Latency } from "./asyncState";
import { PAGE_SIZE, driftRepos, queryRepos, repoRows, type Repo, type Sort } from "./fixtures";
import { useRequestRegion, useSeenSet } from "./asyncHooks";

export type Change = { key: KeyName | "refresh" | "race"; axis: Axis | null; from: string; to: string };
type Query = { term: string; page: number; sort: Sort };

/** The windowing coordinates the held content answers — declared on the INPUT side at issue time. */
export const windowKey = (page: number, sort: Sort) => `page ${page} · ${sort}`;

export function useRepoSearch(volume: SurfaceVolume, latency: Latency) {
  const universe = useMemo(() => repoRows(volume), [volume]);
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>("name");
  const [nonce, setNonce] = useState(0);
  const [change, setChange] = useState<Change | null>(null);
  const [scrollResets, setScrollResets] = useState(0);
  const region = useRequestRegion<Repo>();
  const seen = useSeenSet();
  // The list element is STATE set by a callback ref (never a ref read during render): the owner's
  // animationend listener re-subscribes when the list remounts, and the handlers scroll it.
  const [listEl, setListEl] = useState<HTMLUListElement | null>(null);
  const latencyRef = useRef(latency);
  useEffect(() => {
    latencyRef.current = latency;
  });

  const { issue } = region;
  const total = useMemo(() => queryRepos(universe, { term, page: 1, sort }).total, [universe, term, sort]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const run = useCallback(
    (q: Query, axis: Axis | null, tag: string, latencyMs?: number, rows?: Repo[]) => {
      issue({ rows: rows ?? queryRepos(universe, q).rows, latencyMs: latencyMs ?? LATENCY[latencyRef.current] }, { key: windowKey(q.page, q.sort), drop: axis === "identifying", tag });
    },
    [issue, universe],
  );

  // First load: the surface's first arrival. (The owner remounts this hook per volume, so a new
  // universe is a new surface, not a hand-reset.)
  useEffect(() => {
    run({ term: "", page: 1, sort: "name" }, "identifying", "arrival");
  }, [run]);

  const search = (t: string) => {
    setChange({ key: "term", axis: KEY_CLASS.term, from: term || "∅", to: t || "∅" });
    setTerm(t);
    setPage(1); // dependent coordinate: identifying → windowing, one direction only
    seen.reset(); // these will be first appearances
    listEl?.scrollTo?.({ top: 0 });
    setScrollResets((n) => n + 1);
    run({ term: t, page: 1, sort }, "identifying", "arrival");
  };
  const turnPage = (p: number) => {
    setChange({ key: "page", axis: KEY_CLASS.page, from: String(page), to: String(p) });
    setPage(p);
    run({ term, page: p, sort }, "windowing", "window");
  };
  const resort = (s: Sort) => {
    setChange({ key: "sort", axis: KEY_CLASS.sort, from: sort, to: s });
    setSort(s);
    run({ term, page, sort: s }, "windowing", "window");
  };
  const refresh = () => {
    setChange({ key: "refresh", axis: null, from: "same key", to: "same key" });
    setNonce((n) => n + 1);
    run({ term, page, sort }, null, "refresh", undefined, driftRepos(queryRepos(universe, { term, page, sort }).rows, nonce + 1));
  };
  /** Two overlapping requests for the same key: the slow one is issued first and must be dropped. */
  const race = () => {
    setChange({ key: "race", axis: null, from: "slow #1", to: "fast #2" });
    run({ term, page, sort }, null, "stale", LATENCY.race);
    run({ term, page, sort }, null, "refresh", LATENCY.warm, driftRepos(queryRepos(universe, { term, page, sort }).rows, 99));
  };

  const superseded = region.content.length > 0 && region.appliedKey !== windowKey(page, sort);
  return { term, page, pages, sort, total, region, seen, listEl, setListEl, change, scrollResets, superseded, search, turnPage, resort, refresh, race };
}

export type RepoSearch = ReturnType<typeof useRepoSearch>;
