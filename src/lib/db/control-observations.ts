// The control-observation ledger's WRITE side (moonshot #10, lane W3-L).
//
// ── The row contract, frozen here because #1 (W3-M) builds its whole read side on it ─────────────
//
//  1. ONE ROW PER (repo, control) CHANGE. A control that is still exactly as it was writes nothing:
//     an append-per-observation ledger on a 900-repo fleet probed hourly is ~250k rows a day of
//     "still on", which buries the handful of rows that mean something.
//  2. PLUS ONE HEARTBEAT ROW per (repo, control) per `heartbeatAfterMs` (24h). Without it, "no row"
//     is ambiguous between "unchanged" and "we stopped looking", and a compliance reader cannot
//     prove a control held through a window. The heartbeat is what makes silence readable.
//  3. `transition = true` IS THE ALERTABLE FLAG. It is set iff the observed (state, value) differs
//     from the previous observation AND there WAS a previous one. A first observation is a BASELINE,
//     not a change — nothing transitioned, we merely started looking — so it lands with
//     `transition: false`. Alerting on it would fire 13 "changes" the moment a repo is first probed.
//     A heartbeat row is likewise never a transition.
//  4. `state ∈ pass | fail | unmeasurable`, and UNMEASURABLE NEVER MEANS FAIL. A denied or absent
//     read (403/404 on the protection-bearing call, no token) is recorded as `unmeasurable` with a
//     null value. This is the same discipline `fetchBranchGovernance` already enforces by returning
//     null rather than `protected: false` — inventing a "fail" from an unreadable control would
//     report a repo that genuinely enforces protection as wide open.
//  5. `evidenceJson` IS THE CITABLE SLICE — the rule types, the branch, the actor login. It is what
//     a conformance pack quotes, so it is written at observation time and never re-derived.
//
// Value changes count as changes (3): a repo flipping public → private, or its required approvals
// going 2 → 1, is a governance event even though the control stays "pass". `prevValue` exists in the
// schema for exactly that, and the transition flag follows the pair, not the state alone.
//
// W3-M EXTENDS this file with the reader/seal quartet (`controlStateAt`, `listControlTimeline`,
// `controlCoverage`, `sealDay`, `verifySeals`) and must not edit the three functions below.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

/** The reconciled vocabulary (W3-#1). `unknown` from a probe maps to `unmeasurable`; there is no
 *  `off` — an observed-absent control is `fail`, an unread one is `unmeasurable`. */
export type ControlState = "pass" | "fail" | "unmeasurable";

/** How a row was learned. `baseline` is reserved for backfills; the probe writes `probe`. */
export type ObservationSource = "scan" | "probe" | "webhook" | "baseline";

/** One measured control, before it is diffed against what we already knew. */
export interface ControlSample {
  /** Kebab-case catalogue id — see CONTROL_IDS in src/lib/scan-probe-controls.ts. */
  controlId: string;
  state: ControlState;
  /** Scalar rendering for non-boolean controls ("2" approvals, "4" rules, "private"). Null when the
   *  control is unmeasurable — a value we could not read must not be rendered as one we did. */
  value: string | null;
  /** The citable slice. Omitted (not `{}`) when there is nothing to cite. */
  evidence?: Record<string, unknown>;
  /** When the state HELD / the change happened, if that is knowable apart from when we learned it. */
  occurredAt?: string;
  /** Set by `diffSamples` for a due heartbeat: a re-assertion, never a transition. */
  heartbeat?: boolean;
}

export interface ObservationContext {
  repoFullName: string;
  source: ObservationSource;
  jobId?: string | null;
  deliveryId?: string | null;
  /** Webhook only. NEVER fabricated for a scan or a probe — nobody performed those. */
  actorLogin?: string | null;
  scanId?: string | null;
}

export interface ControlObservationRow {
  id: string;
  orgId: string;
  repoId: string | null;
  repoFullName: string;
  controlId: string;
  state: ControlState;
  value: string | null;
  prevState: ControlState | null;
  prevValue: string | null;
  evidenceJson: string;
  source: ObservationSource;
  actorLogin: string | null;
  transition: boolean;
  occurredAt: string;
  observedAt: string;
  scanId: string | null;
  jobId: string | null;
  deliveryId: string | null;
  createdAt: string;
}

type PrismaObservation = {
  id: string;
  orgId: string;
  repoId: string | null;
  repoFullName: string;
  controlId: string;
  state: string;
  value: string | null;
  prevState: string | null;
  prevValue: string | null;
  evidenceJson: string;
  source: string;
  actorLogin: string | null;
  transition: boolean;
  occurredAt: Date;
  observedAt: Date;
  scanId: string | null;
  jobId: string | null;
  deliveryId: string | null;
  createdAt: Date;
};

function toRow(o: PrismaObservation): ControlObservationRow {
  return {
    id: o.id,
    orgId: o.orgId,
    repoId: o.repoId,
    repoFullName: o.repoFullName,
    controlId: o.controlId,
    state: o.state as ControlState,
    value: o.value,
    prevState: (o.prevState as ControlState | null) ?? null,
    prevValue: o.prevValue,
    evidenceJson: o.evidenceJson,
    source: o.source as ObservationSource,
    actorLogin: o.actorLogin,
    transition: o.transition,
    occurredAt: o.occurredAt.toISOString(),
    observedAt: o.observedAt.toISOString(),
    scanId: o.scanId,
    jobId: o.jobId,
    deliveryId: o.deliveryId,
    createdAt: o.createdAt.toISOString(),
  };
}

