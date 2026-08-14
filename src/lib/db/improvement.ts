// The live-wall SHIP LOOP: identify → triage → PR → merge → rescan → impact, persisted.
//
// The practices-page apply flow ends at "draft PR opened"; this module carries an ACCEPTED
// direction (an open Recommendation the owner triaged on the war-room wall) through the rest of
// its life: the starter PR (applyPracticeToRepo), merge detection (getPullRequest, polled from
// the visible wall), and post-merge verification (first scan after the merge vs the baseline
// scan → dim/overall impact). One ImprovementPr row per repo × practice — the artifact branch
// `ascent/{practiceId}` is per-repo unique, so a second accept reuses the same PR.
//
// Mock-PR mode (ASCENT_MOCK_PRS=1, honored ONLY while the GitHub App is NOT configured) fabricates
// PRs that "merge" after a short delay, so the whole loop runs on a keyless local dev — the same
// philosophy as the deterministic mock LLM provider.

import { cache } from "react";

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getInstallationIdForOwner } from "@/lib/db/installations";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getPullRequest } from "@/lib/github/write";
import { applyPracticeToRepo } from "@/lib/practices/apply";
import { PRACTICES } from "@/lib/practices";

const PRACTICE_BY_DIM = new Map(PRACTICES.map((p) => [p.dimId as string, p]));

const TRIAGE_MAX = 8;
const LANDED_MAX = 8;
const REFRESH_MAX = 10; // PR-state reads per poll tick — bounded for GitHub rate-limit hygiene
/** How long a mock PR stays open before the poll observes it "merged" (dev demo pacing). */
export const MOCK_MERGE_MS = 90_000;

/** Mock PRs: dev-only stand-ins so the loop is demoable keylessly. NEVER active once the real
 *  GitHub App is configured — the env flag alone can't override a working install. */
export function mockPrsEnabled(): boolean {
  return process.env.ASCENT_MOCK_PRS === "1" && !isAppConfigured();
}

export interface OpsTriageItem {
  recommendationId: string;
  repoFullName: string;
  repoName: string;
  dimId: string;
  practiceId: string;
  practiceLabel: string;
  title: string;
  rationale: string;
  impact: string;
  effort: string;
}

export interface OpsPrItem {
  id: string;
  repoFullName: string;
  repoName: string;
  dimId: string;
  practiceId: string;
  practiceLabel: string;
  prNumber: number;
  prUrl: string;
  state: "open" | "merged" | "closed";
  openedAt: string;
  mergedAt: string | null;
  /** null until the post-merge rescan lands ("awaiting rescan"). */
  impactDim: number | null;
  impactOverall: number | null;
  verified: boolean;
}

export interface OpsState {
  triage: OpsTriageItem[];
  inFlight: OpsPrItem[];
  /** Merged (verified or awaiting rescan) + GitHub-closed-unmerged, newest first. */
  landed: OpsPrItem[];
  counts: { triage: number; inFlight: number; landed: number };
  mockPrs: boolean;
}

const IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/** Triage order: biggest lever first — impact high→low, then effort low→high, then title. Pure. */
export function rankTriage<T extends { impact: string; effort: string; title: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (IMPACT_RANK[a.impact] ?? 3) - (IMPACT_RANK[b.impact] ?? 3) ||
      (EFFORT_RANK[a.effort] ?? 3) - (EFFORT_RANK[b.effort] ?? 3) ||
      a.title.localeCompare(b.title),
  );
}

/** Scores of one scan, as the impact math needs them. */
export interface ScanScores {
  overall: number;
  dims: { dimId: string; score: number }[];
}

/**
 * The measured effect of a merged PR: the practice's own dimension delta (the number the loop is
 * really about) + the overall delta, first-post-merge scan vs the baseline scan. Pure. A missing
 * baseline (repo accepted before its first scan) yields nulls for the dim without inventing a zero.
 */
export function computePrImpact(
  dimId: string,
  baseline: ScanScores | null,
  verified: ScanScores,
): { impactDim: number | null; impactOverall: number | null } {
  if (!baseline) return { impactDim: null, impactOverall: null };
  const dimOf = (s: ScanScores) => s.dims.find((d) => d.dimId === dimId)?.score ?? null;
  const before = dimOf(baseline);
  const after = dimOf(verified);
  return {
    impactDim: before != null && after != null ? after - before : null,
    impactOverall: verified.overall - baseline.overall,
  };
}

