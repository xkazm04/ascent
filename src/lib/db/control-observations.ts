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
// W3-M's read side (below the divider near the bottom of this file) — the seal primitives and the
// existing per-row HMAC. Imported here so the whole ledger module has one import block.
import { signAudit } from "@/lib/db/audit-integrity";
import { dayRoot, isClosedDay, rowDigest, utcDay, type SealableRow } from "@/lib/controls/seal";

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

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// W3-M — THE READ SIDE (moonshot #1). Everything above this line is W3-L's frozen writer contract
// and is not edited here.
//
// Four readers and two seal functions. They all answer a shape of question the writer deliberately
// cannot: not "what is the posture now" (that is `latestObservations`) but "what was it AT A GIVEN
// INSTANT", "what happened over a window", and — the one an assurance artifact lives or dies on —
// "how much did we actually observe, and where are the holes".
//
// `controlCoverage` is the honesty valve for the whole feature. Any surface that prints a control's
// state over a period must print its coverage beside it, because "branch protection held all
// quarter" read off two observations three months apart is a sentence the evidence does not support.
// The coverage row states the observation count and the largest gap, so the claim always carries
// its own N.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

/** One (org, UTC day) seal, as it crosses to a client. Every timestamp is a `string`. */
export interface ControlSealRow {
  day: string;
  rowCount: number;
  root: string;
  prevRoot: string | null;
  sealedAt: string;
  /** True when an HMAC was stored. The HMAC ITSELF is never shipped: it proves nothing to a reader
   *  who cannot recompute it, and publishing it hands out a distinguisher against the signing
   *  secret. The sha256 root, which anyone can recompute, is the part that travels. */
  signed: boolean;
}

export interface ControlCoverage {
  repoFullName: string;
  controlId: string;
  /** Null when the control was never observed in the window — "we never looked" is not zero. */
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  /** How many rows back the claim. Printed with every state assertion over a period. */
  observations: number;
  /** Which provenances contributed, sorted. */
  sources: ObservationSource[];
  /** The LARGEST silent stretch BETWEEN observations, in days (one decimal). The heartbeat is 24h,
   *  so anything much above 1 means we stopped looking rather than that nothing changed. Null with
   *  fewer than two observations — one row cannot describe a gap. */
  maxGapDays: number | null;
  /** The state of the newest observation in the window, or null when there are none. */
  lastState: ControlState | null;
}

/** Hard ceiling on one timeline read. Stated by the route when it bites — never silently truncated. */
export const TIMELINE_CAP = 2000;

const DAY_MS = 24 * 60 * 60_000;

/**
 * The state of one control on one repo AS OF an instant — the ledger's reason for existing.
 *
 * "The newest observation whose `occurredAt` is at or before `at`." Returns null when there is none,
 * and the caller MUST treat that as "the ledger does not cover this instant" rather than falling
 * back silently: the conformance pack labels such rows `latest-scan` PER ROW precisely so a reader
 * can see which evidence is as-of and which is merely current.
 *
 * Keyed on `occurredAt`, not `observedAt`: an auditor asks what the control WAS when the change
 * merged, not when we happened to notice.
 */
export async function controlStateAt(
  orgSlug: string,
  repoFullName: string,
  controlId: string,
  at: Date | string,
): Promise<ControlObservationRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return null;
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return null;
  const row = (await getPrisma()
    .controlObservation.findFirst({
      where: { orgId, repoFullName, controlId, occurredAt: { lte: when } },
      orderBy: { occurredAt: "desc" },
    })
    .catch(() => null)) as PrismaObservation | null;
  return row ? toRow(row) : null;
}

/**
 * Every control's state as of one instant for one repo, in ONE query rather than thirteen.
 *
 * The pack calls this per sampled row, so a per-control `controlStateAt` would be thirteen queries
 * per sampled change. Instead: one descending read of the rows at or before the instant, first-wins
 * per control. The `take` is bounded but generous enough that the first-wins pass still sees every
 * control on a repo probed hourly.
 */
