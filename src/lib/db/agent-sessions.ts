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

const COUNTERS = ["tokens", "costCents", "commits", "pullRequests", "linesAdded", "linesRemoved"] as const;

function counterUpdate(s: AgentSessionInput) {
  return Object.fromEntries(COUNTERS.map((k) => [k, s.cumulative ? s[k] : { increment: s[k] }]));
}

/**
 * Upsert a batch of attempts.
 *
 * How counters update follows the export's declared TEMPORALITY (`s.cumulative`, decoded from
 * `sum.aggregationTemporality`). Claude Code's exporter defaults to DELTA: each export, every 60 s,
 * carries only that interval's increments, so they are ADDED, exactly like `recordUsage`'s day
 * buckets over the same body. An exporter set to cumulative carries running totals, which are SET,
 * because adding them would multiply a long session by its export count. Until 2026-09-15 this
 * always set, which under the default kept only a session's last minute (a two-export session of
 * 1000 + 500 tokens stored 500; `agent-sessions.temporality.test.ts`). `startedAt` keeps the earliest
 * timestamp ever seen and `lastSeenAt` the latest, so a session spanning several exports reads as one
 * attempt.
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
        // Cumulative: take the LATEST running total. Delta: add this interval. `startedAt` is never
        // touched, so the earliest timestamp survives either way.
        lastSeenAt: s.lastSeenAt,
        ...counterUpdate(s),
      },
    });
    written += 1;
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE ROLLUP IS KEYED BY REPO × SOURCE (2026-09-15).
//
// `linesAdded` and `tokens` are PRODUCER-DEFINED units. Claude Code reports its own lines metric; a
// tool that re-serialises the whole file after each edit counts the unchanged body again, and a
// ranged-replace tool under-counts; tokenisers differ per vendor. 100 lines from one provider plus 100
// from another is not 200 of anything, and publishing that sum is the precise-looking heuristic D32
// forbids. So a row never spans sources, and totals carry only what IS one unit across producers:
// attempts (sessions), sessions that produced code, and cost in cents (one currency).
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Attempt aggregates for one repo from ONE source over a window. */
export interface RepoAttempts {
  repoFullName: string;
  /** The emitter ("claude-code", ...). Part of the key: lines and tokens below are in its units only. */
  source: string;
  sessions: number;
  /** Sessions that produced at least one commit or pull request. */
  producedCode: number;
  costCents: number;
  /** In this source's tokeniser. Never add across sources. */
  tokens: number;
  /** By this source's counting method. Never add across sources. */
  linesAdded: number;
  /** Distinct users who ran a session here. */
  people: number;
}

/**
 * Cross-source totals: only figures in a unit every producer shares. There is deliberately no
 * `tokens` or `linesAdded` here; a caller that wants one must pick a source.
 */
export interface AttemptTotals {
  sessions: number;
  producedCode: number;
  costCents: number;
  /** Distinct (source, userKey) pairs: user keys are not comparable across exporters, so an upper bound. */
  people: number;
}

export interface AttemptRollup {
  repos: RepoAttempts[];
  totals: AttemptTotals;
  /** Earliest / latest session observed — the window actually covered. */
  from: string | null;
  to: string | null;
}

/** Pure fold over session rows. Exported for tests. */
export function buildAttemptRollup(
  rows: {
    source: string;
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
  const byKey = new Map<string, RepoAttempts & { userSet: Set<string> }>();
  const allUsers = new Set<string>();
  let from: number | null = null;
  let to: number | null = null;

  for (const r of rows) {
    const t = r.startedAt.getTime();
    from = from == null ? t : Math.min(from, t);
    to = to == null ? t : Math.max(to, t);
    // NUL cannot occur in a repo name or a source id, so the key cannot collide.
    const key = `${r.repoFullName}\u0000${r.source}`;
    const e =
      byKey.get(key) ??
      ({
        repoFullName: r.repoFullName,
        source: r.source,
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
      allUsers.add(`${r.source}\u0000${r.userKey}`);
    }
    byKey.set(key, e);
  }

  const repos = [...byKey.values()]
    .map(({ userSet, ...rest }) => ({ ...rest, people: userSet.size }))
    .sort(
      (a, b) =>
        b.costCents - a.costCents || a.repoFullName.localeCompare(b.repoFullName) || a.source.localeCompare(b.source),
    );

  return {
    repos,
    totals: {
      sessions: repos.reduce((n, r) => n + r.sessions, 0),
      producedCode: repos.reduce((n, r) => n + r.producedCode, 0),
      costCents: repos.reduce((n, r) => n + r.costCents, 0),
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
      source: true, // part of the rollup key: lines and tokens are only comparable within one source
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
  // The rollup is repo × source; the join is repo × period. Fold back to one row per repo so the
  // denominator is applied ONCE (per source it would count each merged change once per provider).
  // Only sessions, producedCode and cents are summed — the units every source shares.
  const byRepo = new Map<string, { sources: string[]; sessions: number; producedCode: number; costCents: number }>();
  for (const r of rollup.repos) {
    const e = byRepo.get(r.repoFullName) ?? { sources: [], sessions: 0, producedCode: 0, costCents: 0 };
    e.sources.push(r.source);
    e.sessions += r.sessions;
    e.producedCode += r.producedCode;
    e.costCents += r.costCents;
    byRepo.set(r.repoFullName, e);
  }
  return [...byRepo.entries()]
    .map(([repoFullName, r]) => {
      const merged = mergedByRepo.get(repoFullName) ?? 0;
      return {
        repoFullName,
        sources: [...r.sources].sort(),
        sessions: r.sessions,
        producedCode: r.producedCode,
        costCents: r.costCents,
        producedRate: r.sessions > 0 ? Math.round((r.producedCode / r.sessions) * 100) : null,
        costPerProducingSession: r.producedCode > 0 ? Math.round(r.costCents / r.producedCode) : null,
        costPerMergedAiChange: merged > 0 ? Math.round(r.costCents / merged) : null,
        mergedAiChanges: merged,
      };
    })
    .sort((a, b) => b.costCents - a.costCents || a.repoFullName.localeCompare(b.repoFullName));
}
