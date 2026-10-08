// The one-off backfill for the private-repo store rule (operator decision 2026-10-08, "Scrub all of
// it"). Rows of a private repository written before 5aed22ae still hold text copied out of its files:
// cited-claim quotes in ScanDimension.evidence, rule lines and literal commands in guidanceGraphJson,
// prose and commands in manifestJson (on Scan AND on the Repository cache), and verbatim `.ai/memory`
// bodies in RepoMemoryMirror and the OrgMemory rows the mirror fed. This module rewrites the first
// three through the SAME pure transforms the persist path now applies (src/lib/private-scan-store.ts)
// and deletes the last two through the retention erase path's own predicates.
//
// Properties the operator relies on, each pinned by private-scan-scrub.test.ts:
//   - DRY RUN BY DEFAULT. `apply: false` reads and counts; it writes nothing.
//   - IDEMPOTENT. A row is written only when the transform changes its parsed value, and the
//     transforms are idempotent, so a second `apply` changes 0 rows.
//   - NO CLOCK MOVES. Scan and ScanDimension carry no @updatedAt; Repository does, and every write
//     passes the row's original `updatedAt` back so Prisma does not bump it. `scannedAt` (which scan
//     reads as latest) and `lastScanAt` (freshness) are never in a write.
//   - A VALUE THAT DOES NOT PARSE is counted and listed, never written.
//   - Consolidated memory is LISTED, not touched: OrgMemory rows linked to a deleted repo-memory row by
//     `supersededBy` (either direction) are reported for a human decision.
//
// LOCAL WORKING COPIES are exempt from the store rule (forge: "local" on the report), but a stored row
// does not record which source wrote it: Repository.forge is inferred from the url, which is a
// github.com url for a local scan, and Scan has no source column. So on a self-hosted deployment
// (the only place local mode exists) `apply` is REFUSED rather than guessing. Managed cloud has no
// local rows, because local mode answers 404 there.

import { getPrisma, isDbConfigured, withRetry } from "@/lib/db/client";
import { eraseRepoMemoryMirrorByRepo } from "@/lib/db/retention";
import { recordAudit } from "@/lib/db/scans";
import { parseGuidanceGraphJson } from "@/lib/analyze/guidance-graph";
import { parseManifestReadoutJson } from "@/lib/standard/readout";
import { selfHosted } from "@/lib/env";
import { REPO_MEMORY_SOURCE } from "@/lib/org/memory-kinds";
import { storableEvidenceLine, storableGuidanceGraph, storableManifest } from "@/lib/private-scan-store";

export const SCRUB_ACTION = "data.private-scan-scrubbed";
const PAGE = 200;

export type ScrubColumn =
  | "ScanDimension.evidence"
  | "Scan.guidanceGraphJson"
  | "Scan.manifestJson"
  | "Repository.guidanceGraphJson"
  | "Repository.manifestJson";
export const SCRUB_COLUMNS: readonly ScrubColumn[] = [
  "ScanDimension.evidence",
  "Scan.guidanceGraphJson",
  "Scan.manifestJson",
  "Repository.guidanceGraphJson",
  "Repository.manifestJson",
];

export interface ColumnTally {
  examined: number;
  changed: number;
  unchanged: number;
  /** Row ids whose value did not parse — counted, listed, never written. */
  unparseable: string[];
}

export interface LinkedMemory {
  id: string;
  /** "successor": a deleted repo-memory row was superseded by it (it may restate the deleted text).
   *  "predecessor": it was superseded BY a deleted row, so its `supersededBy` will dangle. */
  link: "successor" | "predecessor";
  via: string;
}

export interface OrgScrub {
  orgId: string;
  orgSlug: string;
  /** Scan, ScanDimension and Repository values this org had (or would have) rewritten. */
  valuesChanged: number;
  privateRepos: number;
  mirrorRows: number;
  repoMemories: number;
  citations: number;
  linked: LinkedMemory[];
  audited: boolean | null;
}

export type ScrubOutcome =
  | { ok: false; reason: "no-db" | "unknown-org" | "self-hosted" }
  | { ok: true; apply: boolean; columns: Record<ScrubColumn, ColumnTally>; orgs: OrgScrub[] };

