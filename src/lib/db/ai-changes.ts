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
// MOONSHOT #1 — the as-of-merge read. `controlsAt` is the ledger's one-query "what were this repo's
// controls at this instant". Without it the pack could only ever describe the LATEST scan's settings
// and would silently present them as the environment a change merged under.
import { controlsAt } from "@/lib/db/control-observations";

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
  /** MOONSHOT #1 — how the row reached us: "scan" (a PR window paged at scan time) or "webhook" (the
   *  live event stream). Not interchangeable evidence, and an examiner asks which. */
  source: string;
  /** When the approval was OBSERVED — the webhook's delivery time, NOT `approvedAt` (the review's own
   *  submission time). Null on scan-sourced rows: a scan learns of an approval at an unknowable delay,
   *  and stamping the scan's clock here would dress a cadence artifact up as an observation time.
   *  Null is "not observed live", never "not approved". */
  approvalObservedAt: string | null;
}

/** One control's state as the ledger held it at a given instant. */
export interface AsOfControl {
  state: string;
  value: string | null;
}

/**
 * The control environment in force AT AN INSTANT, as opposed to at the latest scan.
 *
 * `source` is the whole point of the type. `ledger` means the ledger held an observation at or
 * before the instant, so this IS the environment that change merged under. `latest-scan` means it
 * did not and the caller substituted the most recent scan's settings — a materially weaker claim,
 * and one the pack prints PER ROW rather than burying in a global footnote.
 */
export interface AsOfEnvironment {
  source: "ledger" | "latest-scan";
  /** When the newest contributing observation was made. Null on the fallback. */
  observedAt: string | null;
  controls: Record<string, AsOfControl>;
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
  /**
   * MOONSHOT #1 — the as-of-merge environment per row, keyed `${repoFullName}#${prNumber}`.
   *
   * Present only for rows the ledger could answer for, and only up to `AS_OF_CAP` resolutions. An
   * absent key is NOT an assertion that the ledger is empty there; the pack falls back per row and
   * labels it, and `asOfAttempted` says how many rows were even looked up.
   */
  asOfByPr: Record<string, AsOfEnvironment>;
  /** How many rows an as-of lookup was attempted for. Published so a reader can tell "no ledger
   *  coverage" apart from "we stopped looking at the cap". */
  asOfAttempted: number;
}

/** Hard ceiling on rows pulled into one pack. Stated in the pack when it bites — never silent. */
export const POPULATION_CAP = 5000;

/**
 * Ceiling on as-of-merge ledger lookups per pack. Each is one indexed query, so an uncapped 5000-row
 * population would be 5000 of them. The cap keeps an export bounded and is STATED in the pack's
 * limitations when it bites, rather than quietly downgrading part of the period to latest-scan
 * evidence with no indication why.
 *
 * Only MERGED rows are resolved. An unmerged change's verdict is `not-applicable` — the pre-merge
 * control was never due to operate on it — so the environment it would have merged under evidences
 * nothing.
 */
export const AS_OF_CAP = 500;

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
      source: true,
      approvalObservedAt: true,
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
    source: r.source,
    approvalObservedAt: r.approvalObservedAt ? r.approvalObservedAt.toISOString() : null,
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

  // The as-of-merge read. `changes` is already in stable created-at order, so when the cap bites it
  // is the NEWEST rows that fall back — the ones a reader is most likely to be able to check against
  // the live repository themselves.
  const mergedRows = changes.filter((c) => c.state === "MERGED").slice(0, AS_OF_CAP);
  const asOfByPr: Record<string, AsOfEnvironment> = {};
  for (const c of mergedRows) {
    const at = c.mergedAt ?? c.createdAt;
    const rows = await controlsAt(orgSlug, c.repoFullName, at).catch(() => []);
    // No observation at or before the merge instant: the ledger does NOT cover this row. Leave the
    // key absent so the pack falls back and says so, rather than writing an empty `controls: {}` that
    // would read as "we checked and there were no controls".
    if (rows.length === 0) continue;
    const controls: Record<string, AsOfControl> = {};
    for (const r of rows) controls[r.controlId] = { state: r.state, value: r.value };
    asOfByPr[`${c.repoFullName}#${c.prNumber}`] = {
      source: "ledger",
      // The newest contributing observation — i.e. how fresh the freshest part of this environment is.
      observedAt: rows.reduce<string | null>((max, r) => (max === null || r.occurredAt > max ? r.occurredAt : max), null),
      controls,
    };
  }

  return {
    changes,
    environments,
    observedFrom: changes[0]?.createdAt ?? null,
    observedTo: changes[changes.length - 1]?.createdAt ?? null,
    asOfByPr,
    asOfAttempted: mergedRows.length,
  };
}

