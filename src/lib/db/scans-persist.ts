// The scan-report persistence path: org -> repository -> scan graph + contributors + audit, written
// atomically and made race/retry-safe for concurrent same-repo scans on a distributed store.

import type { ScanReport } from "@/lib/types";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured, withDb, withRetry } from "@/lib/db/client";
import { cacheDelete, makeCacheKey } from "@/lib/cache";
import {
  DEFAULT_ORG_SLUG,
  ensureOrgId,
  upsertRacing,
  withRepoLock,
} from "@/lib/db/scans-shared";
import { findScanByCommit } from "@/lib/db/scans-read";

/** Outcome of persisting a scan report — surfaces dedup and partial-write failures. */
export interface PersistResult {
  scanId: string;
  /** True when an existing scan for this exact commit was reused — no new Scan row was
   *  created (so no redundant LLM persistence and no double usage-based billing). */
  deduped: boolean;
  /** The commit SHA the returned scan is pinned to (null when the source had none). */
  headSha: string | null;
  /** Per-area write failures. Persistence is now atomic — the scan graph, contributor upserts, and
   *  the audit entry commit in one transaction — so a returned result means everything was written:
   *  these stay at no-failure on success, and a partial failure surfaces as a thrown error (the
   *  whole scan rolls back) instead. Retained for backward compatibility with callers that still
   *  inspect them. */
  failures: { audit: boolean; contributors: number };
}

/**
 * Persist a scan report (org -> repository -> scan -> dimensions + recommendations) and
 * write an audit entry. Returns a PersistResult, or null if persistence is disabled.
 *
 * Deduplicates by commit SHA: if a scan for this repo at the same HEAD already exists,
 * it is reused and NO new row is written — avoiding redundant LLM persistence and a
 * second usage-based charge for an unchanged commit (`deduped: true`).
 *
 * Race-safe, retry-safe, and atomic:
 *  - The org is resolved once per process and cached (`ensureOrgId`) instead of upserting the shared
 *    'public' row on every scan — removing the hot-row write that made concurrent scans collide.
 *  - The repo upsert runs through `upsertRacing`, so a concurrent scan creating the SAME new repo
 *    loses with a P2002 instead of throwing an unhandled 500 — the loser re-reads the row.
 *  - Every write is wrapped in `withRetry`, so a DSQL serialization/OCC conflict at commit — the
 *    expected outcome of real concurrency on a distributed, lock-free store — is retried with
 *    exponential backoff + jitter instead of bubbling up as a failed 500 with no scan saved.
 *  - The dedup + carry-forward read + write run under a per-repo lock (`withRepoLock`), so two scans
 *    of the same repo can't both read the same "previous" snapshot and double-insert.
 *  - The scan graph (scan + dimensions + recommendations), the contributor upserts, and the audit
 *    entry are written in ONE interactive transaction — so a crash mid-way can't leave a scan with
 *    no contributors or no audit row. A failure rolls the whole scan back (surfaced as a throw).
 */
