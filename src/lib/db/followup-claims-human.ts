// THE HUMAN CLAIM VERBS - take over, send back, release. What a PERSON does to a row a worker holds.
//
// The one claim path (`followup-claims.ts`) lets any worker take an OPEN row; nothing let a person
// answer what happened after. An agent that gave up left `needsHuman` set on an in-progress row with a
// null lease (the same shape as a human hand-off, so the sweep never returns it), and a person who
// handed off a batch and never pasted it could not give it back. These three verbs close that.
//
// EVERY WRITE IS A COMPARE-AND-SET ON THE GENERATION IT READ, never a blind write. The row is read
// org-scoped, and the update's WHERE repeats the exact `claimActor` and `leaseUntil` it saw (the lease
// is the claim's fence, see `followup-attempts.ts`). A row re-claimed, swept or reported on between
// the read and the write no longer matches, and comes back `not-held` with nothing written. A worker
// whose claim a person displaced is then refused at its next report: its holder clause or its fence no
// longer names the live claim, which is the intended loud failure.
//
// AUTHORIZATION is decided at the route from the pure table in
// `src/components/shared/followups/claimActionsModel.ts`; this module narrows each CAS so a caller that
// skipped the route still cannot exceed it: a member's send back needs `needsHuman`, a release needs
// an unleased human claim held by the viewer unless the viewer is an admin.
//
// AUDIT: one row per accepted batch, the same shape the claim path writes (`recordAudit` with the org
// id resolved): `followup.takeover`, or `followup.release` for both send back and release.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordAudit } from "@/lib/db/scans-audit";
import { getOrgBySlug } from "@/lib/db/org-shared";

/** One row's claim state as the route's authorization reads it. WIRE-SAFE: the lease is an ISO. */
export interface ClaimStateRow {
  id: string;
  status: "open" | "in_progress" | "done" | "dismissed";
  claimActor: string | null;
  claimExecutor: "local" | "remote-agent" | "human" | null;
  leaseUntil: string | null;
  needsHuman: boolean;
}

export interface HumanVerbResult {
  done: string[];
  skipped: { id: string; reason: "not-held" }[];
}

interface RawState {
  id: string;
  status: string;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
}

const STATE_SELECT = { id: true, status: true, claimActor: true, claimExecutor: true, leaseUntil: true, needsHuman: true } as const;
const STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);
const EXECUTORS = new Set(["local", "remote-agent", "human"]);

async function readRaw(orgSlug: string, ids: readonly string[]): Promise<{ orgId: string; rows: RawState[] } | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const rows = (await getPrisma().recommendation.findMany({
    where: { id: { in: [...new Set(ids)] }, scan: { repo: { orgId: org.id } } },
    select: STATE_SELECT,
  })) as RawState[];
  return { orgId: org.id, rows };
}

/** The claim state of the ids this org owns. A foreign or unknown id is simply absent. Null when the
 *  org is unknown or persistence is off. */
export async function readClaimStates(orgSlug: string, ids: readonly string[]): Promise<ClaimStateRow[] | null> {
  const read = await readRaw(orgSlug, ids);
  if (!read) return null;
  return read.rows.map((r) => ({
    id: r.id,
    status: (STATUSES.has(r.status) ? r.status : "open") as ClaimStateRow["status"],
    claimActor: r.claimActor,
    claimExecutor: (r.claimExecutor && EXECUTORS.has(r.claimExecutor) ? r.claimExecutor : null) as ClaimStateRow["claimExecutor"],
    leaseUntil: r.leaseUntil ? r.leaseUntil.toISOString() : null,
    needsHuman: r.needsHuman,
  }));
}

interface VerbSpec {
  /** Extra predicate on the row as read; false = skipped without a write. */
  eligible: (r: RawState) => boolean;
  /** Extra CAS clauses beyond id + org + status + the generation read. */
  where: (r: RawState) => Record<string, unknown>;
  data: Record<string, unknown>;
  actor: string;
  toValue: "in_progress" | "open";
  note: (r: RawState) => string;
  audit: { action: "followup.takeover" | "followup.release"; verb: string };
}

/** One literal call site per action, so the audit registry guard (AuditLogCells.actions.test.ts)
 *  resolves both and holds them to an entry in auditActions.ts. */
