"use client";

// scale-and-axis-design: four sibling panels of the same metric, drawn under a chosen policy. The
// projection takes its domain as a required input, so the sample-anchored floor is a policy the
// chips can name — and the panel readout says which panel would fill its box on sub-noise wiggle.
// The partial trailing bucket is dashed + hollow in every policy and never sets the ceiling. The
// axis carries its predicate where the eye is; the scale answers "why this scale" in words.

import { useState } from "react";
import { SCALE_POLICIES, domainFor, seriesColor, type ScalePolicy } from "./chartMath";
import type { Repo } from "./fixtures";
import { MiniLine } from "./MiniLine";
import { AxisPredicate, Chips, Readout, Region } from "./sceneParts";

const PANELS = 4;

export function ScaleRegion({ repos, reduced }: { repos: readonly Repo[]; reduced: boolean }) {
  const [policy, setPolicy] = useState<ScalePolicy>("shared");
  const shown = repos.filter((r) => r.shape !== "new" && r.shape !== "gap").slice(0, PANELS);
  const why = SCALE_POLICIES.find((p) => p.id === policy)!.why;
  const flat = shown.find((r) => r.shape === "steady");
  const flatDomain = flat ? domainFor(policy, flat.score) : null;

  return (
    <Region technique="scale-and-axis-design" title="Siblings share a scale" note="Will the reader compare this panel with anything else? Here, yes — so the set declares one domain. Pick the defect and watch the flat series climb.">
      <Chips label="Scale policy" value={policy} options={SCALE_POLICIES} onPick={setPolicy} />
      <div className="mt-3 grid gap-2 sm:grid-cols-2" data-scale-policy={policy}>
        {shown.map((r) => {
          const domain = domainFor(policy, r.score);
          return (
            <div key={r.id} className="rounded-lg border border-divider p-2" data-panel={r.id} data-domain={`${domain[0]}-${domain[1]}`}>
              <div className="flex items-baseline justify-between">
                <span className="type-caption text-slate-300">{r.name}</span>
                <span className="type-caption text-slate-600">
                  {r.shape} · y {domain[0]}–{domain[1]}
                </span>
              </div>
              <MiniLine series={r.score} domain={domain} color={seriesColor(r.id)} reduced={reduced} chrome h={72} w={220} pad={10} ariaLabel={`${r.name} overall score, daily, 14 days, domain ${domain[0]} to ${domain[1]}`} />
            </div>
          );
        })}
      </div>
      <AxisPredicate>overall score (0–100), daily average, trailing 14d, UTC midnight buckets · dashed = today so far</AxisPredicate>
      <div className="mt-3 space-y-1">
        <Readout label="why this scale" value={<span className="whitespace-normal text-right">{why}</span>} />
        {flat && flatDomain ? (
          <Readout
            label={`${flat.name} (steady)`}
            value={<span data-flat-span={flatDomain[1] - flatDomain[0]}>{flatDomain[1] - flatDomain[0]} points fill the box</span>}
            tone={policy === "sample-floor" ? "text-danger" : "text-slate-200"}
          />
        ) : null}
      </div>
    </Region>
  );
}