export interface ScrubOptions {
  apply: boolean;
  orgSlug?: string;
}

/** One value through its transform: unchanged, changed (with the string to write), or unparseable. */
type Step = { kind: "same" } | { kind: "write"; value: string } | { kind: "bad" };

function stepJson<T>(raw: string, parse: (raw: string) => T | null, scrub: (v: T) => T): Step {
  const parsed = parse(raw);
  if (parsed === null) return { kind: "bad" };
  const before = JSON.stringify(parsed);
  const after = JSON.stringify(scrub(parsed));
  return before === after ? { kind: "same" } : { kind: "write", value: after };
}

function parseEvidence(raw: string): string[] | null {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch (err) {
    // Counted and listed as unparseable by the caller; logged because a stored value that is not JSON
    // is damage, as parseGuidanceGraphJson treats it.
    console.warn("[private-scan-scrub] ScanDimension.evidence unreadable; listed, not written:", err);
    return null;
  }
}

export const stepEvidence = (raw: string): Step => stepJson(raw, parseEvidence, (v) => v.map(storableEvidenceLine));
export const stepGuidanceGraph = (raw: string): Step => stepJson(raw, parseGuidanceGraphJson, storableGuidanceGraph);
export const stepManifest = (raw: string): Step => stepJson(raw, parseManifestReadoutJson, storableManifest);

function emptyTallies(): Record<ScrubColumn, ColumnTally> {
  return Object.fromEntries(
    SCRUB_COLUMNS.map((c) => [c, { examined: 0, changed: 0, unchanged: 0, unparseable: [] }]),
  ) as unknown as Record<ScrubColumn, ColumnTally>;
}

