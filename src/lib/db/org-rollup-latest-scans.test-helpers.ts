// An in-memory Scan table for prisma doubles, serving the reads org-rollup-latest-scans.ts issues
// (economics-1): `scan.groupBy({ by: ["repoId"], where, _max: { scannedAt } })` and the pair fetch
// `scan.findMany({ where: { OR: [{ repoId, scannedAt }] } })`. It evaluates `where` the way Postgres
// would for the operators those reads use, so a double built on it answers with the rows a real
// database would, rather than with whatever a test author expected the query to be.
//
// Not a test file (no `.test.` infix), so vitest does not collect it.
import { vi } from "vitest";

export type FakeScan = { id: string; repoId: string; scannedAt: Date } & Record<string, unknown>;

type Range = { lt?: Date; lte?: Date; gt?: Date; gte?: Date };
type Where = Record<string, unknown> | undefined;

function inRange(v: Date, f: unknown): boolean {
  if (f instanceof Date) return v.getTime() === f.getTime();
  if (f == null || typeof f !== "object") return true;
  const r = f as Range;
  const t = v.getTime();
  if (r.lt && !(t < r.lt.getTime())) return false;
  if (r.lte && !(t <= r.lte.getTime())) return false;
  if (r.gt && !(t > r.gt.getTime())) return false;
  if (r.gte && !(t >= r.gte.getTime())) return false;
  return true;
}

/**
 * Does `row` satisfy `where`? Supports what the latest-scan reads and the rollup/movers scan reads say:
 * `repoId` (equality), `scannedAt` (a Date or a lt/lte/gt/gte range), `engineProvider` (equality or
 * `{ not }`), `OR` / `AND`, and `repo` (the org/segment scope), which is taken as satisfied: a double's
 * table holds only the org under test, and tests that pin the scope assert on the recorded `where`.
 */
export function matchesScanWhere(where: Where, row: FakeScan): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined || k === "repo") continue;
    if (k === "OR") {
      if (!(v as Where[]).some((w) => matchesScanWhere(w, row))) return false;
    } else if (k === "AND") {
      if (!(v as Where[]).every((w) => matchesScanWhere(w, row))) return false;
    } else if (k === "scannedAt") {
      if (!inRange(row.scannedAt, v)) return false;
    } else if (v != null && typeof v === "object" && "not" in v) {
      if (row[k] === (v as { not: unknown }).not) return false;
    } else if (row[k] !== v) {
      return false;
    }
  }
  return true;
}

/** `groupBy repoId, _max scannedAt` over the rows matching `where`. */
export function groupLatest(rows: readonly FakeScan[], where: Where): { repoId: string; _max: { scannedAt: Date } }[] {
  const max = new Map<string, Date>();
  for (const r of rows) {
    if (!matchesScanWhere(where, r)) continue;
    const held = max.get(r.repoId);
    if (!held || r.scannedAt > held) max.set(r.repoId, r.scannedAt);
  }
  return [...max].map(([repoId, scannedAt]) => ({ repoId, _max: { scannedAt } }));
}

/**
 * The two delegate methods, over a table read LAZILY (`rows()` runs per call, so a test may swap its
 * fixture after building the double). `findMany` answers a pair fetch (a `where` carrying `OR`) from the
 * table; any other findMany (the trend, the in-window movers read) goes to `other`, default `[]`.
 */
export function latestScanReads(
  rows: () => readonly FakeScan[] | Promise<readonly FakeScan[]>,
  other: (args: { where?: Where; distinct?: unknown; orderBy?: unknown }) => unknown = () => [],
) {
  return {
    groupBy: vi.fn(async (args: { where?: Where }) => groupLatest(await rows(), args.where)),
    findMany: vi.fn(async (args: { where?: Where; distinct?: unknown; orderBy?: unknown } = {}) =>
      args.where && "OR" in args.where ? (await rows()).filter((r) => matchesScanWhere(args.where, r)) : other(args),
    ),
  };
}

