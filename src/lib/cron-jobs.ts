// The ONE declared table of scheduled (Vercel Cron) jobs. Everything that used to hand-copy a cron
// fact derives from here:
//   - vercel.json `crons` (path + schedule) - the parity test in cron-jobs.test.ts fails when the two
//     disagree, or when a src/app/api/cron/<name>/route.ts directory has no row;
//   - /api/health per-job readiness (`crons`), with `autoscan` kept as the rescan projection;
//   - every cron route's missing-prerequisite answer (cronPrecondition).
//
// The rule the table encodes: a REQUIRED prerequisite missing is `blocked` and the route answers 503,
// because cron monitors watch only the HTTP status - a green 200 skip on a deploy that lost
// DATABASE_URL keeps the schedule silently green while nothing runs. A genuinely DB-less deployment
// opts into the quiet 200 skip per job via its `quietSkipEnv`. An OPTIONAL prerequisite missing is
// `degraded`: the run is partial (it names what it still runs and what it skips), never blocked.
//
// vercel.json is NOT generated from this table: the Hobby plan's hourly-cron limit makes the
// schedules an operator decision, so the file stays hand-written and the table must match it.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";

export type CronPrereq = "cronSecret" | "db" | "githubApp";
export type CronJobName = "rescan" | "probe" | "purge" | "digest" | "athena";
export type CronState = "ready" | "degraded" | "blocked";

export interface CronJob {
  name: CronJobName;
  path: string;
  schedule: string;
  /** Missing any of these = blocked (the route answers 503 unless `quietSkipEnv` is set). */
  requires: CronPrereq[];
  /** Missing one of these = degraded: a partial run, stated by what still runs and what is skipped. */
  optional: { prereq: CronPrereq; runs: string[]; skips: string[] }[];
  /** `<ENV>=1` turns the missing-DB 503 into a quiet 200 skip for an intentionally DB-less deploy. */
  quietSkipEnv: string | null;
}

/** The instruction that fixes each prerequisite. Env var NAMES only - never a value. */
export const CRON_REMEDY: Record<CronPrereq, string> = {
  cronSecret:
    "Set CRON_SECRET in the deployment env: Vercel Cron sends it as the bearer, and every cron route refuses (503) without it.",
  db: "Set DATABASE_URL (or DSQL_ENDPOINT for Aurora DSQL): this job reads and writes the database.",
  githubApp:
    "Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (the GitHub App): without it this job runs only part of its pass.",
};

export const CRON_JOBS: readonly CronJob[] = [
  {
    name: "rescan",
    path: "/api/cron/rescan",
    schedule: "0 6 * * *",
    requires: ["cronSecret", "db"],
    // The ledger seal runs before the App check on purpose (rescan/route.ts): a deploy without the App
    // still holds a ledger written by scans.
    optional: [{ prereq: "githubApp", runs: ["ledgerSeal"], skips: ["reap", "seed", "drain"] }],
    quietSkipEnv: "CRON_ALLOW_NO_DB",
  },
  {
    name: "probe",
    path: "/api/cron/probe",
    schedule: "15 * * * *",
    requires: ["cronSecret", "db"],
    optional: [{ prereq: "githubApp", runs: [], skips: ["seed", "drain"] }],
    quietSkipEnv: "CRON_ALLOW_NO_DB",
  },
  {
    name: "purge",
    path: "/api/cron/purge",
    schedule: "0 4 * * *",
    requires: ["cronSecret", "db"],
    optional: [],
    quietSkipEnv: "RETENTION_ALLOW_NO_DB",
  },
  {
    name: "digest",
    path: "/api/cron/digest",
    schedule: "0 13 * * 1",
    requires: ["cronSecret", "db"],
    optional: [],
    quietSkipEnv: "CRON_ALLOW_NO_DB",
  },
  {
    // athena/route.ts answers its own missing-DB 503 with no opt-in (its call site is not yet swapped
    // to cronPrecondition), so the table declares no quiet-skip env for it - that is today's truth.
    name: "athena",
    path: "/api/cron/athena",
    schedule: "30 7 * * *",
    requires: ["cronSecret", "db"],
    optional: [],
    quietSkipEnv: null,
  },
];

