// Shared pieces across the three AI-stance variants — hoisted the moment the second variant needed
// them (prototype rule: don't wait for consolidation). Server-safe: no hooks, no handlers.

import { Kicker } from "@/components/ui";
import { Meter } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import { ACK_LABEL, TIER_HEX, type RepoStanceCompliance, type StanceAck, type StanceTierId } from "./stanceMock";

/**
 * The "publish your stance" primary CTA — the state every variant must answer first, since an org
 * with no published stance is the common case and the research says ambiguity is the top blocker.
 * The shell is shared; each variant supplies its own metaphor-consistent copy.
 */
export function StancePublishCta({
  kicker,
  title,
  body,
  cta,
  bullets,
}: {
  kicker: string;
  title: string;
  body: string;
  cta: string;
  bullets: { label: string; text: string }[];
}) {
  return (
    <div className="rounded-2xl border border-divider bg-surface/40 p-8">
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-3 max-w-2xl text-2xl font-medium text-white sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-2xl text-base text-slate-300">{body}</p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
        {bullets.map((b) => (
          <div key={b.label} className="bg-ink px-4 py-3.5">
            <Kicker tone="muted">{b.label}</Kicker>
            <p className="mt-1.5 text-sm text-slate-300">{b.text}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button className="focus-ring rounded-md border border-accent/50 bg-accent/10 px-4 py-2 text-base font-medium text-white transition hover:bg-accent/20">
          {cta}
        </button>
        <button className="focus-ring rounded-md border border-slate-700 px-4 py-2 text-base text-slate-300 transition hover:border-accent hover:text-white">
          Start from the reference stance
        </button>
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">Opens a PR to .github/AI-STANCE.md</span>
      </div>
    </div>
  );
}

/** Tier chip — T0 open → T3 restricted, on the tightening ramp. */
export function TierBadge({ tier, className = "" }: { tier: StanceTierId; className?: string }) {
  const hex = TIER_HEX[tier];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-xs tracking-widest ${className}`}
      style={{ color: hex, borderColor: `${hex}55`, backgroundColor: `${hex}12` }}
    >
      {tier}
    </span>
  );
}

const ACK_HEX: Record<StanceAck, string> = { current: "#10b981", stale: "#f97316", unacked: "#ef4444" };

/** Acknowledgement state — whether the repo has adopted the CURRENT stance version. */
export function AckMark({ ack, showLabel = true }: { ack: StanceAck; showLabel?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: ACK_HEX[ack] }} title={ACK_LABEL[ack]}>
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ backgroundColor: ACK_HEX[ack] }} />
      {showLabel && <span className="font-mono text-xs uppercase tracking-[0.18em]">{ack}</span>}
    </span>
  );
}

/** Compliance readout: a scored meter (uses the real score ramp — compliance IS a 0-100 score). */
export function ComplianceBar({ repo, width = "w-28" }: { repo: RepoStanceCompliance; width?: string }) {
  return (
    <span className="flex items-center gap-2">
      <Meter className={width} size="sm" value={repo.compliance} color={scoreHex(repo.compliance)} ariaLabel={`${repo.fullName} stance compliance`} />
      <span className="w-9 font-mono text-sm tabular-nums" style={{ color: scoreHex(repo.compliance) }}>
        {repo.compliance}
      </span>
    </span>
  );
}

/** One-line plain-language takeaway for a repo's compliance — the "why it matters" the skill demands. */
export function complianceVerdict(r: RepoStanceCompliance): string {
  if (r.ack === "unacked") return `Never acknowledged the stance · ${r.violations} open violation${r.violations === 1 ? "" : "s"}`;
  if (r.violations > 0) return `${r.violations} change${r.violations === 1 ? "" : "s"} authored inside a no-AI zone`;
  if (r.provenance < 80) return `Provenance at ${r.provenance}% — trailers missing on AI-assisted commits`;
  if (r.ack === "stale") return `Still on ${r.ackVersion} — has not adopted the current review tiers`;
  return "Clear on every stance condition";
}