/** The rows a `vi.fn` repository double returns, read WITHOUT recording a call on it (tests count those). */
export async function unrecorded<T>(fn: { getMockImplementation(): ((...a: never[]) => unknown) | undefined }): Promise<T> {
  const impl = fn.getMockImplementation();
  return ((impl ? await impl() : []) ?? []) as T;
}

/** Flatten repository rows that carry their latest scan nested as `scans: [scan]` (the shape these
 *  doubles were written for) into table rows. A scan without an id gets `latest_<repoId>`; a scan
 *  without a `scannedAt` gets one that keeps the array's newest-first order (index 0 is the latest). */
export function scansOfRepoRows(repos: readonly { id: string; scans?: readonly Record<string, unknown>[] }[]): FakeScan[] {
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  return repos.flatMap((r) =>
    (r.scans ?? []).map(
      (s, i) => ({ id: `latest_${r.id}${i ? `_${i}` : ""}`, scannedAt: new Date(t0 - i * 60_000), ...s, repoId: r.id }) as FakeScan,
    ),
  );
}

type RepoRow = { id?: string; scans?: readonly Record<string, unknown>[] } & Record<string, unknown>;
type NestedDouble = { repository?: { findMany?: (...a: never[]) => unknown }; scan?: Record<string, unknown> } & Record<string, unknown>;
const served = new WeakMap<object, unknown>();

/**
 * Adapt a prisma double written for the OLD nested `scans: [latest]` shape to the latest-scan door
 * (`withLatestScans`), without rewriting its fixtures: every repository row gets an id (its own, else
 * `repo_<index>`), and `scan.groupBy` / the pair `scan.findMany` serve the nested scans of the rows
 * that read returned, as a table ({@link scansOfRepoRows}). The repository delegate is still called
 * (so its recorded calls stay assertable); the door ignores the nested scans it returns. A double that
 * already has a `scan.groupBy` serves its own table and is returned untouched, as is a non-object.
 * Memoized per double, so every `getPrisma()` in one test sees the same adapter.
 */
export function servingNestedScans<T>(prisma: T): T {
  const p = prisma as unknown as NestedDouble;
  if (p == null || typeof p !== "object" || typeof p.repository?.findMany !== "function" || p.scan?.groupBy) return prisma;
  const hit = served.get(p);
  if (hit) return hit as T;
  const orig = p.repository.findMany as (...a: unknown[]) => unknown;
  let last: Promise<RepoRow[]> = Promise.resolve([]);
  let table: Promise<FakeScan[]> = Promise.resolve([]);
  const repoFind = vi.fn((...args: unknown[]) => {
    last = Promise.resolve(orig(...args)).then((rows) =>
      ((rows ?? []) as RepoRow[]).map((r, i) => ({ ...r, id: r.id ?? `repo_${i}` })),
    );
    return last;
  });
  const otherFind = p.scan?.findMany as ((...a: unknown[]) => unknown) | undefined;
  const out = {
    ...p,
    repository: { ...p.repository, findMany: repoFind },
    scan: {
      ...p.scan,
      groupBy: vi.fn(async (args: { where?: Where }) => {
        table = last.then((rows) => scansOfRepoRows(rows as { id: string }[]));
        return groupLatest(await table, args.where);
      }),
      findMany: vi.fn(async (args: { where?: Where } = {}) =>
        args.where && "OR" in args.where ? (await table).filter((r) => matchesScanWhere(args.where, r)) : (otherFind?.(args) ?? []),
      ),
    },
  };
  served.set(p, out);
  return out as unknown as T;
}

// ── A whole-fleet double + the OLD read shapes as an oracle (economics-1 equivalence/shape tests) ──

export type FleetScan = FakeScan & {
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  level: string;
  posture: string;
  engineProvider: string;
};
export interface Fleet {
  repos: { id: string; fullName: string; name: string }[];
  scans: FleetScan[];
}

/** One recorded delegate call and the rows it answered with. */
export interface Read {
  target: string;
  args: Record<string, unknown>;
  rows: unknown[];
  /** Scan rows this call moved over the wire: a Scan findMany's rows, or for a repository read with a
   *  nested `scans` relation EVERY scan of the repos it returned (the relation `take` is applied after
   *  the fetch under Prisma 6.19's client query compiler - the measurement in org-insights.ts). */
  scanRows: number;
}