/** Tally one value and, on apply, write it. `null` values are not examined (nothing to scrub). */
async function visit(
  tally: ColumnTally,
  id: string,
  raw: string | null,
  step: (raw: string) => Step,
  write: ((value: string) => Promise<unknown>) | null,
): Promise<number> {
  if (raw === null || raw === "") return 0;
  tally.examined++;
  const s = step(raw);
  if (s.kind === "bad") tally.unparseable.push(id);
  else if (s.kind === "same") tally.unchanged++;
  else {
    tally.changed++;
    if (write) await write(s.value);
    return 1;
  }
  return 0;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Run the scrub. `apply: false` (the default the CLI passes) counts what would change; `apply: true`
 * writes it. Scoped to one org with `orgSlug`, otherwise every org with a private repository.
 */
export async function scrubPrivateScanContent(opts: ScrubOptions): Promise<ScrubOutcome> {
  if (!isDbConfigured()) return { ok: false, reason: "no-db" };
  if (opts.apply && selfHosted()) return { ok: false, reason: "self-hosted" };
  const prisma = getPrisma();
  const apply = opts.apply;

  let orgFilter: string | undefined;
  if (opts.orgSlug) {
    const org = await prisma.organization.findUnique({ where: { slug: opts.orgSlug.trim().toLowerCase() }, select: { id: true } });
    if (!org) return { ok: false, reason: "unknown-org" };
    orgFilter = org.id;
  }

  const columns = emptyTallies();
  const reposByOrg = new Map<string, string[]>();
  const changedByOrg = new Map<string, number>();

  // Repositories: the Repository cache columns, then every Scan of the repo and its dimensions.
  let cursor: string | undefined;
  for (;;) {
    const repos = await prisma.repository.findMany({
      where: { isPrivate: true, ...(orgFilter ? { orgId: orgFilter } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, orgId: true, fullName: true, updatedAt: true, guidanceGraphJson: true, manifestJson: true },
    });
    if (repos.length === 0) break;
    for (const repo of repos) {
      reposByOrg.set(repo.orgId, [...(reposByOrg.get(repo.orgId) ?? []), repo.fullName]);
      // `updatedAt` is passed back unchanged so the write does not move the row's @updatedAt clock.
      const writeRepo = (data: { guidanceGraphJson?: string; manifestJson?: string }) =>
        withRetry(() => prisma.repository.update({ where: { id: repo.id }, data: { ...data, updatedAt: repo.updatedAt } }), {
          label: "scrub.repository",
        });
      let changed = 0;
      changed += await visit(columns["Repository.guidanceGraphJson"], repo.id, repo.guidanceGraphJson, stepGuidanceGraph,
        apply ? (v) => writeRepo({ guidanceGraphJson: v }) : null);
      changed += await visit(columns["Repository.manifestJson"], repo.id, repo.manifestJson, stepManifest,
        apply ? (v) => writeRepo({ manifestJson: v }) : null);
      changed += await scrubScans(prisma, repo.id, apply, columns);
      changedByOrg.set(repo.orgId, (changedByOrg.get(repo.orgId) ?? 0) + changed);
    }
    if (repos.length < PAGE) break;
    cursor = repos[repos.length - 1]!.id;
  }

  const orgs: OrgScrub[] = [];
  for (const [orgId, fullNames] of reposByOrg) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
    const row = await scrubOrgMemory(prisma, orgId, org?.slug ?? orgId, fullNames, apply);
    orgs.push({ ...row, valuesChanged: changedByOrg.get(orgId) ?? 0 });
  }

  if (apply) {
    for (const o of orgs) {
      // Written only when this org actually changed (the purge's `totalDeleted > 0` gate), so a second,
      // no-op apply writes no audit row either and changes 0 rows anywhere.
      if (o.valuesChanged + o.mirrorRows + o.repoMemories + o.citations === 0) continue;
      o.audited = await recordAudit(
        SCRUB_ACTION,
        {
          privateRepos: o.privateRepos,
          valuesScrubbed: o.valuesChanged,
          memoryMirrorsDeleted: o.mirrorRows,
          orgMemoriesDeleted: o.repoMemories,
          memoryCitationsDeleted: o.citations,
          linkedMemoriesListed: o.linked.length,
        },
        { orgId: o.orgId },
      );
    }
  }

  return { ok: true, apply, columns, orgs };
}

type PrismaLike = ReturnType<typeof getPrisma>;

async function scrubScans(prisma: PrismaLike, repoId: string, apply: boolean, columns: Record<ScrubColumn, ColumnTally>): Promise<number> {
  let changed = 0;
  let cursor: string | undefined;
  for (;;) {
    const scans = await prisma.scan.findMany({
      where: { repoId },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, guidanceGraphJson: true, manifestJson: true },
    });
    if (scans.length === 0) break;
    for (const scan of scans) {
      // Scan has no @updatedAt; `scannedAt` (the latest-scan order) is never in the write.
      const writeScan = (data: { guidanceGraphJson?: string; manifestJson?: string }) =>
        withRetry(() => prisma.scan.update({ where: { id: scan.id }, data }), { label: "scrub.scan" });
      changed += await visit(columns["Scan.guidanceGraphJson"], scan.id, scan.guidanceGraphJson, stepGuidanceGraph,
        apply ? (v) => writeScan({ guidanceGraphJson: v }) : null);
      changed += await visit(columns["Scan.manifestJson"], scan.id, scan.manifestJson, stepManifest,
        apply ? (v) => writeScan({ manifestJson: v }) : null);
    }
    const dims = await prisma.scanDimension.findMany({
      where: { scanId: { in: scans.map((s) => s.id) } },
      select: { id: true, evidence: true },
    });
    for (const d of dims) {
      changed += await visit(columns["ScanDimension.evidence"], d.id, d.evidence, stepEvidence,
        apply
          ? (v) => withRetry(() => prisma.scanDimension.update({ where: { id: d.id }, data: { evidence: v } }), { label: "scrub.scan-dimension" })
          : null);
    }
    if (scans.length < PAGE) break;
    cursor = scans[scans.length - 1]!.id;
  }
  return changed;
}

/**
 * One org's `.ai/memory` copies of its private repos: the mirror rows through the repo-scoped erase
 * helper, then the OrgMemory rows the mirror fed (`source: "repo-memory"`, namespace = the repo's
 * fullName) with their citations first, as the erase path orders it. Linked rows are listed only.
 */