/** Whether a mock PR has been "open" long enough for the poll to observe it merged. Pure. */
export function mockPrShouldMerge(openedAt: Date, now: Date, ms: number = MOCK_MERGE_MS): boolean {
  return now.getTime() - openedAt.getTime() >= ms;
}

type PrRow = {
  id: string;
  repoFullName: string;
  dimId: string;
  practiceId: string;
  prNumber: number;
  prUrl: string;
  state: string;
  createdAt: Date;
  mergedAt: Date | null;
  impactDim: number | null;
  impactOverall: number | null;
  verifiedScanId: string | null;
};

function toPrItem(r: PrRow): OpsPrItem {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    repoName: r.repoFullName.split("/").pop() ?? r.repoFullName,
    dimId: r.dimId,
    practiceId: r.practiceId,
    practiceLabel: PRACTICES.find((p) => p.id === r.practiceId)?.label ?? r.practiceId,
    prNumber: r.prNumber,
    prUrl: r.prUrl,
    state: (r.state === "merged" || r.state === "closed" ? r.state : "open") as OpsPrItem["state"],
    openedAt: r.createdAt.toISOString(),
    mergedAt: r.mergedAt ? r.mergedAt.toISOString() : null,
    impactDim: r.impactDim,
    impactOverall: r.impactOverall,
    verified: r.verifiedScanId != null,
  };
}

/** The wall's current loop state: ranked triage candidates + PRs in flight + landed outcomes. */
export async function listOpsState(orgSlug: string): Promise<OpsState | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const [repos, prs] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId: org.id, watched: true },
      select: {
        fullName: true,
        name: true,
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 1,
          select: {
            recommendations: {
              where: { status: "open" },
              select: { id: true, title: true, dimId: true, impact: true, effort: true, rationale: true },
            },
          },
        },
      },
    }),
    prisma.improvementPr.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "desc" } }),
  ]);

  // A repo × practice with a live (open/merged) PR is already in motion — keep it out of triage.
  // A GitHub-closed (rejected) PR unblocks the pair so the direction can be retried later.
  const inMotion = new Set(prs.filter((p) => p.state !== "closed").map((p) => `${p.repoFullName}::${p.practiceId}`));

  const candidates: OpsTriageItem[] = [];
  for (const r of repos) {
    for (const rec of r.scans[0]?.recommendations ?? []) {
      const practice = PRACTICE_BY_DIM.get(rec.dimId);
      if (!practice || inMotion.has(`${r.fullName}::${practice.id}`)) continue;
      candidates.push({
        recommendationId: rec.id,
        repoFullName: r.fullName,
        repoName: r.name,
        dimId: rec.dimId,
        practiceId: practice.id,
        practiceLabel: practice.label,
        title: rec.title,
        rationale: rec.rationale,
        impact: rec.impact,
        effort: rec.effort,
      });
    }
  }
  const ranked = rankTriage(candidates);

  const inFlight = prs.filter((p) => p.state === "open").map(toPrItem);
  const landed = prs.filter((p) => p.state !== "open").slice(0, LANDED_MAX).map(toPrItem);
  return {
    triage: ranked.slice(0, TRIAGE_MAX),
    inFlight,
    landed,
    counts: { triage: ranked.length, inFlight: inFlight.length, landed: prs.length - inFlight.length },
    mockPrs: mockPrsEnabled(),
  };
}

/**
 * How many PRs the loop has open right now. One indexed count (`@@index([orgId, state])`) — cheap
 * enough for the shell to run on EVERY org tab render, which is what the landing decision needs
 * (src/lib/org/landing.ts). React-`cache()`d per request so the layout's call and the page's call
 * collapse into one query, the repo's convention for shell+page shared reads.
 *
 * Deliberately NOT `listOpsState` — that pulls every watched repo's latest scan and its open
 * recommendations to build the triage ranking, which would be an absurd tax to pay for one boolean.
 */
