"use client";

// ONE RUN IN THE CHRONICLE. The row is the summary the list already carries — #seq, when and how long,
// who dispatched it, repos, lanes, verified closes, landings, lift, cost, plan mode. Expanding it reads
// the run's detail ONCE (`GET /api/org/loop/<id>`) and keeps it: collapsing and reopening costs nothing.

import { useState } from "react";
import { fmtDelta } from "@/components/ui";
import type { LoopRunDetail } from "../cockpit/loopTypes";
import { ChronicleLane } from "./ChronicleLane";
import { runBadge, runLabel, type RunBadge } from "./chronicleModel";
import { fetchRunDetail } from "./ledgerClient";
import { fmtAgo, fmtDuration, fmtUsd, plural, shortRepo } from "./ledgerFormat";
import type { LoopPlanRecord, LoopRunChronicleEntry } from "./ledgerTypes";

const BADGE: Record<RunBadge, { text: string; tone: string; title: string }> = {
  runner: { text: "runner", tone: "border-accent/50 text-accent", title: "Dispatched by the standing runner." },
  drive: { text: "drive", tone: "border-divider text-slate-300", title: "Dispatched by a bounded drive." },
  manual: { text: "manual", tone: "border-divider text-slate-500", title: "Started by a person from the Cockpit." },
};

export function ChronicleRow({
  slug,
  run,
  modes,
  plans,
  now,
}: {
  slug: string;
  run: LoopRunChronicleEntry;
  modes: Record<string, "bounded" | "continuous">;
  plans: readonly LoopPlanRecord[];
  now: string;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<LoopRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badge = BADGE[runBadge(run, modes)];
  const duration = fmtDuration(run.startedAt, run.endedAt);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || detail || loading) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchRunDetail(slug, run.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that run.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <li data-testid="chronicle-run" className="px-4 py-3">
      <button type="button" aria-expanded={open} onClick={() => void toggle()} className="focus-ring flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 rounded text-left">
        <span className="font-mono type-body tabular-nums text-slate-100">{runLabel(run)}</span>
        <span className={`rounded border px-1.5 type-micro uppercase tracking-widest ${badge.tone}`} title={badge.title}>
          {badge.text}
        </span>
        {run.planMode === "on" && (
          <span className="rounded border border-divider px-1.5 type-micro uppercase tracking-widest text-slate-400" title="Every lane opened with a read-only planning session.">
            planned
          </span>
        )}
        <span className="type-caption text-slate-500" title={run.startedAt}>
          {fmtAgo(run.startedAt, now)} · {duration ?? (run.phase === "running" || run.phase === "curating" ? "running" : "no end recorded")} · {run.phase}
        </span>
        <span className="min-w-0 truncate type-caption text-slate-400" title={run.repos.join(", ")}>
          {run.repos.map(shortRepo).join(", ")}
        </span>
        <span className="ml-auto flex flex-wrap gap-x-3 type-caption tabular-nums text-slate-400">
          <span>{plural(run.lanes, "lane")}</span>
          <span title="Follow-ups the rescan verified closed, summed over the run's lanes.">{run.verifiedCloses} verified</span>
          <span title="Lanes delivered onto the runner branch.">{run.landedAt.length} landed</span>
          <span title="Attributable overall-score movement; — when no lane had both ends.">{run.lift == null ? "lift —" : `lift ${fmtDelta(run.lift)}`}</span>
          <span>{fmtUsd(run.costMicros)}</span>
        </span>
      </button>
      {run.error && <p className="mt-1 type-caption text-danger">{run.error}</p>}
      {open && (
        <div className="mt-3">
          {loading && <p className="type-caption text-slate-500">Reading the run…</p>}
          {error && (
            <p role="alert" className="type-caption text-danger">
              {error}
            </p>
          )}
          {detail && detail.lanes.length === 0 && <p className="type-caption text-slate-500">This run wrote no lanes.</p>}
          {detail && detail.lanes.length > 0 && (
            <ul className="divide-y divide-divider rounded-xl border border-divider">
              {detail.lanes.map((l) => (
                <ChronicleLane key={l.id} lane={l} plan={plans.find((p) => p.id === l.planId) ?? null} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
