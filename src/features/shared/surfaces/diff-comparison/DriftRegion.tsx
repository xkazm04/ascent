"use client";

// drift-against-declared: the left side is a promise with an author and a version. Findings are
// directional (undeclared / unfulfilled / deviating), carry tolerances, have an identity stable across
// runs so re-running updates instead of duplicating, and fork into two verbs — fix reality, or amend
// the promise (attributed, logged before/after, never automatic). Coverage is stated; unevaluated is
// never passing.

import { useMemo, useState } from "react";
import { CONTRACT_V3, DRIFT_KINDS, evaluateDrift, type Contract, type DriftFinding, type Observation, OBSERVED } from "./contract";
import { REPO } from "./fixtures";
import { BTN, Readout, Region, TD, TH } from "./parts";

type Standing = { firstRun: number; observations: number; resolved: null | "reality fixed" | "promise amended" | "no longer observed" };
type Amendment = { clauseId: string; before: string | null; after: string | null; version: number };

const OPEN = new Set(["undeclared", "unfulfilled", "deviating"]);

export function DriftRegion() {
  const [contract, setContract] = useState<Contract>(CONTRACT_V3);
  const [observed, setObserved] = useState<Observation[]>(OBSERVED);
  const [run, setRun] = useState(1);
  const [standing, setStanding] = useState<Record<string, Standing>>({});
  const [log, setLog] = useState<Amendment[]>([]);

  const findings = useMemo(() => evaluateDrift(contract, observed, REPO), [contract, observed]);
  // The standing ledger is derived from the SAME identity on every run: (clause, entity).
  const ledger = useMemo(() => {
    const next: Record<string, Standing> = { ...standing };
    for (const f of findings) {
      const open = OPEN.has(f.kind);
      const prev = next[f.id];
      if (open) next[f.id] = prev ? { ...prev, observations: prev.resolved ? prev.observations : run - prev.firstRun + 1 } : { firstRun: run, observations: 1, resolved: null };
      else if (prev && !prev.resolved) next[f.id] = { ...prev, resolved: "no longer observed" };
    }
    return next;
  }, [findings, run, standing]);

  // Coverage: clauses checked over clauses declared. An undeclared finding is not a clause; an
  // unevaluated clause is declared and unchecked — it counts against coverage, never as passing.
  const checkable = contract.clauses.filter((c) => c.kind !== "unchecked");
  const declared = checkable.length;
  const evaluated = checkable.filter((c) => findings.find((f) => f.clauseId === c.id)?.kind !== "unevaluated").length;
  const openCount = findings.filter((f) => OPEN.has(f.kind) && !ledger[f.id]?.resolved).length;

  const fixReality = (f: DriftFinding) => {
    setStanding({ ...ledger, [f.id]: { ...(ledger[f.id] ?? { firstRun: run, observations: 1 }), resolved: "reality fixed" } });
    setObserved((o) => (f.kind === "undeclared" ? o.filter((x) => x.clauseId !== f.clauseId) : o.map((x) => (x.clauseId === f.clauseId ? { ...x, value: f.declared, evaluable: true } : x))));
  };
  const amendPromise = (f: DriftFinding) => {
    const version = contract.version + 1;
    setLog((l) => [...l, { clauseId: f.clauseId, before: f.declared, after: f.actual, version }]);
    setStanding({ ...ledger, [f.id]: { ...(ledger[f.id] ?? { firstRun: run, observations: 1 }), resolved: "promise amended" } });
    setContract((c) => ({
      ...c,
      version,
      clauses: f.kind === "undeclared" ? [...c.clauses, { id: f.clauseId, label: f.clauseId, kind: "exists", declared: "present" }] : c.clauses.map((cl) => (cl.id === f.clauseId ? { ...cl, declared: f.actual ?? cl.declared } : cl)),
    }));
  };

  return (
    <Region technique="drift-against-declared" title="Drift against declared" note="Not what changed — where reality departs from the promise. Fix reality, or amend the promise; the second verb is governed.">
      <div className="space-y-3">
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="declaration" value={`${contract.name} v${contract.version} · ${contract.author}`} />
          <Readout label="entity" value={REPO} />
          <Readout label="coverage" value={`${evaluated} of ${declared} clauses evaluated · ${declared - evaluated} unevaluated (not passing)`} tone={evaluated < declared ? "text-warn" : "text-slate-200"} />
          <Readout label="open findings" value={`${openCount} · run #${run}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full type-caption" data-findings={findings.length}>
            <thead className="type-label tracking-[0.2em] text-slate-500">
              <tr><th className={TH}>kind</th><th className={TH}>clause</th><th className={TH}>declared</th><th className={TH}>actual</th><th className={TH}>standing</th><th className={TH}>verb</th></tr>
            </thead>
            <tbody>
              {findings.map((f) => {
                const k = DRIFT_KINDS[f.kind];
                const st = ledger[f.id];
                return (
                  <tr key={f.id} data-finding={f.id} data-drift={f.kind} data-resolved={st?.resolved ?? ""}>
                    <td className={`${TD} font-mono ${k.tone}`}><span aria-hidden>{k.glyph} </span>{f.kind}</td>
                    <td className={`${TD} text-slate-300`}>{f.label}<span className="block type-micro text-slate-500">{f.detail}</span></td>
                    <td className={`${TD} font-mono text-slate-400`}>{f.declared ?? "∅"}</td>
                    <td className={`${TD} font-mono text-slate-400`}>{f.actual ?? "∅"}</td>
                    <td className={`${TD} text-slate-500`}>{st ? (st.resolved ? `resolved: ${st.resolved}` : `first run #${st.firstRun} · seen ${st.observations}×`) : k.verb}</td>
                    <td className={TD}>
                      {OPEN.has(f.kind) && !st?.resolved ? (
                        <span className="flex gap-1">
                          <button type="button" className={BTN} onClick={() => fixReality(f)} aria-label={`Fix reality for ${f.label}`}>fix reality</button>
                          <button type="button" className={BTN} onClick={() => amendPromise(f)} aria-label={`Amend the promise for ${f.label}`}>amend promise</button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={() => { setStanding(ledger); setRun((r) => r + 1); }} aria-label="Re-run the drift check">re-run the check</button>
          <span className="type-caption text-slate-500">a re-run updates standing findings; it never mints a duplicate.</span>
        </div>
        {log.length > 0 ? (
          <ul className="space-y-0.5" data-amendments={log.length}>
            {log.map((a, i) => (
              <li key={i} className="type-caption text-slate-400">v{a.version} · <span className="text-slate-300">{a.clauseId}</span>: {a.before ?? "∅"} → {a.after ?? "∅"} · by you, in response to the finding</li>
            ))}
          </ul>
        ) : null}
      </div>
    </Region>
  );
}