/**
 * A prisma double over a whole fleet that serves everything getOrgRollup and getOrgMovers read, and
 * RECORDS every call with the rows it returned, so a test can assert on the plan (which calls, in
 * what shape, how many) and on the volume (how many rows crossed the "wire").
 */
export function fleetPrisma(fleet: Fleet, plan = "enterprise") {
  const reads: Read[] = [];
  const repoById = new Map(fleet.repos.map((r) => [r.id, r]));
  const rec = <T>(target: string, answer: (args: Record<string, unknown>) => T[], scanRows: (rows: T[], args: Record<string, unknown>) => number = () => 0) =>
    vi.fn(async (args: Record<string, unknown> = {}) => {
      const rows = answer(args);
      reads.push({ target, args, rows, scanRows: scanRows(rows, args) });
      return rows;
    });
  // A nested relation select's `where: { dimId }` (getOrgDimensionGaps) is applied, so both read shapes
  // answer with the same dimension rows.
  const dimsFor = (s: FleetScan, sel: unknown) => {
    const dimId = (sel as { dimensions?: { where?: { dimId?: string } } } | undefined)?.dimensions?.where?.dimId;
    const dims = (s.dimensions as { dimId: string }[] | undefined) ?? [];
    return dimId ? dims.filter((d) => d.dimId === dimId) : dims;
  };
  const nested = (repoId: string, scansArg: { take?: number; select?: unknown }) =>
    (oldPick(fleet, undefined, scansArg.take ?? Number.MAX_SAFE_INTEGER).get(repoId) ?? []).map((s) => ({ ...s, dimensions: dimsFor(s, scansArg.select) }));
  const scansArgOf = (args: Record<string, unknown>) => (args.select as { scans?: { take?: number; select?: unknown } } | undefined)?.scans;
  const sortBy = (rows: FleetScan[], orderBy: unknown) => {
    const dir = (orderBy as { scannedAt?: "asc" | "desc" } | undefined)?.scannedAt;
    if (!dir) return rows;
    return [...rows].sort((a, b) => (dir === "asc" ? 1 : -1) * (a.scannedAt.getTime() - b.scannedAt.getTime()));
  };
  const withRepo = (s: FleetScan, sel?: unknown) => {
    const r = repoById.get(s.repoId)!;
    return { ...s, dimensions: dimsFor(s, sel), repo: { fullName: r.fullName, name: r.name } };
  };
  const prisma = {
    // The org lookup answers one object (and is not part of the scan plan, so it is not recorded).
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme", plan, kind: "org", timezone: null })) },
    repository: {
      // Serves the OLD nested `scans` relation too (newest first, ties to the greatest id, the relation
      // `take` kept), so a reader can be run in either shape against one fleet.
      findMany: rec(
        "repository.findMany",
        (args) =>
          fleet.repos.map((r) => {
            const scansArg = scansArgOf(args);
            const row = { ...r, owner: "acme", isPrivate: false, watched: true, scanSchedule: "weekly", passportJson: null, teams: [], contributors: [] };
            return scansArg ? { ...row, scans: nested(r.id, scansArg) } : row;
          }),
        (rows, args) => (scansArgOf(args) ? fleet.scans.filter((s) => rows.some((r) => r.id === s.repoId)).length : 0),
      ),
    },
    scan: {
      groupBy: rec("scan.groupBy", (args) => groupLatest(fleet.scans, args.where as Where)),
      findMany: rec(
        "scan.findMany",
        (args) => sortBy(fleet.scans.filter((s) => matchesScanWhere(args.where as Where, s)), args.orderBy).map((s) => withRepo(s, args.select)),
        (rows) => rows.length,
      ),
    },
    scanDigest: { findMany: rec("scanDigest.findMany", () => []) },
    scanDimension: { findMany: rec("scanDimension.findMany", () => []) },
    controlObservation: { groupBy: rec("controlObservation.groupBy", () => []) },
    scanJob: { findMany: rec("scanJob.findMany", () => []) },
    improvementPr: { findMany: rec("improvementPr.findMany", () => []) },
    invite: { count: vi.fn(async () => 0) },
    aiChange: { groupBy: rec("aiChange.groupBy", () => []) },
    orgArtifactAck: { findMany: rec("orgArtifactAck.findMany", () => []) },
  };
  return { prisma, reads };
}

