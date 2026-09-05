// Agent attempts: persistence + the two reads they unlock (W3a).
//
// THE METRIC THIS EXISTS FOR. Port's AI-SDLC research is blunt that only ~a third of engineering
// leaders report meaningful AI ROI, and names the cause: they measure ADOPTION (seats, sessions,
// tokens) instead of OUTCOMES. The arithmetic that fixes it needs a denominator no day-bucketed
// usage table can supply — agents cost per ATTEMPT, so a 30% failure rate makes the real cost per
// completed task ~1.43× the naive figure. `AgentSession` is the attempt; this module is the
// arithmetic.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE JOIN, AND WHY IT IS AT REPO × PERIOD RATHER THAN PER PR.
//
// The obvious design is "link each session to the PR it produced, then divide". Claude Code's
// telemetry carries no PR number, so that link would have to be inferred from repo + time proximity
// — a heuristic. A heuristic wearing a precise number's clothes ("this PR cost $4.12") is exactly
// the defect docs/VALUE-CASE.md D32 was written against, and it would be the FIRST number a
// skeptical buyer tries to falsify.
//
// So the join is made where both sides are COUNTED, not guessed: total agent spend in a repo over a
// period ÷ AI-attributed merged PRs in that same repo over that same period. That is an allocation,
// it is labelled as one, and it is defensible line by line.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import type { AgentSessionInput } from "@/lib/integrations/sessions";

/**
 * Upsert a batch of attempts.
 *
 * Counters are SET, not incremented — the opposite of `recordUsage`'s day-bucket semantics, and the
 * difference matters. Claude Code's exporter emits CUMULATIVE per-session counters, so each export
 * carries the session's running totals; adding them would multiply a long session's cost by the
 * number of times it was exported. `startedAt` keeps the earliest timestamp ever seen and
 * `lastSeenAt` the latest, so a session spanning several exports reads as one attempt.
 */
export async function recordAgentSessions(orgSlug: string, sessions: AgentSessionInput[]): Promise<number> {
  if (!isDbConfigured() || sessions.length === 0) return 0;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return 0;
  const prisma = getPrisma();

  let written = 0;
  for (const s of sessions) {
    await prisma.agentSession.upsert({
      where: { orgId_source_sessionId: { orgId: org.id, source: s.source, sessionId: s.sessionId } },
      create: {
        orgId: org.id,
        source: s.source,
        sessionId: s.sessionId,
        repoFullName: s.repoFullName,
        userKey: s.userKey,
        startedAt: s.startedAt,
        lastSeenAt: s.lastSeenAt,
        tokens: s.tokens,
        costCents: s.costCents,
        commits: s.commits,
        pullRequests: s.pullRequests,
        linesAdded: s.linesAdded,
        linesRemoved: s.linesRemoved,
      },
      update: {
        // Cumulative counters: take the LATEST reported value, and never move a timestamp backwards
        // past what we already recorded.
        lastSeenAt: s.lastSeenAt,
        tokens: s.tokens,
        costCents: s.costCents,
        commits: s.commits,
        pullRequests: s.pullRequests,
        linesAdded: s.linesAdded,
        linesRemoved: s.linesRemoved,
      },
    });
    written += 1;
  }
  return written;
}

/** Per-repo attempt aggregates over a window. */
export interface RepoAttempts {
  repoFullName: string;
  sessions: number;
  /** Sessions that produced at least one commit or pull request. */
  producedCode: number;
  costCents: number;
  tokens: number;
  linesAdded: number;
  /** Distinct users who ran a session here. */
  people: number;
}

export interface AttemptRollup {
  repos: RepoAttempts[];
  totals: { sessions: number; producedCode: number; costCents: number; tokens: number; people: number };
  /** Earliest / latest session observed — the window actually covered. */
  from: string | null;
  to: string | null;
}

