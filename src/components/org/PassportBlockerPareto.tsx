"use client";

// Fleet blocker pareto (P3) — the passports' blocker strings aggregated across the repos in view and
// ranked by how many repos each one blocks: "fix this once, move N repos". Blockers are deterministic
// canonical strings from buildPassport, so exact-match counting is sound; the one variable string (the
// self-verify missing-scripts list) is normalized into a single bucket. Recomputed from whatever rows
// the active cohort filter leaves visible, so it always answers "what should THIS cohort fix first".

import { Meter } from "@/components/org/ui";
import type { PassportRow } from "@/components/org/PassportTable";

interface Agg {
  label: string;
  axis: "automation" | "production";
  repos: string[];
}

const SELF_VERIFY_BUCKET = "Agent can't self-verify (missing build/test/lint/typecheck scripts).";

function aggregate(rows: PassportRow[]): Agg[] {
  const byLabel = new Map<string, Agg>();
  const add = (label: string, axis: Agg["axis"], repo: string) => {
    const key = label.startsWith("Agent can't self-verify") ? SELF_VERIFY_BUCKET : label;
    const agg = byLabel.get(key) ?? { label: key, axis, repos: [] };
    agg.repos.push(repo);
    byLabel.set(key, agg);
  };
  for (const r of rows) {
    for (const b of r.detail.autoBlockers) add(b, "automation", r.name);
    for (const b of r.detail.prodBlockers) add(b, "production", r.name);
  }
  return [...byLabel.values()].sort((a, b) => b.repos.length - a.repos.length);
}

const AXIS_TONE: Record<Agg["axis"], { label: string; color: string }> = {
  automation: { label: "auto", color: "#3b9eff" },
  production: { label: "prod", color: "#d97706" },
};

export function PassportBlockerPareto({ rows, scopeLabel, max = 6 }: { rows: PassportRow[]; scopeLabel: string; max?: number }) {
  const top = aggregate(rows).slice(0, max);
  if (top.length === 0) return null;
  return (
    <div className="rounded-2xl border border-divider bg-surface/40 p-4">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">Top blockers · {scopeLabel}</div>
      <p className="mt-1 text-sm text-slate-500">The fixes that move the most repos in view.</p>
      <div className="mt-3 space-y-2.5">
        {top.map((a) => {
          const tone = AXIS_TONE[a.axis];
          return (
            <div key={a.label} title={`Blocked: ${a.repos.slice(0, 12).join(", ")}${a.repos.length > 12 ? ` +${a.repos.length - 12} more` : ""}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 text-slate-300">
                  <span className="mr-1.5 rounded border px-1 font-mono text-xs" style={{ color: tone.color, borderColor: `${tone.color}55` }}>
                    {tone.label}
                  </span>
                  {a.label}
                </span>
                <span className="shrink-0 font-mono text-sm tabular-nums text-slate-400">
                  {a.repos.length}<span className="text-slate-600">/{rows.length}</span>
                </span>
              </div>
              <Meter className="mt-1" size="sm" value={(a.repos.length / Math.max(1, rows.length)) * 100} color={tone.color} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