export const countInFlightPrs = cache(async (orgSlug: string): Promise<number> => {
  if (!isDbConfigured()) return 0;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return 0;
  return getPrisma().improvementPr.count({ where: { orgId: org.id, state: "open" } });
});

export type OpsAcceptResult =
  | { kind: "ok"; item: OpsPrItem; reused: boolean }
  | { kind: "not-found" }
  | { kind: "no-practice" }
  | { kind: "no-install" };

/**
 * Accept a triaged direction: mark the recommendation in_progress (backlog + timeline stay in
 * sync), open the practice-starter draft PR (or the mock stand-in), and persist the ImprovementPr
 * row that the monitor/verify passes advance. Throws AppApiError/GitHubError for the route to map.
 */
export async function acceptDirection(orgSlug: string, recommendationId: string, actor: string | null): Promise<OpsAcceptResult> {
  if (!isDbConfigured()) return { kind: "not-found" };
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return { kind: "not-found" };

  const rec = await prisma.recommendation.findUnique({
    where: { id: recommendationId },
    select: {
      id: true,
      dimId: true,
      title: true,
      scan: { select: { repo: { select: { id: true, orgId: true, owner: true, name: true, fullName: true } } } },
    },
  });
  const repo = rec?.scan?.repo;
  if (!rec || !repo || repo.orgId !== org.id) return { kind: "not-found" }; // tenant chain must hold

  const practice = PRACTICE_BY_DIM.get(rec.dimId);
  if (!practice) return { kind: "no-practice" };

  // Baseline bookend: the repo's latest scan as of acceptance — impact is measured against this.
  const baselineScan = await prisma.scan.findFirst({
    where: { repoId: repo.id },
    orderBy: { scannedAt: "desc" },
    select: { id: true },
  });

  let pr: { url: string; number: number; reused: boolean };
  if (mockPrsEnabled()) {
    const existing = await prisma.improvementPr.findUnique({
      where: { orgId_repoFullName_practiceId: { orgId: org.id, repoFullName: repo.fullName, practiceId: practice.id } },
    });
    const number = existing?.prNumber ?? 9000 + (await prisma.improvementPr.count({ where: { orgId: org.id } }));
    pr = { url: `https://github.com/${repo.fullName}/pull/${number}`, number, reused: Boolean(existing && existing.state === "open") };
  } else {
    const installId = await getInstallationIdForOwner(repo.owner.toLowerCase()).catch(() => null);
    if (!installId) return { kind: "no-install" };
    const token = await getInstallationToken(installId);
    const result = await applyPracticeToRepo(
      token,
      { owner: repo.owner, repo: repo.name },
      practice.id,
      undefined,
      { orgId: org.id, actorId: actor ?? undefined },
      // W6 — a direction accepted on the war-room wall ships the org's own pattern too, not a
      // generic starter, whenever one has been mined.
      { orgSlug },
    );
    if (result.kind === "unknown-practice") return { kind: "no-practice" };
    // No fingerprint is passed on this path (there is no preview step here), so content-drift is
    // unreachable — narrowed explicitly to keep the union exhaustive.
    if (result.kind === "content-drift") return { kind: "no-practice" };
    pr = result.pr;
  }

  const row = await prisma.improvementPr.upsert({
    where: { orgId_repoFullName_practiceId: { orgId: org.id, repoFullName: repo.fullName, practiceId: practice.id } },
    create: {
      orgId: org.id,
      repoFullName: repo.fullName,
      practiceId: practice.id,
      dimId: rec.dimId,
      recommendationId: rec.id,
      prNumber: pr.number,
      prUrl: pr.url,
      state: "open",
      baselineScanId: baselineScan?.id ?? null,
      openedBy: actor,
    },
    // Re-accept after a GitHub-close (or a reused open PR): re-arm the row for a fresh cycle.
    update: {
      recommendationId: rec.id,
      prNumber: pr.number,
      prUrl: pr.url,
      state: "open",
      mergedAt: null,
      closedAt: null,
      verifiedScanId: null,
      impactDim: null,
      impactOverall: null,
      baselineScanId: baselineScan?.id ?? null,
      openedBy: actor,
    },
  });

  await updateRecommendation(rec.id, { status: "in_progress" }, { actor, note: `accepted on the live wall — PR #${pr.number}` });
  return { kind: "ok", item: toPrItem(row), reused: pr.reused };
}