export type CronProbe = Record<CronPrereq, boolean>;

export interface CronJobReadiness {
  state: CronState;
  missing: CronPrereq[];
  /** The fixes for `missing`, joined; "" when ready. */
  remedy: string;
  /** Present only when degraded: the steps a partial run still performs / skips. */
  runs?: string[];
  skips?: string[];
}

export function liveCronProbe(): CronProbe {
  return { cronSecret: Boolean(process.env.CRON_SECRET), db: isDbConfigured(), githubApp: isAppConfigured() };
}

export function jobReadiness(job: CronJob, probe: CronProbe): CronJobReadiness {
  const missingRequired = job.requires.filter((p) => !probe[p]);
  const missingOptional = job.optional.filter((o) => !probe[o.prereq]);
  const missing = [...missingRequired, ...missingOptional.map((o) => o.prereq)];
  const remedy = missing.map((p) => CRON_REMEDY[p]).join(" ");
  if (missingRequired.length > 0) return { state: "blocked", missing, remedy };
  if (missingOptional.length > 0) {
    return {
      state: "degraded",
      missing,
      remedy,
      runs: [...new Set(missingOptional.flatMap((o) => o.runs))],
      skips: [...new Set(missingOptional.flatMap((o) => o.skips))],
    };
  }
  return { state: "ready", missing: [], remedy: "" };
}

/** Per-job readiness for every scheduled job, keyed by job name. */
export function cronReadiness(probe: CronProbe = liveCronProbe()): Record<CronJobName, CronJobReadiness> {
  return Object.fromEntries(CRON_JOBS.map((j) => [j.name, jobReadiness(j, probe)])) as Record<
    CronJobName,
    CronJobReadiness
  >;
}

export function cronJob(name: CronJobName): CronJob {
  const job = CRON_JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown cron job: ${name}`);
  return job;
}

/**
 * The missing-DB answer for an AUTHORIZED cron request (call after requireCronAuth). Returns a 503 when
 * the database is not configured, a quiet 200 `{skipped}` when the job's opt-in env is `1`, or `null`
 * to proceed. Optional prerequisites (the GitHub App) stay the route's own partial-run decision.
 */
export function cronPrecondition(name: CronJobName, db: boolean = isDbConfigured()): NextResponse | null {
  if (db) return null;
  const job = cronJob(name);
  if (job.quietSkipEnv && process.env[job.quietSkipEnv] === "1") {
    return NextResponse.json({ skipped: "Database required." });
  }
  const optIn = job.quietSkipEnv ? ` Set ${job.quietSkipEnv}=1 for an intentionally DB-less deployment.` : "";
  return NextResponse.json({ error: `Database is not configured (DATABASE_URL unset).${optIn}` }, { status: 503 });
}

/**
 * Drift between the table and what is actually scheduled / routed. Each entry names the job. Pure, so
 * the parity test can seed a mismatch and prove the comparator bites.
 */
export function cronTableDrift(
  table: readonly Pick<CronJob, "name" | "path" | "schedule">[],
  vercelCrons: readonly { path: string; schedule: string }[],
  routeDirs: readonly string[],
): string[] {
  const drift: string[] = [];
  for (const job of table) {
    const v = vercelCrons.find((c) => c.path === job.path);
    if (!v) drift.push(`${job.name}: in CRON_JOBS but not scheduled in vercel.json`);
    else if (v.schedule !== job.schedule) {
      drift.push(`${job.name}: schedule "${job.schedule}" in CRON_JOBS, "${v.schedule}" in vercel.json`);
    }
  }
  for (const c of vercelCrons) {
    if (!table.some((j) => j.path === c.path)) drift.push(`${c.path.split("/").pop()}: scheduled in vercel.json but has no CRON_JOBS row`);
  }
  for (const dir of routeDirs) {
    if (!table.some((j) => j.path === `/api/cron/${dir}`)) drift.push(`${dir}: src/app/api/cron/${dir}/route.ts has no CRON_JOBS row`);
  }
  return drift;
}
