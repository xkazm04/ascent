// #16 — the per-check conformance ledger: the rows behind `Repository.aiConformance*`.
//
// The denormalized four numbers on the Repository row answer "how conformant is this repo"; nobody
// asks that. The questions a fleet owner actually has — which control is failing, in how many repos,
// and since when — need the CLAUSE, and until now the clauses were printed to a CI log and dropped.
//
// Idempotency: `@@unique([orgId, repoFullName, headSha, runShape])`. A CI re-run of the same commit
// in the same shape REPLACES its findings instead of duplicating the timeline. A sha-less report
// (an older doctor, a local run) appends, because Postgres treats NULLs as distinct — the same
// last-write-wins trade-off `recordConformance` already documents for sha-less reports.
//
// These rows are DERIVED data and carry no signature. The tamper-evident copy of a conformance report
// is the `conformance.reported` AuditLog row, which is signed and stays exactly where it was.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { CHECK_LEVELS, isValidCheckId, type CheckLevel } from "@/lib/standard/check-ids";
import { buildControlMatrix, type ConformanceReportRow, type ControlMatrixRow } from "@/lib/standard/control-matrix";

export type { ConformanceReportRow, ControlMatrixRow };

/** Hard ceilings on a self-reported payload. The endpoint is token-authed, not trusted. */
export const MAX_FINDINGS = 500;
export const MAX_MESSAGE = 300;

export interface ConformanceReportInput {
  repoFullName: string;
  headSha: string | null;
  score: number;
  fails: number;
  warns: number;
  unchecked: number;
  scored: number;
  specVersion: string | null;
  runShape: "plain" | "run";
  /** Absent (not empty) when the reporter sent no `findings[]` — that becomes `summaryOnly`. */
  findings?: { check: string; level: CheckLevel; message?: string }[] | null;
}

function isLevel(v: unknown): v is CheckLevel {
  return typeof v === "string" && (CHECK_LEVELS as readonly string[]).includes(v);
}

/**
 * Write one report and its findings inside the caller's transaction. Returns the report id, or null
 * when there is nothing to write.
 *
 * The upsert is expressed as delete-then-create rather than a Prisma `upsert`: the unique key
 * contains a nullable column, and a null `headSha` must APPEND (each sha-less run is its own report)
 * rather than collapse onto one row.
 */
export async function writeConformanceReport(
  tx: Prisma.TransactionClient,
  orgId: string,
  input: ConformanceReportInput,
): Promise<string | null> {
  const summaryOnly = !Array.isArray(input.findings);
  const findings = (input.findings ?? [])
    .filter((f) => isValidCheckId(f.check) && isLevel(f.level))
    .slice(0, MAX_FINDINGS);

  if (input.headSha) {
    // Same commit, same run shape: this is a re-run, not a second data point. Replacing keeps the
    // timeline honest — two rows for one commit would make a flapping CI look like a trend.
    const existing = await tx.conformanceReport.findFirst({
      where: { orgId, repoFullName: input.repoFullName, headSha: input.headSha, runShape: input.runShape },
      select: { id: true },
    });
    if (existing) {
      await tx.conformanceFinding.deleteMany({ where: { reportId: existing.id } });
      await tx.conformanceReport.delete({ where: { id: existing.id } });
    }
  }

  const report = await tx.conformanceReport.create({
    data: {
      orgId,
      repoFullName: input.repoFullName,
      headSha: input.headSha,
      score: input.score,
      fails: input.fails,
      warns: input.warns,
      unchecked: input.unchecked,
      scored: input.scored,
      specVersion: input.specVersion,
      runShape: input.runShape,
      summaryOnly,
    },
    select: { id: true },
  });

  if (findings.length) {
    await tx.conformanceFinding.createMany({
      data: findings.map((f) => ({
        reportId: report.id,
        check: f.check,
        level: f.level,
        message: (f.message ?? "").slice(0, MAX_MESSAGE),
      })),
    });
  }
  return report.id;
}

type DbReport = {
  id: string;
  repoFullName: string;
  headSha: string | null;
  score: number;
  fails: number;
  warns: number;
  unchecked: number;
  scored: number;
  specVersion: string | null;
  runShape: string;
  summaryOnly: boolean;
  reportedAt: Date;
  findings: { check: string; level: string; message: string }[];
};

/** Prisma row → wire row. `reportedAt` becomes a STRING here, server-side (wire-safe-dates). */
function toRow(r: DbReport): ConformanceReportRow {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    headSha: r.headSha,
    score: r.score,
    fails: r.fails,
    warns: r.warns,
    unchecked: r.unchecked,
    scored: r.scored,
    specVersion: r.specVersion,
    runShape: r.runShape,
    summaryOnly: r.summaryOnly,
    reportedAt: r.reportedAt.toISOString(),
    findings: r.findings
      .filter((f) => isLevel(f.level))
      .map((f) => ({ check: f.check, level: f.level as CheckLevel, message: f.message })),
  };
}

/**
 * One repo's reports, newest first. Null (not `[]`) without a database, so a caller can tell
 * "no history" from "history is unavailable here".
 */
export async function listConformanceReports(
  orgSlug: string,
  repoFullName: string,
  limit = 50,
): Promise<ConformanceReportRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const rows = await prisma.conformanceReport.findMany({
    where: { orgId, repoFullName },
    orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
    take: Math.min(200, Math.max(1, limit)),
    include: { findings: { select: { check: true, level: true, message: true } } },
  });
  return rows.map(toRow);
}

/**
 * The org's control matrix. Reads a bounded window per repo (the last `historyPerRepo` reports) —
 * enough for `since` to find a level change, bounded so one noisy repo cannot drag the read.
 */
export async function loadControlMatrix(
  orgSlug: string,
  opts: { repos?: string[]; historyPerRepo?: number } = {},
): Promise<ControlMatrixRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const window = Math.min(50, Math.max(1, opts.historyPerRepo ?? 20));
  const rows = await prisma.conformanceReport.findMany({
    where: { orgId, ...(opts.repos?.length ? { repoFullName: { in: opts.repos } } : {}) },
    orderBy: [{ reportedAt: "desc" }, { id: "desc" }],
    // A generous cap rather than a per-repo query: the matrix is an org-sized read, and
    // buildControlMatrix only uses the newest report per repo for the levels themselves.
    take: window * 40,
    include: { findings: { select: { check: true, level: true, message: true } } },
  });
  return buildControlMatrix(rows.map(toRow)).rows;
}
