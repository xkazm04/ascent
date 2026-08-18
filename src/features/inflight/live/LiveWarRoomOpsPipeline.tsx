"use client";

// SHIP LOOP — variant "Pipeline". Metaphor: the loop IS an assembly line, so render it as one.
// Layer 1 is a symbolic stage rail — four gauges (triage → in-flight → landed → net impact), each a
// glyph + a big typeset count + a one-line caption — a whole-pipeline read at a glance. Layer 2 is a
// full-width detail tray that opens BELOW the rail for the selected stage, so triage items finally
// get the room the cramped 3-column baseline never gave them. Only one tray open at a time.

import { useState } from "react";
import { Kicker, deltaHex, fmtDelta } from "@/components/ui";
import { FlightRowDetail, LandedRowDetail, TriageDetail, opsImpact, type OpsView } from "@/features/inflight/live/liveWarRoomOpsShared";

type Stage = "triage" | "inFlight" | "landed";

function StageNode({
  glyph,
  glyphClass = "text-slate-500",
  count,
  label,
  caption,
  active,
  onClick,
}: {
  glyph: React.ReactNode;
  glyphClass?: string;
  count: React.ReactNode;
  label: string;
  caption: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition ${
        active ? "border-accent/50 bg-accent/10" : "border-divider bg-surface-strong/30 hover:border-slate-600"
      }`}
    >
      <span className={`shrink-0 text-lg ${glyphClass}`} aria-hidden>
        {glyph}
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-2xl font-bold leading-none tabular-nums text-white">{count}</span>
        <Kicker tone="muted" className="mt-1">
          {label}
        </Kicker>
        <span className="mt-0.5 block truncate text-sm text-slate-500">{caption}</span>
      </span>
    </button>
  );
}

const Arrow = () => (
  <span className="hidden items-center font-mono text-slate-600 lg:flex" aria-hidden>
    →
  </span>
);

export function ShipLoopPipeline({ state, busy, accept, reject, onVerify }: OpsView) {
  const imp = opsImpact(state.landed);
  const firstNonEmpty: Stage = state.counts.triage > 0 ? "triage" : state.counts.inFlight > 0 ? "inFlight" : "landed";
  const [open, setOpen] = useState<Stage>(firstNonEmpty);
  const toggle = (s: Stage) => setOpen((cur) => (cur === s ? cur : s)); // rail is a selector, always one open

  return (
    <div>
      {/* Layer 1 — the symbolic stage rail */}
      <div className="flex flex-col gap-2 p-4 lg:flex-row lg:items-stretch">
        <StageNode
          glyph="◇"
          count={state.counts.triage}
          label="Triage"
          caption="directions to decide"
          active={open === "triage"}
          onClick={() => toggle("triage")}
        />
        <Arrow />
        <StageNode
          glyph={state.counts.inFlight > 0 ? <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-red-500" /> : "○"}
          glyphClass={state.counts.inFlight > 0 ? "" : "text-slate-600"}
          count={state.counts.inFlight}
          label="In flight"
          caption="PRs watched for merge"
          active={open === "inFlight"}
          onClick={() => toggle("inFlight")}
        />
        <Arrow />
        <StageNode
          glyph="⇂"
          glyphClass={imp.merged > 0 ? "text-emerald-400" : "text-slate-600"}
          count={state.counts.landed}
          label="Landed"
          caption={imp.awaiting > 0 ? `${imp.awaiting} awaiting rescan` : "merged & measured"}
          active={open === "landed"}
          onClick={() => toggle("landed")}
        />
        <Arrow />
        {/* Terminal readout: the loop's cumulative achievement — not a drill-in, a takeaway. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-divider bg-surface-strong/30 px-3 py-2.5">
          <span className="shrink-0 text-lg text-slate-500" aria-hidden>
            Σ
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-2xl font-bold leading-none tabular-nums" style={{ color: deltaHex(imp.netOverall) }}>
              {fmtDelta(imp.netOverall)}
            </span>
            <Kicker tone="muted" className="mt-1">
              Net impact
            </Kicker>
            <span className="mt-0.5 block truncate text-sm text-slate-500">
              {imp.verified} verified · {imp.dimsLifted} dims lifted
            </span>
          </span>
        </div>
      </div>

      {/* Layer 2 — the detail tray for the selected stage */}
      <div className="border-t border-divider p-4">
        {open === "triage" && (
          <>
            <Kicker className="mb-2.5">Triage · {state.counts.triage} directions</Kicker>
            {state.triage.length === 0 ? (
              <p className="text-base text-slate-500">Radar clear, no open directions to triage.</p>
            ) : (
              <div className="grid max-h-[24rem] grid-cols-1 gap-2.5 overflow-y-auto xl:grid-cols-2">
                {state.triage.map((t) => (
                  <TriageDetail
                    key={t.recommendationId}
                    item={t}
                    busy={busy[t.recommendationId]}
                    onAccept={() => accept(t.recommendationId)}
                    onReject={() => reject(t.recommendationId)}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {open === "inFlight" && (
          <>
            <Kicker className="mb-2.5">In flight · {state.counts.inFlight} PRs</Kicker>
            {state.inFlight.length === 0 ? (
              <p className="text-base text-slate-500">No PRs in flight. Accept a direction to open one.</p>
            ) : (
              <div className="max-h-[24rem] space-y-2 overflow-y-auto">
                {state.inFlight.map((p) => (
                  <FlightRowDetail key={p.id} item={p} />
                ))}
              </div>
            )}
          </>
        )}
        {open === "landed" && (
          <>
            <Kicker className="mb-2.5">Landed · {state.counts.landed} PRs</Kicker>
            {state.landed.length === 0 ? (
              <p className="text-base text-slate-500">Merged PRs land here with their measured score impact.</p>
            ) : (
              <div className="max-h-[24rem] space-y-2 overflow-y-auto">
                {state.landed.map((p) => (
                  <LandedRowDetail key={p.id} item={p} onVerify={p.state === "merged" ? () => onVerify([p.repoFullName]) : undefined} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