/**
 * Append observations for one repo, stamping each with what it superseded.
 *
 * The caller has already decided WHICH samples are worth writing (`diffSamples` in
 * scan-probe-controls.ts owns that pure decision, so it is testable without a DB). This function
 * owns the durable half: resolve the previous row per control, compute `prevState`/`prevValue` and
 * the transition flag, and insert. Returns how many rows landed and how many of them are alertable.
 */
export async function recordObservations(
  orgSlug: string,
  repoId: string | null,
  samples: ControlSample[],
  ctx: ObservationContext,
): Promise<{ written: number; transitions: number }> {
  if (!isDbConfigured() || samples.length === 0) return { written: 0, transitions: 0 };
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return { written: 0, transitions: 0 };
  const prisma = getPrisma();
  const prev = await latestObservationsFor(orgId, ctx.repoFullName);
  const prevBy = new Map(prev.map((p) => [p.controlId, p]));

  let written = 0;
  let transitions = 0;
  for (const s of samples) {
    const p = prevBy.get(s.controlId) ?? null;
    const changed = p !== null && (p.state !== s.state || p.value !== s.value);
    // A heartbeat re-asserts; a first sighting is a baseline. Neither is a transition (contract §3).
    const transition = !s.heartbeat && changed;
    const now = new Date();
    try {
      await prisma.controlObservation.create({
        data: {
          orgId,
          repoId,
          repoFullName: ctx.repoFullName,
          controlId: s.controlId,
          state: s.state,
          value: s.value,
          prevState: p?.state ?? null,
          prevValue: p?.value ?? null,
          // The column is NOT NULL with a "{}" default, so an evidence-free sample writes the empty
          // object rather than a null — but only because the schema says so; nothing INVENTS
          // evidence for a control that carried none.
          evidenceJson: s.evidence ? JSON.stringify(s.evidence) : "{}",
          source: ctx.source,
          actorLogin: ctx.source === "webhook" ? (ctx.actorLogin ?? null) : null,
          transition,
          occurredAt: s.occurredAt ? new Date(s.occurredAt) : now,
          scanId: ctx.scanId ?? null,
          jobId: ctx.jobId ?? null,
          deliveryId: ctx.deliveryId ?? null,
        },
      });
      written += 1;
      if (transition) transitions += 1;
    } catch {
      // A redelivered webhook collides on @@unique([deliveryId, controlId, repoFullName]) — that is
      // the dedup working, not a failure. Any other write error is equally not worth aborting the
      // remaining controls for: a partial ledger beats none.
    }
  }
  return { written, transitions };
}

async function latestObservationsFor(orgId: string, repoFullName: string): Promise<ControlObservationRow[]> {
  const rows = (await getPrisma()
    .controlObservation.findMany({
      where: { orgId, repoFullName },
      orderBy: { observedAt: "desc" },
      take: 200,
    })
    .catch(() => [])) as PrismaObservation[];
  const seen = new Set<string>();
  const out: ControlObservationRow[] = [];
  for (const r of rows) {
    if (seen.has(r.controlId)) continue;
    seen.add(r.controlId);
    out.push(toRow(r));
  }
  return out;
}

/**
 * The CURRENT posture of one repo: the newest row per control. This is the diff basis for the next
 * probe and the "as it stands" read for any surface that shows controls.
 *
 * A control with no row at all is ABSENT from the result — never a synthesized `unmeasurable` row.
 * "We have never looked" and "we looked and could not read it" are different facts, and only the
 * second one is an observation.
 */
export async function latestObservations(repoId: string): Promise<ControlObservationRow[]> {
  if (!isDbConfigured()) return [];
  const rows = (await getPrisma()
    .controlObservation.findMany({ where: { repoId }, orderBy: { observedAt: "desc" }, take: 200 })
    .catch(() => [])) as PrismaObservation[];
  const seen = new Set<string>();
  const out: ControlObservationRow[] = [];
  for (const r of rows) {
    if (seen.has(r.controlId)) continue;
    seen.add(r.controlId);
    out.push(toRow(r));
  }
  return out;
}

/**
 * Every observation for an org since an ISO instant, oldest first — the feed the alert path and the
 * conformance pack read. `transitionsOnly` narrows it to the alertable rows (contract §3), which is
 * the common case: heartbeats prove continuity, transitions demand attention.
 */
export async function listObservationsSince(
  orgSlug: string,
  since: string,
  opts?: { transitionsOnly?: boolean },
): Promise<ControlObservationRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const sinceAt = new Date(since);
  if (Number.isNaN(sinceAt.getTime())) return [];
  const rows = (await getPrisma()
    .controlObservation.findMany({
      where: { orgId, observedAt: { gte: sinceAt }, ...(opts?.transitionsOnly ? { transition: true } : {}) },
      orderBy: { observedAt: "asc" },
    })
    .catch(() => [])) as PrismaObservation[];
  return rows.map(toRow);
}
