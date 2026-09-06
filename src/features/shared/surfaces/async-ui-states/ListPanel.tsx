"use client";

// placeholder-design: the repository search — permanent chrome (title, search, sort, pager, network
// dial) above a content region that runs the state model. Loading with nothing held renders
// geometry-matched ghost rows, invisible for their first 150ms so a warm response never flashes them;
// held content is never covered (a refresh is an ambient chip, a window turn is a dim); the no-match
// empty is reachable only after the region settles. Rows enter with the arrival cascade on the
// loading → settled-data edge only, guarded by the surface-scoped seen-set (arrival-choreography).

import { useEffect } from "react";
import { LATENCY, riseAnimation, type Latency } from "./asyncState";
import { PAGE_SIZE, TERMS } from "./fixtures";
import { BTN, BTN_ON, GhostRows, ROW, Region, StateChip } from "./sceneParts";
import type { RepoSearch } from "./useRepoSearch";

export function ListRegion({ s, reduced, latency, setLatency }: { s: RepoSearch; reduced: boolean; latency: Latency; setLatency: (l: Latency) => void }) {
  const { region, seen } = s;
  const state = region.state(s.superseded);
  const rows = region.content;
  // The cascade plays on ONE edge: first arrival. Reduced motion takes the same branch as "already seen".
  const arrival = region.appliedTag === "arrival";
  const { has, mark } = seen;
  const entering = rows.map((r) => arrival && !reduced && !has(r.id));
  // Rows that appear settled (a window turn, a refresh, the reduced path) are marked on commit; an
  // entering row writes the set itself when its entrance completes (one delegated listener below).
  useEffect(() => {
    const ids = rows.filter((r) => !(arrival && !reduced && !has(r.id))).map((r) => r.id);
    if (ids.length) mark(ids);
  }, [rows, arrival, reduced, has, mark]);
  const { listEl, setListEl } = s;
  useEffect(() => {
    const el = listEl;
    if (!el) return;
    const onEnd = (e: Event) => {
      const id = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
      if (id) mark([id]);
    };
    el.addEventListener("animationend", onEnd);
    return () => el.removeEventListener("animationend", onEnd);
  }, [mark, listEl]);

  return (
    <Region technique="placeholder-design" title="Repositories" note="Chrome renders now and never leaves. Only the rows have a state — and the ghost shows in exactly one of them.">
      {/* ── chrome: derived from the query, not the data ── */}
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <span className="type-caption text-slate-500">search</span>
        {TERMS.map((t) => (
          <button key={t || "all"} type="button" className={s.term === t ? BTN_ON : BTN} aria-pressed={s.term === t} onClick={() => s.search(t)}>
            {t ? `“${t}”` : "all"}
          </button>
        ))}
        <span className="ml-2 type-caption text-slate-500">sort</span>
        {(["name", "score"] as const).map((k) => (
          <button key={k} type="button" className={s.sort === k ? BTN_ON : BTN} aria-pressed={s.sort === k} onClick={() => s.resort(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className={BTN} disabled={s.page <= 1} onClick={() => s.turnPage(s.page - 1)} aria-label="Previous page">
            ‹ prev
          </button>
          <span className="type-caption tabular-nums text-slate-400" data-page={s.page}>
            page {s.page} / {s.pages}
          </span>
          <button type="button" className={BTN} disabled={s.page >= s.pages} onClick={() => s.turnPage(s.page + 1)} aria-label="Next page">
            next ›
          </button>
          <span className="type-caption text-slate-500">
            · {s.total.toLocaleString()} matching {s.term ? `“${s.term}”` : "everything"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="type-caption text-slate-500">network</span>
          {(Object.keys(LATENCY) as Latency[]).filter((k) => k !== "race").map((k) => (
            <button key={k} type="button" className={latency === k ? BTN_ON : BTN} aria-pressed={latency === k} onClick={() => setLatency(k)}>
              {k} {LATENCY[k]}ms
            </button>
          ))}
          <StateChip state={state} />
        </div>
      </div>

      {/* ── content: the only part with a state ── */}
      <div className={`mt-3 min-h-[11.75rem] transition-opacity duration-300 ${s.superseded ? "opacity-50" : ""}`} data-content={state} data-superseded={s.superseded} aria-busy={region.inFlight}>
        {state === "loading" ? (
          <GhostRows count={PAGE_SIZE} reduced={reduced} rowClass={ROW} />
        ) : state === "settled-empty" ? (
          <p className="type-caption text-slate-400" data-empty="no-match">
            No repositories match “{s.term}” — the search excludes all of them; nothing is gone.{" "}
            <button type="button" className="focus-ring rounded text-slate-200 underline-offset-2 hover:underline" onClick={() => s.search("")}>
              Clear search
            </button>
          </p>
        ) : (
          <ul ref={setListEl} className="space-y-1" data-rows>
            {rows.map((r, i) => (
              <li key={r.id} data-id={r.id} data-entering={entering[i]} className={ROW} style={{ animation: entering[i] ? riseAnimation(i) : "none" }}>
                <span className="type-caption text-slate-300">{r.label}</span>
                <span className="type-mono-sm tabular-nums text-slate-400">
                  L{r.level} · {r.score}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-2 type-caption text-slate-500">
        Warm loads land inside the ghost’s 150ms window and paint no placeholder. The ghost is `aria-hidden`; the region carries `aria-busy`.
      </p>
    </Region>
  );
}
