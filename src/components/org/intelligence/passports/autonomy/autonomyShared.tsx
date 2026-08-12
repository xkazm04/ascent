// Shared atoms for the Autonomy Passport variants (P1 prototype). Hoisted the moment a second
// variant needed them, per the prototype skill: tier stamp, gate status glyph, and the provenance
// badge that keeps the derived/mock gates honest on every surface that renders them.
//
// Server-safe: no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { TIER_META, tierHex, type AutonomyTier, type GateSource, type GateStatus } from "./autonomyModel";

/** Provenance badge — the prototype's honesty pin. "scan" renders nothing (the default, trusted). */
export function SourcePin({ source, className = "" }: { source: GateSource; className?: string }) {
  if (source === "scan") return null;
  const label = source === "derived" ? "proxy" : "mock";
  const title =
    source === "derived"
      ? "Proxy signal — assembled from adjacent scan fields, not directly observed."
      : "Not observed by the scan yet — placeholder value for this prototype.";
  return (
    <span
      title={title}
      className={`rounded border border-dashed border-slate-600 px-1 font-mono text-xs uppercase tracking-[0.18em] text-slate-500 ${className}`}
    >
      {label}
    </span>
  );
}

export const STATUS_GLYPH: Record<GateStatus, string> = { pass: "●", partial: "◐", fail: "○" };

/** Gate status dot, colored off the shared score ramp — never a hand-picked hex. */
export function GateDot({ score, status }: { score: number; status: GateStatus }) {
  return (
    <span aria-hidden className="font-mono" style={{ color: scoreHex(score) }}>
      {STATUS_GLYPH[status]}
    </span>
  );
}

/** The four-rung ladder as a compact filled/empty rail — the recurring tier motif, available to any
 *  variant that wants the ladder inline rather than as a stamp. */
export function TierRail({ tier, className = "" }: { tier: AutonomyTier; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`Tier ${tier} of 3, ${TIER_META[tier].label}`}>
      {([0, 1, 2, 3] as AutonomyTier[]).map((t) => (
        <span
          key={t}
          aria-hidden
          className="h-1.5 w-6 rounded-full"
          style={{ backgroundColor: t <= tier ? tierHex(tier) : "#1e293b" }}
        />
      ))}
    </span>
  );
}

/** Section eyebrow + one-line intro used at the top of every variant, so the reframe is stated once. */
export function AutonomyPreamble({ kicker, title, intro }: { kicker: string; title: string; intro: string }) {
  return (
    <div>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-2 text-2xl font-medium text-white">{title}</h2>
      <p className="mt-2 max-w-3xl text-base text-slate-300">{intro}</p>
    </div>
  );
}