export async function persistScanReport(
  report: ScanReport,
  opts: { orgSlug?: string; actorId?: string; headEtag?: string | null } = {},
): Promise<PersistResult | null> {
  if (!isDbConfigured()) return null;
  // Run the whole persist under withDb so a DSQL IAM-token expiry (token TTL ~15min; a frozen
  // serverless instance can thaw past it) is recovered: withDb proactively refreshes a stale token
  // before the op and reconnects + retries once on an auth-expiry error — instead of 500ing with the
  // scan unsaved. On reconnect the singleton is swapped, so the inner getPrisma()/withRetry/tx pick
  // up the fresh client on the retried run. Inert in static/local-Postgres mode (no DSQL config →
  // the op simply runs once, unchanged). (Body indentation kept as-is to keep the diff reviewable.)
  return withDb(async () => {
  const prisma = getPrisma();
  const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
  const headSha = report.repo.headSha ?? null;
  const fullName = `${report.repo.owner}/${report.repo.name}`;

  // Resolve the org id once per process (ensureOrgId) instead of upserting the shared 'public' row
  // on every scan — that hot-row write made concurrent scans collide and, under DSQL's optimistic
  // concurrency, fail their commits with a retryable serialization conflict. The repo upsert below
  // still runs per scan (one row per repo, not a shared hot row), but goes through upsertRacing (for
  // the create race) wrapped in withRetry (for a genuine cross-scan OCC conflict on it).
  const orgId = await ensureOrgId(orgSlug);

  // Refresh the repo's head pointer + conditional-request ETag (the durable, cross-instance
  // copy of the in-memory head hint). `undefined` means "leave as-is": a token/private scan
  // carries no public ETag, so it must not clobber the one a public scan stored.
  const repoWhere: Prisma.RepositoryWhereUniqueInput = { orgId_fullName: { orgId, fullName } };
  const repoUpdate: Prisma.RepositoryUpdateInput = {
    url: report.repo.url,
    primaryLanguage: report.repo.primaryLanguage ?? null,
    stars: report.repo.stars,
    isPrivate: report.repo.isPrivate ?? false,
    lastScanAt: new Date(report.scannedAt),
    headSha: headSha ?? undefined,
    headEtag: opts.headEtag ?? undefined,
  };
  const repo = await withRetry(
    () =>
      upsertRacing(
        () =>
          prisma.repository.upsert({
            where: repoWhere,
            update: repoUpdate,
            create: {
              orgId,
              owner: report.repo.owner,
              name: report.repo.name,
              fullName,
              url: report.repo.url,
              isPrivate: report.repo.isPrivate ?? false,
              primaryLanguage: report.repo.primaryLanguage ?? null,
              stars: report.repo.stars,
              lastScanAt: new Date(report.scannedAt),
              headSha,
              headEtag: opts.headEtag ?? null,
            },
          }),
        // Lost the create race: the row exists now — apply our update branch to it (upsert semantics).
        () => prisma.repository.update({ where: repoWhere, data: repoUpdate }),
      ),
    { label: "persistScanReport:repo" },
  );

  // Serialize the read-decide-write section per repo so two concurrent scans of the same repo can't
  // both read the same "previous" scan and both insert. The second caller waits, then sees the
  // first's committed scan — dedup catches an identical commit, and carry-forward reads a stable
  // snapshot. (Process-local + best-effort; cross-instance races fall back to the dedup + tx below.)
  return withRepoLock(repo.id, () => withRetry(async () => {
    // Dedup: if this exact commit was already scored, reuse it — no second (metered) Scan row. The
    // repo's metadata + lastScanAt were already refreshed above (so the UI still shows "up to date").
    if (headSha) {
      const existing = await findScanByCommit(repo.id, headSha);
      if (existing) {
        return { scanId: existing.id, deduped: true, headSha, failures: { audit: false, contributors: 0 } };
      }
    }

    // Carry forward recommendation status + ownership (assignee, due date) from this repo's previous
    // scan, so neither progress nor the backlog's planning state is lost on re-scan. Match on
    // dimension + title (stable for mock + low-temp LLM). The per-row event timeline is anchored to
    // the scan's recommendation rows, so it begins fresh each scan while the carried state persists.
    const previous = await prisma.scan.findFirst({
      where: { repoId: repo.id },
      orderBy: { scannedAt: "desc" },
      select: { recommendations: { select: { dimId: true, title: true, status: true, assigneeLogin: true, targetDate: true } } },
    });
    const carry = new Map<string, { status: string; assigneeLogin: string | null; targetDate: Date | null }>();
    for (const r of previous?.recommendations ?? []) {
      carry.set(`${r.dimId}::${r.title}`, { status: r.status, assigneeLogin: r.assigneeLogin, targetDate: r.targetDate });
    }

    // Atomic write: the scan graph (scan + dimensions + recommendations), the contributor upserts,
    // and the audit entry commit together or roll back together — closing the partial-write hole
    // where a crash mid-way left a scan with no contributors or no audit row.
    const scanId = await prisma.$transaction(
      async (tx) => {
        const scan = await tx.scan.create({
          data: {
            repoId: repo.id,
            headSha,
            overallScore: report.overallScore,
            level: report.level.id,
            levelName: report.level.name,
            archetype: report.archetype,
            adoptionScore: report.adoptionScore,
            rigorScore: report.rigorScore,
            posture: report.posture.id,
            confidence: report.confidence,
            engineProvider: report.engine.provider,
            engineModel: report.engine.model,
            headline: report.headline,
            strengths: JSON.stringify(report.strengths),
            risks: JSON.stringify(report.risks),
            discrepancies: JSON.stringify(report.discrepancies ?? []),
            prStats: report.prStats ? JSON.stringify(report.prStats) : null,
            governance: report.governance ? JSON.stringify(report.governance) : null,
            commitActivity: report.commitActivity ? JSON.stringify(report.commitActivity) : null,
            inputTokens: report.usage?.inputTokens ?? null,
            outputTokens: report.usage?.outputTokens ?? null,
            llmLatencyMs: report.usage?.latencyMs ?? null,
            scannedAt: new Date(report.scannedAt),
            dimensions: {
              create: report.dimensions.map((d) => ({
                dimId: d.id,
                name: d.name,
                weight: d.weight,
                score: d.score,
                signalScore: d.signalScore,
                llmScore: d.llmScore,
                summary: d.summary,
                evidence: JSON.stringify(d.evidence),
                strengths: JSON.stringify(d.strengths),
                gaps: JSON.stringify(d.gaps),
              })),
            },
            recommendations: {
              create: report.roadmap.map((r) => {
                const carried = carry.get(`${r.dimension}::${r.title}`);
                return {
                  title: r.title,
                  dimId: r.dimension,
                  impact: r.impact,
                  effort: r.effort,
                  rationale: r.rationale,
                  explore: JSON.stringify(r.explore ?? []),
                  levelUnlock: r.levelUnlock ?? null,
                  status: carried?.status ?? "open",
                  assigneeLogin: carried?.assigneeLogin ?? null,
                  targetDate: carried?.targetDate ?? null,
                };
              }),
            },
          },
          select: { id: true },
        });

        // Recent contributors (top 50, with AI-attribution) for org-wide comparison — in the same
        // tx so they share the scan's fate (no orphaned scan with a half-written contributor set).
        for (const c of report.contributors.slice(0, 50)) {
          await tx.repoContributor.upsert({
            where: { repoId_login: { repoId: repo.id, login: c.login } },
            update: {
              name: c.name ?? null,
              commits: c.commits,
              aiCommits: c.aiCommits,
              lastActiveAt: c.lastActiveAt ? new Date(c.lastActiveAt) : null,
            },
            create: {
              repoId: repo.id,
              login: c.login,
              name: c.name ?? null,
              commits: c.commits,
              aiCommits: c.aiCommits,
              lastActiveAt: c.lastActiveAt ? new Date(c.lastActiveAt) : null,
            },
          });
        }

        // CODEOWNERS team attribution (the team rollup's source). The latest scan is authoritative:
        // replace the repo's whole RepoTeam set so a team removed/renamed in CODEOWNERS can't linger
        // in the team rollups. Guarded on `report.teams` being defined — a reconstructed snapshot
        // that never ran ingestion carries no team data, and must not wipe the stored attribution.
        if (report.teams) {
          await tx.repoTeam.deleteMany({ where: { repoId: repo.id } });
          for (const t of report.teams) {
            await tx.repoTeam.create({
              data: {
                repoId: repo.id,
                slug: t.slug,
                ownedPaths: t.ownedPaths,
                isDefaultOwner: t.isDefaultOwner,
              },
            });
          }
        }

        // Audit entry through the same tx, so a scan is never persisted unaudited (the compliance
        // gap the old best-effort write could leave). Mirrors recordAudit's "scan.created" shape.
        await tx.auditLog.create({
          data: {
            action: "scan.created",
            meta: JSON.stringify({
              repo: fullName,
              scanId: scan.id,
              headSha,
              level: report.level.id,
              score: report.overallScore,
            }),
            orgId,
            actorId: opts.actorId ?? null,
          },
        });

        return scan.id;
      },
      // The body does the scan graph plus up to 50 contributor round-trips; the 5s default is too
      // tight over a remote DSQL link, so allow more time (and a longer wait to acquire a connection).
      { timeout: 20_000, maxWait: 10_000 },
    );

    // A fresh=1 re-test of an UNCHANGED commit just wrote this new Scan row, but this instance's
    // scan cache still holds the prior report under the same owner/repo[@sha]::mode key (TTL/LRU
    // only). Drop both providers — pinned and sha-less — so the next read reflects the just-
    // persisted scan instead of the shadowed stale one. Best-effort + process-local, matching the
    // cache's own scope; other warm instances self-correct on TTL.
    const { owner, name } = report.repo;
    for (const useLLM of [true, false]) {
      cacheDelete(makeCacheKey(owner, name, useLLM, headSha));
      cacheDelete(makeCacheKey(owner, name, useLLM));
    }

    return { scanId, deduped: false, headSha, failures: { audit: false, contributors: 0 } };
  }, { label: "persistScanReport:scan" }));
  });
}
