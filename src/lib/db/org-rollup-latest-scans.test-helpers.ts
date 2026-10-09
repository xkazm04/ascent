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
 *  doubles were written for) into table rows. A scan without an id gets `latest_<repoId>`. */
export function scansOfRepoRows(repos: readonly { id: string; scans?: readonly Record<string, unknown>[] }[]): FakeScan[] {
  return repos.flatMap((r) =>
    (r.scans ?? []).map((s, i) => ({ id: `latest_${r.id}${i ? `_${i}` : ""}`, ...s, repoId: r.id }) as FakeScan),
  );
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
}

/**
 * A prisma double over a whole fleet that serves everything getOrgRollup and getOrgMovers read, and
 * RECORDS every call with the rows it returned, so a test can assert on the plan (which calls, in
 * what shape, how many) and on the volume (how many rows crossed the "wire").
 */
export function fleetPrisma(fleet: Fleet, plan = "enterprise") {
  const reads: Read[] = [];
  const repoById = new Map(fleet.repos.map((r) => [r.id, r]));
  const rec = <T>(target: string, answer: (args: Record<string, unknown>) => T[]) =>
    vi.fn(async (args: Record<string, unknown> = {}) => {
      const rows = answer(args);
      reads.push({ target, args, rows });
      return rows;
    });
  const sortBy = (rows: FleetScan[], orderBy: unknown) => {
    const dir = (orderBy as { scannedAt?: "asc" | "desc" } | undefined)?.scannedAt;
    if (!dir) return rows;
    return [...rows].sort((a, b) => (dir === "asc" ? 1 : -1) * (a.scannedAt.getTime() - b.scannedAt.getTime()));
  };
  const withRepo = (s: FleetScan) => {
    const r = repoById.get(s.repoId)!;
    return { ...s, dimensions: [], repo: { fullName: r.fullName, name: r.name } };
  };
  const prisma = {
    // The org lookup answers one object (and is not part of the scan plan, so it is not recorded).
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme", plan })) },
    repository: {
      findMany: rec("repository.findMany", () => fleet.repos.map((r) => ({ ...r, owner: "acme", isPrivate: false, watched: true, scanSchedule: "weekly" }))),
    },
    scan: {
      groupBy: rec("scan.groupBy", (args) => groupLatest(fleet.scans, args.where as Where)),
      findMany: rec("scan.findMany", (args) =>
        sortBy(fleet.scans.filter((s) => matchesScanWhere(args.where as Where, s)), args.orderBy).map(withRepo),
      ),
    },
    scanDigest: { findMany: rec("scanDigest.findMany", () => []) },
    scanDimension: { findMany: rec("scanDimension.findMany", () => []) },
    controlObservation: { groupBy: rec("controlObservation.groupBy", () => []) },
    scanJob: { findMany: rec("scanJob.findMany", () => []) },
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
 *  repo under the bound, newest first, the first `take` kept (nested `take` / `distinct` semantics). */
export function oldPick(fleet: Fleet, bound: Range | undefined, take = 1): Map<string, FleetScan[]> {
  const out = new Map<string, FleetScan[]>();
  for (const r of fleet.repos) {
    const picked = fleet.scans
      .filter((s) => s.repoId === r.id && inRange(s.scannedAt, bound))
      .sort((a, b) => b.scannedAt.getTime() - a.scannedAt.getTime())
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
