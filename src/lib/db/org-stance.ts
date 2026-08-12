// Org AI stance persistence (W3) — versioned OrgAiStance rows + the OrgArtifactAck acknowledgement
// primitive, plus the read that assembles per-repo compliance FACTS from existing scan data.
//
// stanceJson is SERIALIZED JSON in a TEXT column (the schema's no-jsonb DSQL-safety contract, the
// exact shape org-gate.ts keeps for gatePolicy) and parsed at THIS edge. Stored values are
// sanitized at the route on write and again on read (defense in depth). Versioning is
// append-per-publish: a publish writes version N+1 and marks the prior published row "superseded",
// so history is complete and an acknowledgement can pin the exact version a repo adopted. At most
// one draft row per org (saving a draft replaces it in place). No-op-safe without a DB.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getOrgId } from "@/lib/db/org-rollup";
import { parsePassportJson } from "@/lib/analyze/passport";
import { sanitizeStance, type StanceRepoFacts } from "@/lib/org/stance";
import type { AiStance, PrStats } from "@/lib/types";

/** The kind tag stance rows use on OrgArtifactAck (the column exists so later org artifacts can
 *  share the primitive; every stance query pins it). */
export const STANCE_ARTIFACT_KIND = "ai-stance";

export interface OrgStanceRow {
  id: string;
  version: number;
  status: "draft" | "published" | "superseded";
  stance: AiStance;
  publishedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

interface RawStanceRow {
  id: string;
  version: number;
  status: string;
  stanceJson: unknown;
  publishedBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

/** Parse + re-sanitize a stored row; null when the stored JSON is corrupt/unusable (fail visibly,
 *  fall back safely — the same contract org-gate.ts keeps for a corrupt gatePolicy). */
function toStanceRow(row: RawStanceRow, orgSlug: string): OrgStanceRow | null {
  let parsed: unknown = row.stanceJson;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      console.error(`[org-stance] corrupt stored stanceJson for org "${orgSlug}" v${row.version} — row unusable`);
      return null;
    }
  }
  const stance = sanitizeStance(parsed);
  if (!stance) {
    console.error(`[org-stance] stored stanceJson for org "${orgSlug}" v${row.version} sanitized to nothing — row unusable`);
    return null;
  }
  return {
    id: row.id,
    version: row.version,
    status: row.status as OrgStanceRow["status"],
    stance,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

/** The ACTIVE (published) stance, or null (none published / unknown org / DB-less / corrupt row). */
export async function getActiveOrgStance(orgSlug: string): Promise<OrgStanceRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const row = await getPrisma().orgAiStance.findFirst({
    where: { orgId: org.id, status: "published" },
    orderBy: { version: "desc" },
  });
  return row ? toStanceRow(row, orgSlug) : null;
}

/** The current draft (unpublished) stance, or null. */
export async function getDraftOrgStance(orgSlug: string): Promise<OrgStanceRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const row = await getPrisma().orgAiStance.findFirst({
    where: { orgId: org.id, status: "draft" },
    orderBy: { version: "desc" },
  });
  return row ? toStanceRow(row, orgSlug) : null;
}

/** All stance versions, newest first — the amendment history. Corrupt rows are skipped. */
export async function listOrgStanceVersions(orgSlug: string): Promise<OrgStanceRow[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const rows = await getPrisma().orgAiStance.findMany({
    where: { orgId: org.id },
    orderBy: { version: "desc" },
  });
  return rows.map((r) => toStanceRow(r, orgSlug)).filter((r): r is OrgStanceRow => r != null);
}

/**
 * Save (upsert-in-place) the org's single DRAFT row. The draft's version is always maxVersion+1 —
 * recomputed on every save so a publish that happened since the draft was cut can't leave it
 * claiming an already-taken version. Returns the stored row, null when the stance sanitizes to
 * nothing (nothing stored), or undefined for an unknown org / DB-less deployment.
 */
export async function saveOrgStanceDraft(
  orgSlug: string,
  stance: unknown,
): Promise<OrgStanceRow | null | undefined> {
  if (!isDbConfigured()) return undefined;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return undefined;
  const clean = sanitizeStance(stance);
  if (!clean) return null;
  const prisma = getPrisma();
  const stanceJson = JSON.stringify(clean);

  return prisma.$transaction(async (tx) => {
    const latest = await tx.orgAiStance.findFirst({
      where: { orgId, status: { not: "draft" } },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const draft = await tx.orgAiStance.findFirst({ where: { orgId, status: "draft" }, select: { id: true } });
    const row = draft
      ? await tx.orgAiStance.update({ where: { id: draft.id }, data: { stanceJson, version: nextVersion } })
      : await tx.orgAiStance.create({ data: { orgId, version: nextVersion, status: "draft", stanceJson } });
    return toStanceRow(row, orgSlug);
  });
}

/**
 * PUBLISH a stance: supersede the currently-published row, then promote the draft row (if one
 * exists) — or append a fresh row — at version maxPublished+1 with publishedBy/publishedAt stamped.
 * One transaction, so a failure can never leave the org with zero published rows or two.
 */
export async function publishOrgStance(
  orgSlug: string,
  stance: unknown,
  publishedBy: string | null,
): Promise<OrgStanceRow | null | undefined> {
  if (!isDbConfigured()) return undefined;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return undefined;
  const clean = sanitizeStance(stance);
  if (!clean) return null;
  const prisma = getPrisma();
  const stanceJson = JSON.stringify(clean);
  const publishedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const prior = await tx.orgAiStance.findFirst({
      where: { orgId, status: "published" },
      orderBy: { version: "desc" },
      select: { id: true, version: true },
    });
    if (prior) {
      await tx.orgAiStance.update({ where: { id: prior.id }, data: { status: "superseded" } });
    }
    const nextVersion = (prior?.version ?? 0) + 1;
    const draft = await tx.orgAiStance.findFirst({ where: { orgId, status: "draft" }, select: { id: true } });
    const data = { version: nextVersion, status: "published", stanceJson, publishedBy, publishedAt };
    const row = draft
      ? await tx.orgAiStance.update({ where: { id: draft.id }, data })
      : await tx.orgAiStance.create({ data: { orgId, ...data } });
    return toStanceRow(row, orgSlug);
  });
}