export async function controlsAt(
  orgSlug: string,
  repoFullName: string,
  at: Date | string,
): Promise<ControlObservationRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return [];
  const rows = (await getPrisma()
    .controlObservation.findMany({
      where: { orgId, repoFullName, occurredAt: { lte: when } },
      orderBy: { occurredAt: "desc" },
      take: 400,
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

export interface TimelineQuery {
  repoFullName?: string | null;
  controlId?: string | null;
  from?: string | null;
  to?: string | null;
  transitionsOnly?: boolean;
  limit?: number;
}

/**
 * The org's observation timeline, newest first — what the Governance tab card reads.
 *
 * Null (not `[]`) when there is no database: an empty array renders as "this org has no governance
 * events", which is a claim, and a DB-less deployment has made no such observation.
 */
export async function listControlTimeline(
  orgSlug: string,
  q: TimelineQuery = {},
): Promise<ControlObservationRow[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const occurredAt: { gte?: Date; lte?: Date } = {};
  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to) : null;
  if (from && !Number.isNaN(from.getTime())) occurredAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) occurredAt.lte = to;
  const rows = (await getPrisma()
    .controlObservation.findMany({
      where: {
        orgId,
        ...(q.repoFullName ? { repoFullName: q.repoFullName } : {}),
        ...(q.controlId ? { controlId: q.controlId } : {}),
        ...(q.transitionsOnly ? { transition: true } : {}),
        ...(occurredAt.gte || occurredAt.lte ? { occurredAt } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: Math.max(1, Math.min(TIMELINE_CAP, q.limit ?? 200)),
    })
    .catch(() => [])) as PrismaObservation[];
  return rows.map(toRow);
}

/**
 * Coverage per (repo, control) over a window — the N that every period claim must be stated with.
 *
 * `maxGapDays` is computed across the OBSERVATIONS ONLY and never extended to the window edges: we
 * know nothing about the stretch before the first observation, and calling that stretch a gap would
 * be as wrong as calling it covered. The first/last stamps are published beside it so a reader can
 * see the uncovered edges for themselves.
 */
export async function controlCoverage(
  orgSlug: string,
  q: { repoFullName?: string | null; controlId?: string | null; from?: string | null; to?: string | null } = {},
): Promise<ControlCoverage[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return [];
  const occurredAt: { gte?: Date; lte?: Date } = {};
  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to) : null;
  if (from && !Number.isNaN(from.getTime())) occurredAt.gte = from;
  if (to && !Number.isNaN(to.getTime())) occurredAt.lte = to;
  type CoverageRow = { repoFullName: string; controlId: string; occurredAt: Date; source: string; state: string };
  const rows = (await getPrisma()
    .controlObservation.findMany({
      where: {
        orgId,
        ...(q.repoFullName ? { repoFullName: q.repoFullName } : {}),
        ...(q.controlId ? { controlId: q.controlId } : {}),
        ...(occurredAt.gte || occurredAt.lte ? { occurredAt } : {}),
      },
      orderBy: { occurredAt: "asc" },
      take: TIMELINE_CAP,
      select: { repoFullName: true, controlId: true, occurredAt: true, source: true, state: true },
    })
    .catch(() => [])) as CoverageRow[];

  const byPair = new Map<string, CoverageRow[]>();
  for (const r of rows) {
    // A space is a safe join here: neither an `owner/name` nor a kebab-case control id contains one.
    const key = `${r.repoFullName} ${r.controlId}`;
    const hit = byPair.get(key);
    if (hit) hit.push(r);
    else byPair.set(key, [r]);
  }

  const out: ControlCoverage[] = [];
  for (const group of byPair.values()) {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    let maxGapMs = 0;
    for (let i = 1; i < group.length; i += 1) {
      maxGapMs = Math.max(maxGapMs, group[i]!.occurredAt.getTime() - group[i - 1]!.occurredAt.getTime());
    }
    out.push({
      repoFullName: first.repoFullName,
      controlId: first.controlId,
      firstObservedAt: first.occurredAt.toISOString(),
      lastObservedAt: last.occurredAt.toISOString(),
      observations: group.length,
      sources: [...new Set(group.map((r) => r.source as ObservationSource))].sort(),
      maxGapDays: group.length < 2 ? null : Math.round((maxGapMs / DAY_MS) * 10) / 10,
      lastState: last.state as ControlState,
    });
  }
  return out.sort((a, b) => a.repoFullName.localeCompare(b.repoFullName) || a.controlId.localeCompare(b.controlId));
}

// ── The seal (tamper-evidence) ───────────────────────────────────────────────────────────────────

function sealable(r: PrismaObservation): SealableRow {
  return {
    orgId: r.orgId,
    repoFullName: r.repoFullName,
    controlId: r.controlId,
    state: r.state,
    value: r.value,
    prevState: r.prevState,
    prevValue: r.prevValue,
    source: r.source,
    actorLogin: r.actorLogin,
    transition: r.transition,
    occurredAt: r.occurredAt.toISOString(),
    evidenceJson: r.evidenceJson,
  };
}

type PrismaSeal = {
  day: string;
  rowCount: number;
  root: string;
  prevRoot: string | null;
  sealedAt: Date;
  sig: string | null;
};

function toSealRow(s: PrismaSeal): ControlSealRow {
  return {
    day: s.day,
    rowCount: s.rowCount,
    root: s.root,
    prevRoot: s.prevRoot,
    sealedAt: s.sealedAt.toISOString(),
    signed: s.sig != null,
  };
}

/**
 * Seal one CLOSED UTC day: compute the root over its rows and store it, chained to the previous
 * sealed day.
 *
 * Idempotent by `@@unique([orgId, day])` — re-sealing an already-sealed day returns the EXISTING
 * seal unchanged rather than recomputing it. That is the whole point: if a seal could be silently
 * overwritten, a rewritten day could be re-sealed to match and the evidence would be worthless. A
 * day whose stored root no longer matches its rows is reported as `tampered`, never quietly repaired.
 *
 * Refuses an OPEN day (today or later): a root over a day still receiving rows is invalidated by the
 * next append, and a chain full of stale roots reads as a fleet-wide tamper.
 */
export async function sealDay(orgSlug: string, day: string, now: number = Date.now()): Promise<ControlSealRow | null> {
  if (!isDbConfigured()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isClosedDay(day, now)) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return null;
  const prisma = getPrisma();

  const existing = (await prisma.controlLedgerSeal
    .findUnique({ where: { orgId_day: { orgId, day } } })
    .catch(() => null)) as PrismaSeal | null;
  if (existing) return toSealRow(existing);

  const start = new Date(`${day}T00:00:00.000Z`);
  const rows = (await prisma.controlObservation
    .findMany({ where: { orgId, occurredAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) } }, orderBy: { occurredAt: "asc" } })
    .catch(() => [])) as PrismaObservation[];
  // A day with no rows gets NO seal. An empty root would assert "we sealed a day on which nothing
  // happened", which is indistinguishable from "every row of that day was deleted before we looked".
  if (rows.length === 0) return null;

  const prev = (await prisma.controlLedgerSeal
    .findFirst({ where: { orgId, day: { lt: day } }, orderBy: { day: "desc" } })
    .catch(() => null)) as PrismaSeal | null;
  const root = dayRoot(
    rows.map((r) => rowDigest(sealable(r))),
    prev?.root ?? null,
  );
  const sig = signAudit({
    action: "controls.seal",
    orgId,
    actorId: "system",
    // The DAY's own closing instant, not the sealing clock: two replicas sealing the same day at
    // different times must produce the same HMAC, or the signature would report a tamper on nothing.
    createdAt: `${day}T23:59:59.999Z`,
    meta: { day, rowCount: rows.length, root, prevRoot: prev?.root ?? null },
  });

  try {
    const created = (await prisma.controlLedgerSeal.create({
      data: { orgId, day, rowCount: rows.length, root, prevRoot: prev?.root ?? null, sig },
    })) as PrismaSeal;
    return toSealRow(created);
  } catch {
    // A concurrent sealer won the unique. Read theirs rather than throwing — two sealers computing
    // the same root over the same closed day agree by construction.
    const won = (await prisma.controlLedgerSeal
      .findUnique({ where: { orgId_day: { orgId, day } } })
      .catch(() => null)) as PrismaSeal | null;
    return won ? toSealRow(won) : null;
  }
}