/** A deterministic fleet: `repos` repos × `perRepo` scans every 12 days from 2025-10-01 (no two scans of
 *  one repo share a timestamp), so each repo has history before, inside and after a 2026-Q2 window. */
export function makeFleet(repos: number, perRepo: number): Fleet {
  const t0 = Date.parse("2025-10-01T00:00:00Z");
  const out: Fleet = { repos: [], scans: [] };
  for (let i = 0; i < repos; i++) {
    const id = `r${String(i).padStart(3, "0")}`;
    out.repos.push({ id, fullName: `acme/${id}`, name: id });
    for (let j = 0; j < perRepo; j++) {
      const overall = (i * 7 + j * 13) % 100;
      out.scans.push({
        id: `${id}-s${String(j).padStart(3, "0")}`,
        repoId: id,
        scannedAt: new Date(t0 + j * 12 * 86_400_000 + i * 3_600_000),
        overallScore: overall,
        adoptionScore: (overall + 5) % 100,
        rigorScore: (overall + 11) % 100,
        level: `L${1 + Math.floor(overall / 20)}`,
        posture: "developing",
        engineProvider: "anthropic",
      });
    }
  }
  return out;
}

/** The OLD shape, as the database would have answered it before the plan was cut: every scan of the
 *  repo under the bound, newest first (an equal `scannedAt` to the greatest id, the door's TIE RULE),
 *  the first `take` kept (nested `take` / `distinct` semantics). */
export function oldPick(fleet: Fleet, bound: Range | undefined, take = 1): Map<string, FleetScan[]> {
  const out = new Map<string, FleetScan[]>();
  for (const r of fleet.repos) {
    const picked = fleet.scans
      .filter((s) => s.repoId === r.id && inRange(s.scannedAt, bound))
      .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
      .slice(0, take);
    if (picked.length) out.set(r.id, picked);
  }
  return out;
}

/** How many Scan rows the OLD shape transferred for one read: all of them under the bound (the nested
 *  take and `distinct` were applied after the fetch). */
export function oldTransfer(fleet: Fleet, bound: Range | undefined): number {
  return fleet.scans.filter((s) => inRange(s.scannedAt, bound)).length;
}

/**
 * Give every scan of a fleet the per-scan payloads the fleet readers aggregate - dimension rows, an
 * open gap recommendation, and the prStats / governance / commitActivity / discrepancies blobs - each
 * varying by scan, so a reader that read the WRONG scan of a repo returns a visibly different object.
 */
export function enrichFleet(fleet: Fleet): Fleet {
  const scans = fleet.scans.map((s, k) => {
    const v = (s.overallScore + k) % 100;
    return {
      ...s,
      archetype: "service",
      dimensions: ["D1", "D2", "D3"].map((dimId, d) => ({ dimId, score: (v + d * 17) % 100, signalScore: v, llmScore: v, gaps: `["gap ${s.id}"]`, evidence: "[]", summary: s.id })),
      recommendations: [{ id: `rec_${s.id}`, title: `Fix ${v % 5}`, dimId: `D${1 + (v % 3)}`, impact: v % 2 ? "high" : "medium", rationale: s.id, explore: "[]" }],
      prStats: JSON.stringify({ analyzed: 10 + (v % 7), reviewedRate: v, mergeRate: 50, tools: [] }),
      governance: JSON.stringify({ protected: v % 2 === 0, requiresPullRequest: true, requiredApprovals: v % 3, requiresStatusChecks: true, requiresSignatures: false, ruleCount: 1, readable: true }),
      commitActivity: JSON.stringify([v % 9, (v + 1) % 9, (v + 2) % 9]),
      discrepancies: JSON.stringify([{ dimension: `D${1 + (v % 3)}`, claim: `claim ${s.id}` }]),
      practiceShape: null,
    } as FleetScan;
  });
  return { repos: fleet.repos, scans };
}
