// Shared pieces for the AI-stance section (Governance tab, W3 — the Perimeter made real).
// Server-safe: no hooks, no handlers. Colors/labels here are the single source for every stance
// surface so the checkpoint, the bands, and the repo nodes can't drift apart.

import { Kicker } from "@/components/ui";
import type { StanceAckState } from "@/lib/org/stance";
import type { AutonomyTierId } from "@/lib/types";

/** Tier color runs the same red→green *direction* as the level ramp, inverted: T3 is the tightest. */
export const TIER_HEX: Record<AutonomyTierId, string> = {
  T0: "#22c55e",
  T1: "#84cc16",
  T2: "#f97316",
  T3: "#ef4444",
};

/** Display meta for the four autonomy tier bands — the SHARED resolver's ladder semantics
 *  (passport-autonomy.ts), phrased for the perimeter read. */
export const TIER_META: Record<AutonomyTierId, { name: string; blurb: string }> = {
  T0: { name: "Observe-only", blurb: "Nothing an agent produces should merge unread." },
  T1: { name: "Tests · docs · refactors", blurb: "Checked work an agent's output can be verified against." },
  T2: { name: "Features with review", blurb: "Gated CI and substantial tests back delegated feature work." },
  T3: { name: "Scheduled autonomous", blurb: "Evals, provenance and versioned migrations back unattended runs." },
};

const ACK_HEX: Record<StanceAckState, string> = { current: "#10b981", stale: "#f97316", unacked: "#ef4444" };

export function ackLabel(ack: StanceAckState, ackedVersion: number | null): string {
  if (ack === "current") return `Acknowledged v${ackedVersion}`;
  if (ack === "stale") return `On an older version (v${ackedVersion})`;
  return "Never acknowledged";
}

/** Acknowledgement state — whether the repo has adopted the CURRENT stance version. */
export function AckMark({
  ack,
  ackedVersion,
  showLabel = true,
}: {
  ack: StanceAckState;
  ackedVersion: number | null;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: ACK_HEX[ack] }} title={ackLabel(ack, ackedVersion)}>
      <span aria-hidden className="inline-block size-1.5 rounded-full" style={{ backgroundColor: ACK_HEX[ack] }} />
      {showLabel && <span className="font-mono text-xs uppercase tracking-[0.18em]">{ack}</span>}
    </span>
  );
}

/**
 * The "publish your stance" empty state — the common case (no stance yet), answered first because
 * the research names policy ambiguity as the top blocker. The owner's editor renders directly
 * below this shell; non-owners see who to ask.
 */
export function StancePublishCta({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const bullets = [
    { label: "Checkpoint", text: "Which tools and models may cross into org code at all." },
    { label: "Bands", text: "Review requirements per autonomy tier, fed by each repo's real passport tier." },
    { label: "Sealed", text: "Repos and paths closed to AI authorship entirely." },
    { label: "Proof", text: "What a change must carry to show which side of the line it came from." },
  ];
  return (
    <div className="rounded-2xl border border-divider bg-surface/40 p-8">
      <Kicker>{slug} · perimeter undrawn</Kicker>
      <h3 className="mt-3 max-w-2xl text-2xl font-medium text-white sm:text-3xl">
        There is no line. Every repo is treated the same by every agent.
      </h3>
      <p className="mt-3 max-w-2xl text-base text-slate-300">
        Without a published stance the fleet has one undifferentiated risk surface: a docs PR and a migration get the
        same review, and nothing marks the paths that should never be agent-authored. Draw the perimeter once and every
        repo inherits a band.
      </p>

      <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
        {bullets.map((b) => (
          <div key={b.label} className="bg-ink px-4 py-3.5">
            <Kicker tone="muted">{b.label}</Kicker>
            <p className="mt-1.5 text-sm text-slate-300">{b.text}</p>
          </div>
        ))}
      </div>

      <p className="mt-6 font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
        {canEdit
          ? "Draft the stance below, then publish v1 — repos adopt it as a committed AI_POLICY.md."
          : "An org owner publishes the stance; once live, this section reads the fleet against it."}
      </p>
    </div>
  );
}