async function scrubOrgMemory(prisma: PrismaLike, orgId: string, orgSlug: string, fullNames: string[], apply: boolean): Promise<Omit<OrgScrub, "valuesChanged">> {
  let mirrorRows = 0;
  for (const name of fullNames) mirrorRows += await eraseRepoMemoryMirrorByRepo(prisma, orgId, name, !apply);

  const memories = await prisma.orgMemory.findMany({
    where: { orgId, source: REPO_MEMORY_SOURCE, namespace: { in: fullNames } },
    select: { id: true, supersededBy: true },
  });
  const ids = memories.map((m) => m.id);
  const gone = new Set(ids);

  const linked: LinkedMemory[] = [];
  for (const m of memories) {
    if (m.supersededBy && !gone.has(m.supersededBy)) linked.push({ id: m.supersededBy, link: "successor", via: m.id });
  }
  for (const part of chunks(ids, PAGE)) {
    const preds = await prisma.orgMemory.findMany({ where: { orgId, supersededBy: { in: part } }, select: { id: true, supersededBy: true } });
    for (const p of preds) if (!gone.has(p.id)) linked.push({ id: p.id, link: "predecessor", via: p.supersededBy! });
  }

  let citations = 0;
  let repoMemories = 0;
  for (const part of chunks(ids, PAGE)) {
    if (!apply) {
      citations += await prisma.orgMemoryCitation.count({ where: { orgId, memoryId: { in: part } } });
      repoMemories += part.length;
      continue;
    }
    citations += (
      await withRetry(() => prisma.orgMemoryCitation.deleteMany({ where: { orgId, memoryId: { in: part } } }), {
        label: "erase.memory-citations",
      })
    ).count;
    repoMemories += (
      await withRetry(() => prisma.orgMemory.deleteMany({ where: { orgId, id: { in: part } } }), { label: "erase.org-memories" })
    ).count;
  }

  return { orgId, orgSlug, privateRepos: fullNames.length, mirrorRows, repoMemories, citations, linked, audited: null };
}

/** The report the CLI prints. Pure, so the test can pin the operator's dry-run output. */
export function formatScrubOutcome(out: ScrubOutcome, dbHost: string): string {
  const lines = [`Target database host: ${dbHost}`];
  if (!out.ok) {
    if (out.reason === "self-hosted") {
      lines.push(
        "REFUSED: --apply on a self-hosted deployment. Local working-copy scans are exempt from the private",
        "store rule, but a stored row does not record whether a local or a GitHub scan wrote it, so this run",
        "cannot tell which rows to leave alone. Run without --apply to see the counts.",
      );
    } else if (out.reason === "unknown-org") lines.push("REFUSED: no organization with that slug.");
    else lines.push("REFUSED: no database configured (DATABASE_URL / DSQL_ENDPOINT unset).");
    return lines.join("\n");
  }
  lines.push(out.apply ? "Mode: APPLY (writes)" : "Mode: dry run (nothing written; pass --apply to write)", "");
  const verb = out.apply ? "changed" : "would change";
  for (const c of SCRUB_COLUMNS) {
    const t = out.columns[c];
    lines.push(`${c}: examined ${t.examined}, ${verb} ${t.changed}, unchanged ${t.unchanged}, unparseable ${t.unparseable.length}`);
    if (t.unparseable.length > 0) lines.push(`  unparseable ids (not written): ${t.unparseable.join(", ")}`);
  }
  const del = out.apply ? "deleted" : "would delete";
  for (const o of out.orgs) {
    lines.push(
      "",
      `org ${o.orgSlug}: ${o.privateRepos} private repo(s), ${o.valuesChanged} value(s) ${verb}; ${del} ${o.mirrorRows} RepoMemoryMirror, ${o.repoMemories} repo-memory OrgMemory, ${o.citations} OrgMemoryCitation`,
    );
    if (o.linked.length === 0) lines.push("  linked OrgMemory (listed, not touched): none linked by supersededBy");
    for (const l of o.linked) lines.push(`  linked OrgMemory (listed, not touched): ${l.id} is the ${l.link} of ${l.via}`);
    if (o.audited === false) lines.push("  WARNING: audit write failed (changes applied, trace missing)");
  }
  if (out.orgs.length === 0) lines.push("", "No private repositories in scope.");
  lines.push(
    "",
    "Consolidated memory: only supersededBy links an OrgMemory row to the repo-memory row it came from;",
    "a consolidation or reflection that merged its text without superseding it cannot be traced.",
  );
  return lines.join("\n");
}