/** One day's verdict. `no-rows` is the RETENTION case and is deliberately not a failure — see below. */
export type SealVerdict = "ok" | "tampered" | "broken-chain" | "no-rows";

export interface SealCheck extends ControlSealRow {
  verdict: SealVerdict;
  /** The root recomputed from the rows present NOW. Differs from `root` exactly when something moved. */
  recomputedRoot: string | null;
  /** How many rows are present now, against the `rowCount` recorded at sealing time. */
  rowsNow: number;
}

export interface SealChain {
  checks: SealCheck[];
  /** True only when every seal in the range verified AND the day-to-day chain is intact. */
  chainOk: boolean;
  /** Days that hold rows but no seal yet — today, and anything the lazy sealer has not reached. */
  unsealedDays: string[];
}

/**
 * Recompute every seal in a window and check the day-to-day chain.
 *
 * `no-rows` earns its own arm. Both tables purge under the org's `auditDays` policy, and a purged
 * day KEEPS its seal — deliberately, because that is what makes a deleted window *detectable*: the
 * seal still says "1,204 rows were here on 2026-05-01" long after the rows are gone. Reporting that
 * as `tampered` would cry wolf on every org that retains anything for less than forever, so a day
 * whose rows are entirely absent is `no-rows` and does not clear `chainOk`. A day with SOME of its
 * rows and a different root IS `tampered`, and does.
 */