// ---------------------------------------------------------------------------
// Acknowledgements (OrgArtifactAck, artifact = "ai-stance")
// ---------------------------------------------------------------------------

export interface StanceAckRow {
  repoFullName: string;
  version: number;
  ackedBy: string | null;
  ackedAt: Date;
}

/**
 * Record that a repo acknowledged stance version N. Sparse upsert on (org, artifact, repo) — the
 * OrgDecision shape: re-acknowledging updates the row; an unacked repo has no row at all. Returns
 * the stored ack, or undefined for an unknown org / DB-less deployment.
 */
export async function ackOrgStance(
  orgSlug: string,
  repoFullName: string,
  version: number,
  ackedBy: string | null,
): Promise<StanceAckRow | undefined> {
  if (!isDbConfigured()) return undefined;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return undefined;
  const repo = repoFullName.toLowerCase();
  const row = await getPrisma().orgArtifactAck.upsert({
    where: { orgId_artifact_repoFullName: { orgId, artifact: STANCE_ARTIFACT_KIND, repoFullName: repo } },
    create: { orgId, artifact: STANCE_ARTIFACT_KIND, repoFullName: repo, version, ackedBy, ackedAt: new Date() },
    update: { version, ackedBy, ackedAt: new Date() },
  });
  return { repoFullName: row.repoFullName, version: row.version, ackedBy: row.ackedBy, ackedAt: row.ackedAt };
}

/** Every stance acknowledgement in the org, keyed by lowercased repo fullName. */
export async function getOrgStanceAcks(orgSlug: string): Promise<Map<string, StanceAckRow>> {
  const out = new Map<string, StanceAckRow>();
  if (!isDbConfigured()) return out;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return out;
  const rows = await getPrisma().orgArtifactAck.findMany({
    where: { orgId: org.id, artifact: STANCE_ARTIFACT_KIND },
  });
  for (const r of rows) {
    out.set(r.repoFullName.toLowerCase(), {
      repoFullName: r.repoFullName,
      version: r.version,
      ackedBy: r.ackedBy,
      ackedAt: r.ackedAt,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compliance facts — existing scan data only
// ---------------------------------------------------------------------------

/**
 * Assemble each scanned repo's stance-compliance FACTS from data the fleet already persists:
 * the latest scan's prStats (observed tool taxonomy, aiInvolvedRate, W2 aiTrailerRate), the cached
 * passport (the SHARED autonomy resolver's tier — parsePassportJson runs upgradePassport, so even
 * pre-0.3.0 rows carry an honestly-derived tier), the AiChange rows merged without approval, and
 * the repo's acknowledgement. Pure evaluation happens in src/lib/org/stance.ts; this is only IO.
 */
export async function getStanceRepoFacts(orgSlug: string): Promise<StanceRepoFacts[]> {
  if (!isDbConfigured()) return [];
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  const prisma = getPrisma();

  const [repos, unapproved, acks] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId: org.id },
      select: {
        id: true,
        name: true,
        fullName: true,
        passportJson: true,
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          select: { overallScore: true, level: true, prStats: true },
        },
      },
    }),
    // MERGED without an approving review — the exact population AiChange exists to evidence.
    prisma.aiChange.groupBy({
      by: ["repoId"],
      where: { orgId: org.id, approved: false, state: "MERGED" },
      _count: { _all: true },
    }),
    getOrgStanceAcks(orgSlug),
  ]);

  const unapprovedByRepo = new Map(unapproved.map((u) => [u.repoId, u._count._all]));

  const facts: StanceRepoFacts[] = [];
  for (const r of repos) {
    const latest = r.scans[0];
    if (!latest) continue; // never scanned — nothing observed to hold against the stance
    let prStats: PrStats | null = null;
    if (latest.prStats) {
      try {
        prStats = JSON.parse(latest.prStats) as PrStats;
      } catch {
        /* malformed blob — degrade to "no PR data" */
      }
    }
    const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const passport = parsePassportJson(r.passportJson);
    facts.push({
      name: r.name,
      fullName: r.fullName,
      level: latest.level,
      overall: latest.overallScore,
      autonomyTier: passport?.autonomy?.tier ?? null,
      observedTools: (prStats?.tools ?? []).filter((t) => t.count > 0).map((t) => t.name),
      aiInvolvedRate: num(prStats?.aiInvolvedRate),
      aiTrailerRate: num(prStats?.aiTrailerRate),
      unapprovedAiChanges: unapprovedByRepo.get(r.id) ?? 0,
      ackedVersion: acks.get(r.fullName.toLowerCase())?.version ?? null,
    });
  }
  return facts;
}