/** Pure fold over session rows. Exported for tests. */
export function buildAttemptRollup(
  rows: {
    repoFullName: string;
    userKey: string | null;
    startedAt: Date;
    tokens: number;
    costCents: number;
    commits: number;
    pullRequests: number;
    linesAdded: number;
  }[],
): AttemptRollup {
  const byRepo = new Map<string, RepoAttempts & { userSet: Set<string> }>();
  const allUsers = new Set<string>();
  let from: number | null = null;
  let to: number | null = null;

  for (const r of rows) {
    const t = r.startedAt.getTime();
    from = from == null ? t : Math.min(from, t);
    to = to == null ? t : Math.max(to, t);
    const e =
      byRepo.get(r.repoFullName) ??
      ({
        repoFullName: r.repoFullName,
        sessions: 0,
        producedCode: 0,
        costCents: 0,
        tokens: 0,
        linesAdded: 0,
        people: 0,
        userSet: new Set<string>(),
      } as RepoAttempts & { userSet: Set<string> });
    e.sessions += 1;
    if (r.commits > 0 || r.pullRequests > 0) e.producedCode += 1;
    e.costCents += r.costCents;
    e.tokens += r.tokens;
    e.linesAdded += r.linesAdded;
    if (r.userKey) {
      e.userSet.add(r.userKey);
      allUsers.add(r.userKey);
    }
    byRepo.set(r.repoFullName, e);
  }

  const repos = [...byRepo.values()]
    .map(({ userSet, ...rest }) => ({ ...rest, people: userSet.size }))
    .sort((a, b) => b.costCents - a.costCents || a.repoFullName.localeCompare(b.repoFullName));

  return {
    repos,
    totals: {
      sessions: repos.reduce((n, r) => n + r.sessions, 0),
      producedCode: repos.reduce((n, r) => n + r.producedCode, 0),
      costCents: repos.reduce((n, r) => n + r.costCents, 0),
      tokens: repos.reduce((n, r) => n + r.tokens, 0),
      people: allUsers.size,
    },
    from: from == null ? null : new Date(from).toISOString(),
    to: to == null ? null : new Date(to).toISOString(),
  };
}

/** Attempt aggregates for `orgSlug` over `[start, end]`. Null when there is no DB / no org. */
export async function getAgentAttempts(
  orgSlug: string,
  window: { start: Date | null; end: Date | null },
): Promise<AttemptRollup | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const startedAt: { gte?: Date; lte?: Date } = {};
  if (window.start) startedAt.gte = window.start;
  if (window.end) startedAt.lte = window.end;

  const rows = await getPrisma().agentSession.findMany({
    where: { orgId: org.id, ...(startedAt.gte || startedAt.lte ? { startedAt } : {}) },
    select: {
      repoFullName: true,
      userKey: true,
      startedAt: true,
      tokens: true,
      costCents: true,
      commits: true,
      pullRequests: true,
      linesAdded: true,
    },
  });

  return buildAttemptRollup(rows);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Cost per unit of work
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The two costs an org actually wants, and the honest reasons either can be unknowable. */
export interface UnitEconomics {
  repoFullName: string;
  sessions: number;
  producedCode: number;
  costCents: number;
  /**
   * Share of sessions that produced a commit or PR. NOT a success rate: a session with no commit is
   * frequently a question, a code read or a debugging pass. Named for what it measures.
   */
  producedRate: number | null;
  /** Cost ÷ sessions that produced code. Null when none did — never a division that reads as ∞ or 0. */
  costPerProducingSession: number | null;
  /**
   * Cost ÷ AI-attributed merged PRs in the SAME repo and period (an allocation, not a per-PR
   * attribution — see the module header). Null when the repo merged no AI-attributed PR in the
   * window, which is "no denominator", not "free".
   */
  costPerMergedAiChange: number | null;
  /** The denominator, so the number above can be judged rather than trusted. */
  mergedAiChanges: number;
}

/**
 * Join attempts to merged AI-attributed changes at repo × period. Pure — both sides are passed in,
 * so the arithmetic is testable and the caller owns the reads.
 *
 * `mergedByRepo` keys must be lower-cased full names, matching `AgentSession.repoFullName`'s folding.
 */
export function buildUnitEconomics(rollup: AttemptRollup, mergedByRepo: Map<string, number>): UnitEconomics[] {
  return rollup.repos.map((r) => {
    const merged = mergedByRepo.get(r.repoFullName) ?? 0;
    return {
      repoFullName: r.repoFullName,
      sessions: r.sessions,
      producedCode: r.producedCode,
      costCents: r.costCents,
      producedRate: r.sessions > 0 ? Math.round((r.producedCode / r.sessions) * 100) : null,
      costPerProducingSession: r.producedCode > 0 ? Math.round(r.costCents / r.producedCode) : null,
      costPerMergedAiChange: merged > 0 ? Math.round(r.costCents / merged) : null,
      mergedAiChanges: merged,
    };
  });
}