// ── MOONSHOT #1 — the LIVE half: an AiChange row written from the event stream ───────────────────

/** What a webhook delivery can tell us about one pull request. Every field is what GitHub named in
 *  the payload; nothing here is inferred. */
export interface LiveAiChangeInput {
  repoFullName: string;
  prNumber: number;
  title: string;
  authorLogin: string | null;
  authorIsBot: boolean;
  aiSignal: string;
  aiTools: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  approved: boolean;
  approverLogin: string | null;
  /** The review's OWN submission time. */
  approvedAt: string | null;
  /** When WE observed the approval — the delivery's arrival. */
  approvalObservedAt: string | null;
}

/**
 * Upsert one AI-attributed change observed LIVE, on the same `@@unique([repoId, prNumber])` identity
 * the scan path uses. Best-effort; returns whether a row was written.
 *
 * ── The one rule that makes this safe to interleave with scans ───────────────────────────────────
 *
 * A LATER SCAN NEVER DOWNGRADES A WEBHOOK-OBSERVED APPROVAL, and this writer never downgrades one
 * either. `approved` is only ever set to `true` here; an update carrying `approved: false` writes
 * nothing to that column. The reason is asymmetric evidence: observing an approval is proof it
 * happened, while NOT observing one is only proof we did not see it — a scan whose PR window has
 * slid past the review, or a delivery we missed, would otherwise erase a true approval and turn a
 * governed change into an audit finding. The scan path remains authoritative for withdrawal because
 * it re-reads the whole review set rather than a single event.
 *
 * A repository we have never scanned has no `Repository` row, and this deliberately does NOT create
 * one: an AiChange with no scan behind it would enter the conformance population as evidence from a
 * repository the product has never assessed.
 */
export async function upsertLiveAiChange(orgSlug: string, input: LiveAiChangeInput): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const org = await getOrgBySlug(orgSlug).catch(() => null);
  if (!org) return false;
  const prisma = getPrisma();
  const repo = await prisma.repository
    .findUnique({ where: { orgId_fullName: { orgId: org.id, fullName: input.repoFullName } }, select: { id: true } })
    .catch(() => null);
  if (!repo) return false;

  const base = {
    orgId: org.id,
    title: input.title,
    authorLogin: input.authorLogin,
    authorIsBot: input.authorIsBot,
    aiSignal: input.aiSignal,
    aiTools: input.aiTools,
    state: input.state,
    mergedAt: input.mergedAt ? new Date(input.mergedAt) : null,
    mergeCommitSha: input.mergeCommitSha,
    source: "webhook",
  };
  // The approval half, applied ONLY when this delivery carries one — see the asymmetry note above.
  const approval = input.approved
    ? {
        approved: true,
        approverLogin: input.approverLogin,
        approvedAt: input.approvedAt ? new Date(input.approvedAt) : null,
        approvalObservedAt: input.approvalObservedAt ? new Date(input.approvalObservedAt) : null,
      }
    : {};

  try {
    await prisma.aiChange.upsert({
      where: { repoId_prNumber: { repoId: repo.id, prNumber: input.prNumber } },
      create: {
        repoId: repo.id,
        prNumber: input.prNumber,
        ...base,
        // `reviewCount` is left at its default on create: a review EVENT tells us one review exists,
        // not how many. Asserting 1 would make "reviewed, not approved" un-derivable for a PR whose
        // other reviews we never saw. The next scan reads the true count.
        createdAt: new Date(input.createdAt),
        approved: input.approved,
        approverLogin: input.approved ? input.approverLogin : null,
        approvedAt: input.approved && input.approvedAt ? new Date(input.approvedAt) : null,
        approvalObservedAt: input.approved && input.approvalObservedAt ? new Date(input.approvalObservedAt) : null,
      },
      update: { ...base, ...approval },
    });
    return true;
  } catch (err) {
    console.warn("[ai-changes] live upsert failed", err instanceof Error ? err.message : err);
    return false;
  }
}