export async function verifySeals(
  orgSlug: string,
  q: { from?: string | null; to?: string | null } = {},
): Promise<SealChain | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug).catch(() => null);
  if (!orgId) return { checks: [], chainOk: true, unsealedDays: [] };
  const prisma = getPrisma();
  const day: { gte?: string; lte?: string } = {};
  if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) day.gte = q.from;
  if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) day.lte = q.to;

  const seals = (await prisma.controlLedgerSeal
    .findMany({ where: { orgId, ...(day.gte || day.lte ? { day } : {}) }, orderBy: { day: "asc" } })
    .catch(() => [])) as PrismaSeal[];

  const checks: SealCheck[] = [];
  let chainOk = true;
  let expectedPrev: string | null = null;
  let first = true;
  for (const s of seals) {
    const start = new Date(`${s.day}T00:00:00.000Z`);
    const rows = (await prisma.controlObservation
      .findMany({ where: { orgId, occurredAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) } } })
      .catch(() => [])) as PrismaObservation[];
    const recomputed = rows.length
      ? dayRoot(
          rows.map((r) => rowDigest(sealable(r))),
          s.prevRoot,
        )
      : null;
    // The chain link is checked against the PRECEDING SEAL IN THIS RESULT, except for the first one:
    // a windowed query legitimately starts mid-chain, and calling that a break would report every
    // filtered read as tampered.
    const linkOk = first || s.prevRoot === expectedPrev;
    const verdict: SealVerdict =
      rows.length === 0 ? "no-rows" : !linkOk ? "broken-chain" : recomputed === s.root ? "ok" : "tampered";
    if (verdict === "tampered" || verdict === "broken-chain") chainOk = false;
    checks.push({ ...toSealRow(s), verdict, recomputedRoot: recomputed, rowsNow: rows.length });
    expectedPrev = s.root;
    first = false;
  }

  // Days that hold rows but carry no seal. REPORTED, not sealed: `verifySeals` is a read, and a
  // verifier that writes is a verifier checking its own output.
  const sealed = new Set(seals.map((s) => s.day));
  const rowDays = (await prisma.controlObservation
    .findMany({
      where: { orgId, ...(day.gte ? { occurredAt: { gte: new Date(`${day.gte}T00:00:00.000Z`) } } : {}) },
      select: { occurredAt: true },
      orderBy: { occurredAt: "desc" },
      take: TIMELINE_CAP,
    })
    .catch(() => [])) as { occurredAt: Date }[];
  const unsealedDays = [
    ...new Set(
      rowDays.map((r) => utcDay(r.occurredAt.toISOString())).filter((d): d is string => d != null && !sealed.has(d)),
    ),
  ].sort();

  return { checks, chainOk, unsealedDays };
}

/**
 * Seal every CLOSED day that holds rows and has no seal yet.
 *
 * `/api/audit/verify` runs this before it reports, so the ledger needs no cron of its own and no
 * `vercel.json` entry — the surface that cares about seals is the one that creates them. Capped so a
 * single request can never walk a year of backlog; the next call takes the next `cap` days.
 */
export async function sealPendingDays(orgSlug: string, now: number = Date.now(), cap = 14): Promise<string[]> {
  const chain = await verifySeals(orgSlug);
  if (!chain) return [];
  const sealedNow: string[] = [];
  for (const d of chain.unsealedDays) {
    if (sealedNow.length >= cap) break;
    if (!isClosedDay(d, now)) continue;
    if (await sealDay(orgSlug, d, now)) sealedNow.push(d);
  }
  return sealedNow;
}
