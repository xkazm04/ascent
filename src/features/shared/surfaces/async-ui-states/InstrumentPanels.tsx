"use client";

// The three instruments that read the repository search's machinery:
// state-model — the four inputs, the derived state, the request tokens (latest-wins) and the edges the
//   derivation makes unreachable;
// windowing-vs-identifying-keys — the key classified once, the last change's axis, and what each of the
//   five consumers did about it;
// arrival-choreography — which edge last applied, the seen-set, and what is entering this render.
// No hooks of their own: everything is derived from the `RepoSearch` value the owner passes down.

import { CASCADE, CONSUMERS, FORBIDDEN_EDGES, KEY_CLASS, consumerOutcome, type KeyName } from "./asyncState";
import { BTN, Readout, Region, StateChip } from "./sceneParts";
import { windowKey, type RepoSearch } from "./useRepoSearch";

export function LedgerRegion({ s }: { s: RepoSearch }) {
  const i = s.region.inputs(s.superseded);
  const state = s.region.state(s.superseded);
  const yes = (b: boolean) => (b ? "true" : "false");
  return (
    <Region technique="state-model" title="Derived, never hand-maintained" note="Four inputs from the request machinery, one ordering. Presence of content wins; empty needs the sticky bit.">
      <div className="space-y-1" data-ledger>
        <Readout label="inFlight" value={<span data-in-flight={i.inFlight}>{yes(i.inFlight)}</span>} />
        <Readout label="held" value={i.held} />
        <Readout label="settled (sticky)" value={<span data-settled={i.settled}>{yes(i.settled)}</span>} tone={i.settled ? "text-success-soft" : "text-slate-500"} />
        <Readout label="error" value={i.error ?? "null"} tone={i.error ? "text-danger" : "text-slate-500"} />
        <Readout label="superseded" value={yes(i.superseded)} tone={i.superseded ? "text-warn" : "text-slate-500"} />
        <Readout label="→ state" value={<StateChip state={state} />} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={s.refresh}>
          refresh
        </button>
        <button type="button" className={BTN} onClick={s.race}>
          race: slow then fast
        </button>
        <span className="type-caption tabular-nums text-slate-500" data-dropped={s.region.dropped}>
          issued #{s.region.issued} · applied #{s.region.applied} · dropped {s.region.dropped}
        </span>
      </div>
      <p className="mt-2 type-caption text-slate-500">A refresh over held rows stays settled-data (an ambient chip, never a ghost). The race issues #n slow then #n+1 fast: the stale one lands later and is dropped by its token.</p>
      <details className="mt-2">
        <summary className="cursor-pointer type-caption text-slate-500">forbidden edges (unreachable by the ordering)</summary>
        <ul className="mt-1 space-y-0.5">
          {FORBIDDEN_EDGES.map((e) => (
            <li key={e} className="type-caption text-slate-600">
              {e}
            </li>
          ))}
        </ul>
      </details>
    </Region>
  );
}

export function KeysRegion({ s }: { s: RepoSearch }) {
  const live = windowKey(s.page, s.sort);
  const values: Record<KeyName, string> = { term: s.term || "∅", page: String(s.page), sort: s.sort };
  const axis = s.change?.axis ?? null;
  return (
    <Region technique="windowing-vs-identifying-keys" title="Classify the key once" note="Is what is on screen a truthful-but-incomplete answer to the new question, or a false one?">
      <table className="w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">coordinate</th>
            <th className="font-normal">class</th>
            <th className="font-normal">live</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(KEY_CLASS) as KeyName[]).map((k) => (
            <tr key={k} className="border-t border-divider text-slate-300" data-key={k} data-axis={KEY_CLASS[k]}>
              <td className="py-1">{k}</td>
              <td className={`py-1 ${KEY_CLASS[k] === "identifying" ? "text-accent-soft" : "text-slate-400"}`}>{KEY_CLASS[k]}</td>
              <td className="py-1 font-mono tabular-nums">{values[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 space-y-1">
        <Readout label="content answers" value={<span data-applied-key>{s.region.appliedKey || "—"}</span>} />
        <Readout label="live window" value={live} tone={s.superseded ? "text-warn" : "text-slate-200"} />
        <Readout label="last change" value={s.change ? <span data-change-axis={axis ?? "none"}>{`${s.change.key}: ${s.change.from} → ${s.change.to}`}</span> : "—"} />
      </div>
      <ul className="mt-3 space-y-0.5" data-consumers>
        {CONSUMERS.map((c) => (
          <li key={c} className="flex items-baseline justify-between gap-3 type-caption">
            <span className="text-slate-500">{c}</span>
            <span className={axis ? "text-slate-300" : "text-slate-600"}>{axis ? consumerOutcome(c, axis) : "untouched (same key)"}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={s.page >= s.pages} onClick={() => s.turnPage(s.page + 1)}>
          turn page (windowing)
        </button>
        <button type="button" className={BTN} onClick={() => s.search(s.term === "ke" ? "al" : "ke")}>
          new search (identifying)
        </button>
        <span className="type-caption tabular-nums text-slate-500">scroll resets: {s.scrollResets}</span>
      </div>
    </Region>
  );
}

export function ArrivalRegion({ s, reduced }: { s: RepoSearch; reduced: boolean }) {
  const arrival = s.region.appliedTag === "arrival";
  const entering = s.region.content.filter((r) => arrival && !reduced && !s.seen.has(r.id)).length;
  const edge = s.region.appliedTag === "arrival" ? "loading → settled-data (cascade)" : s.region.appliedTag === "window" ? "window turn (no cascade)" : s.region.appliedTag === "refresh" ? "refresh (no cascade)" : "—";
  return (
    <Region technique="arrival-choreography" title="Played once, on one edge" note="The cascade is coupled to first arrival and guarded by identity at surface scope; a poll, a resort, a page turn animate nothing.">
      <div className="space-y-1">
        <Readout label="last edge" value={<span data-edge={s.region.appliedTag || "none"}>{edge}</span>} />
        <Readout label="entering this render" value={<span data-entering-count={entering}>{entering}</span>} />
        <Readout label="seen / held" value={`${s.seen.size} / ${s.region.content.length}`} />
        <Readout label="cascade" value={`${CASCADE.stepMs}ms step · ${CASCADE.itemMs}ms item · first ${CASCADE.countCap}`} />
        <Readout label="reduced" value={reduced ? "settled on the first frame" : "off"} tone={reduced ? "text-warn" : "text-slate-500"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={s.refresh}>
          poll
        </button>
        <button type="button" className={BTN} onClick={() => s.resort(s.sort === "name" ? "score" : "name")}>
          resort
        </button>
        <button type="button" className={BTN} onClick={() => s.search(s.term === "al" ? "" : "al")}>
          new search
        </button>
      </div>
      <p className="mt-2 type-caption text-slate-500">The seen-set is reset by the identifying change only; the reduced path is the “already seen” branch, not a parallel implementation.</p>
    </Region>
  );
}
