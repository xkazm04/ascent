// THE LEDGER'S SERVER LOAD — every read the returning operator's view renders from, in ONE pass, on the
// server (spark theater-upgrade, 2026-09-18).
//
// SERVER-ONLY (it reaches the db layer and git). `LiveTab` calls it; nothing in a client file imports it.
//
// WHY ONE PASS. The "Since you last looked" briefing is derived from what this load ALREADY read —
// zero fetches of its own (`session-resume/delta-briefings`) — so the briefing and the sections it links
// to cannot disagree about what happened: they are filters over the same rows. And each read is caught
// separately and NAMED when it fails (`failed`), so a section can say "could not read" and the briefing
// can say "could not derive" rather than rendering a confident, empty, wrong card.
//
// THE ANCHOR IS SNAPSHOTTED HERE. `liveSeenAt` is read as it was before this render; the stamp the view
// fires five visible seconds later moves the stored value, never this snapshot.

import { listDrives } from "@/lib/local/drive";
import { isDriveLive, type DriveStatus } from "@/lib/local/drive-types";
import { runnerAheadCount } from "@/lib/local/runner-branch";
import { getActiveLoopRun, listLoopRuns } from "@/lib/db/loop-runs";
import { listLoopPlans } from "@/lib/db/loop-plans";
import { listLoopDirections } from "@/lib/db/loop-directions";
import { listRunnerKeptLessons } from "@/lib/db/loop-lessons";
import { listLocalPairings } from "@/lib/db";
import { getLiveSeenAt } from "@/lib/db/live-seen";
import { resolveViewerLogin } from "@/lib/access";
import { hasOrgRole } from "@/lib/authz";
import { selfHosted } from "@/lib/env";
import { CHRONICLE_PAGE } from "./chronicleModel";
import type { LedgerData, LedgerRead } from "./ledgerTypes";

/** Each `git rev-list --count` is bounded by `runGit`'s own timeout; this is the belt over it, so one
 *  wedged checkout costs the page at most this long and renders as "unknown". */
export const AHEAD_TIMEOUT_MS = 5_000;

/** The org's STANDING RUNNER: a continuous drive that has not ended. At most one by construction. */
export function standingRunner(drives: readonly DriveStatus[]): DriveStatus | null {
  return drives.find((d) => d.mode === "continuous" && isDriveLive(d.phase) && d.endedAt == null) ?? null;
}

/** Does the org have a standing runner? The Live tab's default-view probe; a failed read is "no". */
export async function hasStandingRunner(slug: string): Promise<boolean> {
  return standingRunner(await listDrives(slug).catch(() => [])) != null;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/**
 * Commits ahead on the runner branch, per repo of `drive` — self-hosted only (it is a question about a
 * checkout on this machine). Every failure is `null`, which the card prints as "unknown": a count git
 * could not produce is not a count of zero.
 */
export async function readAheadCounts(slug: string, drive: DriveStatus | null): Promise<Record<string, number | null>> {
  const repos = drive?.repoState ?? [];
  if (repos.length === 0 || !selfHosted()) return {};
  const pairings = await listLocalPairings(slug).catch(() => []);
  const pathOf = new Map(pairings.map((p) => [p.fullName.toLowerCase(), p.localPath]));
  const entries = await Promise.all(
    repos.map(async (r): Promise<[string, number | null]> => {
      const path = pathOf.get(r.repo.toLowerCase());
      if (!path || !r.baseBranch) return [r.repo, null];
      return [r.repo, await withTimeout(runnerAheadCount(path, r.baseBranch), AHEAD_TIMEOUT_MS, null)];
    }),
  );
  return Object.fromEntries(entries);
}

/** A read that NAMES itself when it fails, instead of collapsing into an empty list. */
async function attempt<T>(name: LedgerRead, failed: LedgerRead[], read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    failed.push(name);
    return null;
  }
}

async function readAnchor(slug: string): Promise<string | null> {
  const login = await resolveViewerLogin().catch(() => null);
  if (!login) return null;
  return (await getLiveSeenAt(slug, login))?.seenAt ?? null;
}

export async function loadLedger(slug: string): Promise<LedgerData> {
  const failed: LedgerRead[] = [];
  const [isOwner, drives, seen, active, runs, pending, plans, directions, lessons] = await Promise.all([
    hasOrgRole(slug, "owner").catch(() => false),
    attempt("drives", failed, () => listDrives(slug)),
    attempt("anchor", failed, () => readAnchor(slug)),
    getActiveLoopRun(slug).catch(() => null),
    attempt("runs", failed, () => listLoopRuns(slug, CHRONICLE_PAGE)),
    attempt("plans", failed, () => listLoopPlans(slug, { status: ["pending"], limit: 200 })),
    attempt("plans", failed, () => listLoopPlans(slug, { limit: 200 })),
    attempt("directions", failed, () => listLoopDirections(slug)),
    attempt("lessons", failed, () => listRunnerKeptLessons(slug, { limit: 50 })),
  ]);
  const runner = standingRunner(drives ?? []);
  const lastRunner = runner ?? (drives ?? []).find((d) => d.mode === "continuous") ?? null;
  const driveModes = Object.fromEntries((drives ?? []).map((d) => [d.id, d.mode ?? "bounded"]));
  return {
    slug,
    now: new Date().toISOString(),
    isOwner,
    selfHosted: selfHosted(),
    seenAt: seen,
    runner,
    lastRunner,
    activeRun: active ? { id: active.id, seq: active.seq, cycle: active.cycle, maxCycles: active.maxCycles, startedAt: active.startedAt } : null,
    driveModes,
    pending,
    plans,
    directions,
    runs,
    runsHasMore: (runs?.length ?? 0) >= CHRONICLE_PAGE,
    lessons,
    ahead: await readAheadCounts(slug, lastRunner),
    failed: [...new Set(failed)],
  };
}
