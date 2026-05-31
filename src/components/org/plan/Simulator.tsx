"use client";

import { useState } from "react";
import { Card, Meter, SectionHeader } from "@/components/org/ui";
import { scoreHex } from "@/lib/ui";
import type { FleetProjection } from "@/lib/scoring/orgsim";

interface DimOption {
  id: string;
  label: string;
  avg: number;
}
interface RepoOption {
  fullName: string;
  name: string;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** What-if: project the fleet impact of raising a dimension to a target across a repo set. */
export function Simulator({ slug, dims, repos }: { slug: string; dims: DimOption[]; repos: RepoOption[] }) {
  const [dimId, setDimId] = useState(dims[0]?.id ?? "D2");
  const [target, setTarget] = useState(70);
  const [scope, setScope] = useState<Set<string>>(new Set());
  const [showRepos, setShowRepos] = useState(false);
  const [result, setResult] = useState<FleetProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(fullName: string) {
    setScope((s) => {
      const next = new Set(s);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, dimId, target, repos: [...scope] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to simulate.");
      setResult(data.projection);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to simulate.");
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = scope.size === 0 ? "all scanned repos" : `${scope.size} selected`;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="What-if simulator"
        description="Project the fleet impact of landing a fix before you commit the work."
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-slate-500">Raise</span>
        <select value={dimId} onChange={(e) => setDimId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-slate-200">
          {dims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.label} (avg {d.avg})
            </option>
          ))}
        </select>
        <span className="font-mono text-[11px] text-slate-500">to</span>
        <input type="number" min={0} max={100} value={target} onChange={(e) => setTarget(Number(e.target.value))} className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200" />
        <span className="font-mono text-[11px] text-slate-500">across</span>
        <button onClick={() => setShowRepos((s) => !s)} className="rounded-lg border border-slate-700 px-2.5 py-1.5 font-mono text-xs text-slate-300 hover:border-accent hover:text-white">
          {scopeLabel} ▾
        </button>
        <button onClick={run} disabled={busy} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </div>

      {showRepos && (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex gap-3 font-mono text-[11px] text-slate-500">
            <button onClick={() => setScope(new Set())} className="hover:text-white">all</button>
            <button onClick={() => setScope(new Set(repos.map((r) => r.fullName)))} className="hover:text-white">select all</button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {repos.map((r) => (
              <label key={r.fullName} className="flex items-center gap-2 font-mono text-[11px] text-slate-300">
                <input type="checkbox" checked={scope.has(r.fullName)} onChange={() => toggle(r.fullName)} className="accent-accent" />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-xs text-orange-300">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
          <div className="text-sm text-slate-300">
            Applies to <span className="font-mono text-white">{result.affected}</span> repo(s) currently below target
            {result.promotions > 0 && (
              <>
                {" "}· <span className="font-mono text-emerald-300">{result.promotions}</span> would cross up a level
              </>
            )}
            .
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {([
              ["Overall", result.before.avgOverall, result.after.avgOverall, `${result.before.level} → ${result.after.level}`],
              ["Adoption", result.before.avgAdoption, result.after.avgAdoption, ""],
              ["Rigor", result.before.avgRigor, result.after.avgRigor, ""],
            ] as const).map(([label, before, after, note]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: scoreHex(after) }}>{after}</span>
                  <span className="font-mono text-xs text-slate-500">from {before}</span>
                  <span className={`font-mono text-xs ${after - before > 0 ? "text-emerald-300" : after - before < 0 ? "text-orange-300" : "text-slate-600"}`}>
                    {signed(after - before)}
                  </span>
                </div>
                <Meter className="mt-2" size="sm" value={after} color={scoreHex(after)} threshold={before} />
                {note && <div className="mt-1 font-mono text-[11px] text-slate-400">{note}</div>}
              </div>
            ))}
          </div>

          {result.repos.filter((r) => r.delta > 0).length > 0 && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Biggest movers</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {result.repos
                  .filter((r) => r.delta > 0)
                  .slice(0, 12)
                  .map((r) => (
                    <span key={r.fullName} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                      {r.name} <span className="text-emerald-300">{signed(r.delta)}</span>
                      {r.levelUp && <span className="ml-1 text-accent">↑{r.levelAfter}</span>}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