/**
 * Record a PRACTICE-ORIGIN starter PR onto the SAME ImprovementPr lifecycle the war room drives —
 * the practices page's apply flow (single + batch) used to end at an audit row, so the most
 * companion-like action in the product left no trace on the page that offered it. Reusing this table
 * (rather than a parallel tracker) means `refreshOps` already polls these PRs to merged/closed and
 * `verifyMergedPrs` already stamps their measured impact; the practices projection just reads it.
 *
 * The origin discriminator is the EXISTING nullable `recommendationId` column, whose schema comment
 * already reads "null = other surfaces" — no migration.
 *
 * Never throws: the PR is already open on GitHub by the time this runs, so a DB hiccup must not turn
 * a successful apply into an error (same contract as recordAudit). Returns whether the row landed.
 */
export async function recordPracticePr(input: {
  orgId: string;
  repoFullName: string;
  practiceId: string;
  prNumber: number;
  prUrl: string;
  openedBy?: string | null;
}): Promise<boolean> {
  if (!isDbConfigured()) return true;
  const practice = PRACTICES.find((p) => p.id === input.practiceId);
  if (!practice) return false; // an authored/unknown practice has no dimension to measure impact on
  try {
    const prisma = getPrisma();
    const key = {
      orgId_repoFullName_practiceId: {
        orgId: input.orgId,
        repoFullName: input.repoFullName,
        practiceId: input.practiceId,
      },
    };
    const existing = await prisma.improvementPr.findUnique({ where: key, select: { id: true, state: true } });

    // Impact bookend: the repo's standing as of THIS apply. Resolved per-apply (not reused from an
    // older cycle) so a re-opened PR is measured against what the repo looks like now.
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId: input.orgId, fullName: input.repoFullName } },
      select: { id: true },
    });
    const baselineScanId = repo
      ? (await prisma.scan.findFirst({ where: { repoId: repo.id }, orderBy: { scannedAt: "desc" }, select: { id: true } }))?.id ?? null
      : null;

    if (!existing) {
      await prisma.improvementPr.create({
        data: {
          orgId: input.orgId,
          repoFullName: input.repoFullName,
          practiceId: input.practiceId,
          dimId: practice.dimId,
          recommendationId: null, // practice-origin (not triaged on the wall)
          prNumber: input.prNumber,
          prUrl: input.prUrl,
          state: "open",
          baselineScanId,
          openedBy: input.openedBy ?? null,
        },
      });
      return true;
    }

    // An already-open row is the SAME PR (openDraftPr reuses the per-repo `ascent/<practice>` branch)
    // — refresh its coordinates without disturbing the in-flight cycle's baseline. A merged/closed row
    // means a NEW cycle for this repo × practice: re-arm it exactly as acceptDirection does, so the
    // previous cycle's measured impact can't be misread as this PR's.
    await prisma.improvementPr.update({
      where: { id: existing.id },
      data:
        existing.state === "open"
          ? { prNumber: input.prNumber, prUrl: input.prUrl, openedBy: input.openedBy ?? null }
          : {
              prNumber: input.prNumber,
              prUrl: input.prUrl,
              state: "open",
              mergedAt: null,
              closedAt: null,
              verifiedScanId: null,
              impactDim: null,
              impactOverall: null,
              baselineScanId,
              openedBy: input.openedBy ?? null,
            },
    });
    return true;
  } catch (err) {
    console.error("[db] recordPracticePr FAILED — the starter PR is open but untracked", {
      repo: input.repoFullName,
      practiceId: input.practiceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** Reject a triaged direction: dismiss the recommendation (with a timeline event). */
export async function rejectDirection(orgSlug: string, recommendationId: string, actor: string | null): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return false;
  const rec = await prisma.recommendation.findUnique({
    where: { id: recommendationId },
    select: { id: true, scan: { select: { repo: { select: { orgId: true } } } } },
  });
  if (!rec || rec.scan?.repo?.orgId !== org.id) return false;
  await updateRecommendation(rec.id, { status: "dismissed" }, { actor, note: "rejected on the live wall" });
  return true;
}

/**
 * One monitor tick, driven by the visible wall: read the state of in-flight PRs (bounded), persist
 * open→merged/closed transitions, then verify any merged PR whose post-merge scan has landed
 * (impact = first scan after mergedAt vs the baseline scan). Returns the repos that JUST merged so
 * the wall can fire its scoped verify rescan + celebration.
 */
export async function refreshOps(orgSlug: string): Promise<{ newlyMerged: string[] } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const open = await prisma.improvementPr.findMany({
    where: { orgId: org.id, state: "open" },
    orderBy: { createdAt: "asc" },
    take: REFRESH_MAX,
  });

  const now = new Date();
  const newlyMerged: string[] = [];
  const mock = mockPrsEnabled();
  // One token per owner (repos in an org can span owners after renames/transfers).
  const tokens = new Map<string, string | null>();

  for (const row of open) {
    try {
      if (mock) {
        if (!mockPrShouldMerge(row.createdAt, now)) continue;
        await prisma.improvementPr.update({
          where: { id: row.id },
          data: { state: "merged", mergedAt: new Date(row.createdAt.getTime() + MOCK_MERGE_MS) },
        });
        newlyMerged.push(row.repoFullName);
        continue;
      }
      const [owner, name] = row.repoFullName.split("/");
      if (!owner || !name) continue;
      if (!tokens.has(owner)) {
        const installId = await getInstallationIdForOwner(owner.toLowerCase()).catch(() => null);
        tokens.set(owner, installId ? await getInstallationToken(installId).catch(() => null) : null);
      }
      const token = tokens.get(owner);
      if (!token) continue; // installation gone — leave the row; a later tick may recover
      const pr = await getPullRequest(token, owner, name, row.prNumber);
      if (pr.merged) {
        await prisma.improvementPr.update({
          where: { id: row.id },
          data: { state: "merged", mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : now },
        });
        newlyMerged.push(row.repoFullName);
      } else if (pr.state === "closed") {
        await prisma.improvementPr.update({
          where: { id: row.id },
          data: { state: "closed", closedAt: pr.closedAt ? new Date(pr.closedAt) : now },
        });
      }
    } catch {
      // One PR's poll failure must not stall the tick — the next poll retries it.
    }
  }

  await verifyMergedPrs(org.id);
  return { newlyMerged };
}

/** Stamp impact onto merged-but-unverified PRs whose post-merge rescan has landed. */
async function verifyMergedPrs(orgId: string): Promise<void> {
  const prisma = getPrisma();
  const pending = await prisma.improvementPr.findMany({
    where: { orgId, state: "merged", verifiedScanId: null },
    take: REFRESH_MAX,
  });
  for (const row of pending) {
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId, fullName: row.repoFullName } },
      select: { id: true },
    });
    if (!repo || !row.mergedAt) continue;
    const scanSelect = { id: true, overallScore: true, dimensions: { select: { dimId: true, score: true } } } as const;
    let after = await prisma.scan.findFirst({
      where: { repoId: repo.id, scannedAt: { gt: row.mergedAt } },
      orderBy: { scannedAt: "asc" },
      select: scanSelect,
    });
    // Mock-PR mode: the "merge" is simulated, so the repo's REAL head never moves and a post-merge
    // scan row may never exist (persistScanReport dedups per commit). Verifying against the current
    // standing closes the demo loop with an honest ±0 — nothing actually changed in the repo. A real
    // merge always moves the head (merge commit), so production never takes this branch.
    if (!after && mockPrsEnabled()) {
      after = await prisma.scan.findFirst({ where: { repoId: repo.id }, orderBy: { scannedAt: "desc" }, select: scanSelect });
    }
    if (!after) continue; // awaiting rescan
    const before = row.baselineScanId
      ? await prisma.scan.findUnique({
          where: { id: row.baselineScanId },
          select: { overallScore: true, dimensions: { select: { dimId: true, score: true } } },
        })
      : null;
    const impact = computePrImpact(
      row.dimId,
      before ? { overall: before.overallScore, dims: before.dimensions } : null,
      { overall: after.overallScore, dims: after.dimensions },
    );
    await prisma.improvementPr.update({
      where: { id: row.id },
      data: { verifiedScanId: after.id, impactDim: impact.impactDim, impactOverall: impact.impactOverall },
    });
  }
}
