"use client";

import { signedDelta as signed } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { SavedScenario } from "@/components/org/plan/Simulator.types";

/** SIM-5: saved scenarios + a 2-up compare (client-only scratchpad). */
export function SavedScenarios({
  saved,
  compare,
  comparing,
  onToggleCompare,
  onRemove,
}: {
  saved: SavedScenario[];
  compare: number[];
  comparing: SavedScenario[];
  onToggleCompare: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
        Saved scenarios <span className="text-slate-600">· tick two to compare</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {saved.map((s) => (
          <label key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-1.5 font-mono text-sm">
            <input type="checkbox" checked={compare.includes(s.id)} onChange={() => onToggleCompare(s.id)} className="accent-accent" />
            <span className="min-w-0 flex-1 truncate text-slate-200">
              {s.label} <span className="text-slate-500">· {s.scope}</span>
            </span>
            <span className="shrink-0 text-slate-500">
              overall <span style={{ color: scoreHex(s.after.avgOverall) }}>{s.after.avgOverall}</span>{" "}
              <span className="text-emerald-300">{signed(s.after.avgOverall - s.before.avgOverall)}</span>
              {s.promotions > 0 && <span className="text-accent"> · {s.promotions}↑</span>}
            </span>
            <button onClick={() => onRemove(s.id)} className="text-slate-600 hover:text-orange-300" title="Remove">
              ×
            </button>
          </label>
        ))}
      </div>

      {comparing.length === 2 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {comparing.map((s) => (
            <div key={s.id} className="rounded-xl border border-slate-800 bg-slate-950/30 p-3">
              <div className="truncate font-mono text-sm text-white">
                {s.label} <span className="text-slate-500">· {s.scope}</span>
              </div>
              <div className="mt-1 font-mono text-sm text-slate-400">{s.affected} repo(s) moved · {s.promotions} promoted</div>
              <div className="mt-2 space-y-1">
                {([
                  ["Overall", s.before.avgOverall, s.after.avgOverall],
                  ["Adoption", s.before.avgAdoption, s.after.avgAdoption],
                  ["Rigor", s.before.avgRigor, s.after.avgRigor],
                ] as const).map(([label, b, a]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2 font-mono text-sm">
                    <span className="text-slate-500">{label}</span>
                    <span>
                      <span style={{ color: scoreHex(a) }}>{a}</span>{" "}
                      <span className="text-slate-600">from {b}</span>{" "}
                      <span className={a - b > 0 ? "text-emerald-300" : "text-slate-600"}>{signed(a - b)}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
