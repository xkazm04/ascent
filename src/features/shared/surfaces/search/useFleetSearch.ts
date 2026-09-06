"use client";

// The fleet search's one state owner: raw text → the door (parse.ts) → the engine and its ladder
// (search.ts) → membership (facets.ts) → order (rank.ts) → a page. Every derivation is a memo over the
// one before it, so each region reads the same predicate and the same counts. The index is rebuilt
// from the source whenever its inputs move (a derivation that names its recomputation); under the
// "grow" posture the index deliberately lags deletions so the drift is observable.

import { useCallback, useMemo, useState } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import { DEFAULT_PREDICATE, facetCounts, passes, withClauses, type Predicate } from "./facets";
import { PAGE_SIZE, repoRows, type Repo } from "./fixtures";
import type { PaletteItem } from "./palette";
import { parseQuery } from "./parse";
import { ghostIds, rankHits, type Sort } from "./rank";
import { buildIndex, runLadder, toDocs, type Engine } from "./search";
import { DEFAULT_TOKENIZER, type TokenizerOptions } from "./tokenize";

export type IndexOpts = { mode: "index" | "scan"; posture: "sync" | "grow"; tok: TokenizerOptions };
export type Command = PaletteItem & { run: () => void };

export function useFleetSearch(volume: SurfaceVolume) {
  const repos = useMemo(() => repoRows(volume), [volume]);
  const [text, setTextRaw] = useState("");
  const [indexOpts, setIndexOpts] = useState<IndexOpts>({ mode: "index", posture: "sync", tok: DEFAULT_TOKENIZER });
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(() => new Set());
  const [reaped, setReaped] = useState<ReadonlySet<string>>(() => new Set());
  const [down, setDown] = useState(false);
  const [predicate, setPredicateRaw] = useState<Predicate>(DEFAULT_PREDICATE);
  const [sort, setSortRaw] = useState<Sort>("relevance");
  const [page, setPage] = useState(1);
  const [pageResets, setPageResets] = useState(0);

  // Any change to the predicate re-opens the window at page one — reset, not clamp.
  const resetPage = useCallback(() => {
    setPage(1);
    setPageResets((n) => n + 1);
  }, []);
  const setText = useCallback((t: string) => (setTextRaw(t), resetPage()), [resetPage]);
  const setPredicate = useCallback((p: Predicate) => (setPredicateRaw(p), resetPage()), [resetPage]);
  const setSort = useCallback((s: Sort) => (setSortRaw(s), resetPage()), [resetPage]);

  const source = useMemo(() => repos.filter((r) => !deleted.has(r.id)), [repos, deleted]);
  const sourceById = useMemo(() => new Map(source.map((r) => [r.id, r])), [source]);
  const indexReaped = indexOpts.posture === "sync" ? deleted : reaped;
  const indexed = useMemo(() => repos.filter((r) => !indexReaped.has(r.id)), [repos, indexReaped]);
  const docs = useMemo(() => toDocs(indexed, indexOpts.tok), [indexed, indexOpts.tok]);
  const engine = useMemo<Engine>(() => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    return indexOpts.mode === "index" ? { mode: "index", index: buildIndex(docs), docs: byId } : { mode: "scan", list: docs, docs: byId };
  }, [docs, indexOpts.mode]);

  const parsed = useMemo(() => parseQuery(text, indexOpts.tok), [text, indexOpts.tok]);
  const { exec, ms } = useMemo(() => {
    const t0 = performance.now();
    const e = runLadder(engine, parsed, { down });
    return { exec: e, ms: performance.now() - t0 };
  }, [engine, parsed, down]);
  const full = useMemo(() => withClauses(predicate, parsed.clauses), [predicate, parsed.clauses]);
  const hitRows = useMemo<Repo[]>(() => (exec.kind === "ok" ? [...exec.hits.keys()].map((id) => sourceById.get(id)).filter((r): r is Repo => Boolean(r)) : []), [exec, sourceById]);
  const counts = useMemo(() => facetCounts(hitRows, full), [hitRows, full]);
  const ranked = useMemo(() => rankHits(exec, engine.docs, sourceById, sort).filter((r) => passes(r.repo, full)), [exec, engine.docs, sourceById, sort, full]);
  const ghosts = useMemo(() => ghostIds(exec, sourceById), [exec, sourceById]);
  const pages = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const pageRows = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const deleteRow = (id: string) => setDeleted((s) => new Set(s).add(id));
  const restoreRows = () => (setDeleted(new Set()), setReaped(new Set()));
  const rebuild = () => setReaped(deleted); // the documented, invokable recomputation
  const setTok = (patch: Partial<TokenizerOptions>) => setIndexOpts((o) => ({ ...o, tok: { ...o.tok, ...patch } }));

  /** ONE command registry: the scene's action strip and the palette both render from it. */
  const commands: Command[] = [
    { id: "cmd:clear", kind: "command", label: "Clear filters", keywords: "reset predicate", run: () => setPredicate(DEFAULT_PREDICATE) },
    { id: "cmd:rebuild", kind: "command", label: "Rebuild index", keywords: "reindex reconcile", run: rebuild },
    { id: "cmd:sort-recent", kind: "command", label: "Sort by recent", keywords: "order newest", run: () => setSort("recent") },
    { id: "cmd:sort-relevance", kind: "command", label: "Sort by relevance", keywords: "order score", run: () => setSort("relevance") },
    { id: "cmd:engine", kind: "command", label: down ? "Bring engine up" : "Take engine down", keywords: "outage failure", run: () => setDown((d) => !d) },
    { id: "cmd:restore", kind: "command", label: "Restore deleted rows", keywords: "undelete", run: restoreRows },
  ];

  return {
    repos, source, sourceById, engine, indexOpts, setIndexOpts, setTok, deleted, deleteRow, restoreRows, rebuild, ghosts,
    text, setText, parsed, exec, ms, down, setDown,
    predicate, setPredicate, full, counts, hitRows,
    ranked, sort, setSort, page, pages, setPage, pageRows, pageResets,
    commands,
  };
}

export type FleetSearch = ReturnType<typeof useFleetSearch>;
