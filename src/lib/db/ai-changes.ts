// The AI-change POPULATION read (W2) — the rows behind the Conformance Pack.
//
// `AiChange` is already written on every scan (scans-persist.ts) as an evidence ROW rather than an
// aggregate, precisely because a percentage is not evidence. This module is the only place that
// reads the population org-wide, plus the per-repo control ENVIRONMENT (the branch-protection
// settings in force) that a sampled row has to be judged against.
//
// SCOPE HONESTY, and it is load-bearing for an assurance artifact: this population is a LOWER BOUND.
// Rows exist only for PRs inside each repo's scanned PR window, so a change that merged before the
// repo was first scanned — or outside the window a scan paged — has no row. The pack states this
// verbatim; a caller must never present the count as "every AI change in the period".

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { Governance } from "@/lib/types";

/** One AI-attributed change, as the pack sees it. Mirrors the AiChange columns, dates as ISO. */
export interface AiChangeRecord {
  repoFullName: string;
  prNumber: number;
  title: string;
  authorLogin: string | null;
  authorIsBot: boolean;
  /** "authored" (an agent opened it) | "marked" (a human using a tool). Different governance weight. */
  aiSignal: string;
  aiTools: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  /** THE CONTROL: a human approving review before merge, and who gave it. */
  approved: boolean;
  approverLogin: string | null;
  approvedAt: string | null;
  reviewCount: number;
}

/** The branch-protection settings in force on a repo at its latest scan — the control environment. */
export interface RepoControlEnvironment {
  repoFullName: string;
  /** Null when no scan carried readable governance (no token) — never a fabricated "unprotected". */
  governance: Governance | null;
  /** Provenance of the scan the environment was read from. */
  scannedAt: string | null;
  engineProvider: string | null;
  engineModel: string | null;
}

/** Everything the pack builder needs, in one read. */
export interface AiChangePopulation {
  changes: AiChangeRecord[];
  environments: RepoControlEnvironment[];
  /** Earliest and latest `createdAt` across the returned rows — the window actually covered. */
  observedFrom: string | null;
  observedTo: string | null;
}

/** Hard ceiling on rows pulled into one pack. Stated in the pack when it bites — never silent. */
export const POPULATION_CAP = 5000;

function parseGovernance(json: string | null): Governance | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Governance;
    return v && typeof v === "object" && typeof v.defaultBranch === "string" ? v : null;
  } catch {
    return null;
  }
}

/**
 * The org's AI-change population over `[start, end]` (by the PR's own `createdAt`, not the row's
 * `recordedAt` — an auditor samples the period the CHANGE happened in), plus the control environment
 * per repo that has rows.
 *
 * Ordered by `createdAt` then `prNumber`, both ascending: a STABLE, content-derived order is what
 * makes the seeded sample reproducible by anyone holding the same population.
 */
export async function getAiChangePopulation(
  orgSlug: string,
  window: { start: Date | null; end: Date | null },
): Promise<AiChangePopulation | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const prisma = getPrisma();

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (window.start) createdAt.gte = window.start;
  if (window.end) createdAt.lte = window.end;

  const rows = await prisma.aiChange.findMany({
    where: { orgId: org.id, ...(createdAt.gte || createdAt.lte ? { createdAt } : {}) },
    orderBy: [{ createdAt: "asc" }, { prNumber: "asc" }],
    take: POPULATION_CAP,
    select: {
      prNumber: true,
      title: true,
      authorLogin: true,
      authorIsBot: true,
      aiSignal: true,
      aiTools: true,
      state: true,
      createdAt: true,
      mergedAt: true,
      approved: true,
      approverLogin: true,
      approvedAt: true,
      reviewCount: true,
      repo: { select: { fullName: true } },
    },
  });

  const changes: AiChangeRecord[] = rows.map((r) => ({
    repoFullName: r.repo.fullName,
    prNumber: r.prNumber,
    title: r.title,
    authorLogin: r.authorLogin,
    authorIsBot: r.authorIsBot,
    aiSignal: r.aiSignal,
    aiTools: r.aiTools,
    state: r.state,
    createdAt: r.createdAt.toISOString(),
    mergedAt: r.mergedAt ? r.mergedAt.toISOString() : null,
    approved: r.approved,
    approverLogin: r.approverLogin,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    reviewCount: r.reviewCount,
  }));

  // The control environment, only for repos that actually contributed rows — a pack should not
  // describe protection settings on repos it drew no evidence from.
  const names = [...new Set(changes.map((c) => c.repoFullName))];
  const envRepos = names.length
    ? await prisma.repository.findMany({
        where: { orgId: org.id, fullName: { in: names } },
        select: {
          fullName: true,
          scans: {
            orderBy: { scannedAt: "desc" },
            take: 1,
            select: { governance: true, scannedAt: true, engineProvider: true, engineModel: true },
          },
        },
      })
    : [];

  const environments: RepoControlEnvironment[] = envRepos.map((r) => {
    const s = r.scans[0];
    return {
      repoFullName: r.fullName,
      governance: parseGovernance(s?.governance ?? null),
      scannedAt: s?.scannedAt ? s.scannedAt.toISOString() : null,
      engineProvider: s?.engineProvider ?? null,
      engineModel: s?.engineModel ?? null,
    };
  });

  return {
    changes,
    environments,
    observedFrom: changes[0]?.createdAt ?? null,
    observedTo: changes[changes.length - 1]?.createdAt ?? null,
  };
}