function auditBatch(action: VerbSpec["audit"]["action"], meta: Record<string, unknown>, orgId: string): Promise<boolean> {
  return action === "followup.takeover"
    ? recordAudit("followup.takeover", meta, { orgId })
    : recordAudit("followup.release", meta, { orgId });
}

const RELEASED = { status: "open", claimActor: null, claimExecutor: null, leaseUntil: null, needsHuman: false };
const holderOf = (r: RawState) => r.claimActor ?? "an unnamed worker";

async function applyVerb(orgSlug: string, ids: readonly string[], spec: VerbSpec): Promise<HumanVerbResult | null> {
  const read = await readRaw(orgSlug, ids);
  if (!read) return null;
  const prisma = getPrisma();
  const byId = new Map(read.rows.map((r) => [r.id, r]));
  const done: string[] = [];
  const displaced: Record<string, string | null> = {};
  const skipped: HumanVerbResult["skipped"] = [];

  for (const id of [...new Set(ids)]) {
    const r = byId.get(id);
    if (!r || r.status !== "in_progress" || !spec.eligible(r)) {
      skipped.push({ id, reason: "not-held" });
      continue;
    }
    // THE COMPARE-AND-SET, on the exact generation read above.
    const res = await prisma.recommendation.updateMany({
      where: {
        id,
        status: "in_progress",
        scan: { repo: { orgId: read.orgId } },
        claimActor: r.claimActor,
        leaseUntil: r.leaseUntil,
        ...spec.where(r),
      },
      data: spec.data,
    });
    if (res.count !== 1) {
      skipped.push({ id, reason: "not-held" });
      continue;
    }
    done.push(id);
    displaced[id] = r.claimActor;
    await prisma.recommendationEvent
      .create({
        data: { recommendationId: id, actor: spec.actor, kind: "status", fromValue: "in_progress", toValue: spec.toValue, note: spec.note(r) },
      })
      .catch(() => null);
  }

  if (done.length > 0) {
    await auditBatch(spec.audit.action, { ids: done, actor: spec.actor, verb: spec.audit.verb, displaced }, read.orgId).catch(() => false);
  }
  return { done, skipped };
}

/** Take needs-human rows as `actor`'s unleased human claim. Any member may; the flag clears. */
export function takeOverEscalations(orgSlug: string, ids: readonly string[], actor: string): Promise<HumanVerbResult | null> {
  return applyVerb(orgSlug, ids, {
    eligible: (r) => r.needsHuman,
    where: () => ({ needsHuman: true }),
    data: { claimActor: actor, claimExecutor: "human", leaseUntil: null, needsHuman: false },
    actor,
    toValue: "in_progress",
    note: (r) => `Taken over by ${actor} from ${holderOf(r)}, which had asked for a person.`,
    audit: { action: "followup.takeover", verb: "take-over" },
  });
}

/** Return claimed rows to the queue. A member may send back a needs-human row; an admin, any claim. */
export function sendBack(orgSlug: string, ids: readonly string[], viewer: { login: string; admin: boolean }): Promise<HumanVerbResult | null> {
  return applyVerb(orgSlug, ids, {
    eligible: (r) => viewer.admin || r.needsHuman,
    // A member's send back is eligible only on a needs-human row, so this pins `true` for them.
    where: (r) => ({ needsHuman: r.needsHuman }),
    data: RELEASED,
    actor: viewer.login,
    toValue: "open",
    note: (r) => `Sent back to the queue by ${viewer.login} (held by ${holderOf(r)}).`,
    audit: { action: "followup.release", verb: "send-back" },
  });
}

/** Release unleased human claims: the viewer's own, or any for an admin. Never a leased machine claim. */
export function releaseHumanClaims(orgSlug: string, ids: readonly string[], viewer: { login: string; admin: boolean }): Promise<HumanVerbResult | null> {
  return applyVerb(orgSlug, ids, {
    eligible: (r) => r.claimExecutor === "human" && r.leaseUntil === null && (viewer.admin || r.claimActor === viewer.login),
    where: () => ({ claimExecutor: "human", leaseUntil: null }),
    data: RELEASED,
    actor: viewer.login,
    toValue: "open",
    note: (r) => (r.claimActor === viewer.login ? `Released by ${viewer.login}.` : `Released by ${viewer.login} (held by ${holderOf(r)}).`),
    audit: { action: "followup.release", verb: "release" },
  });
}
