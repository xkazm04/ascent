#!/usr/bin/env node
// KPI reader: every DB-backed KPI, read by SQL from a COPY of the local embedded PGlite data dir.
//
//   cp -r .pglite/ascent "$TMP/ascent-kpi"           # never open the live dir: PGlite is single-process
//   node scripts/kpi/pglite-kpi-readings.mjs --data "$TMP/ascent-kpi" [--json] [--now 2026-09-07T00:00:00Z]
//
// This is the `env=local` measurement path. Production readings come from GET /api/kpi
// (src/app/api/kpi/route.ts, ASCENT_OPS_SECRET bearer), which computes the eight adopted KPIs in
// src/lib/db/kpi-metrics.ts through Prisma. The SQL below transliterates those cohorts 1:1 (same
// windows, same exclusions, same "null ≠ 0" rule) so a local number and a production number are the
// same measurement; where a KPI has not yet been added to kpi-metrics.ts (backlog K1–K3, K10, K11)
// the SQL here IS the definition the TypeScript must reproduce.
//
// Output: one entry per KPI key, `{ value, numerator, denominator, evidence }`, plus `nowIso` and
// `dataDir`. Read-only in intent: only SELECTs are issued. Requires @electric-sql/pglite (a project
// dependency); run from the repo root so it resolves.

import { PGlite } from "@electric-sql/pglite";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dataDir = opt("--data", null);
const json = args.includes("--json");
const now = new Date(opt("--now", new Date().toISOString()));
if (!dataDir) {
  console.error("usage: --data <copy of the PGlite data dir> [--json] [--now iso]");
  process.exit(2);
}

const DAY_MS = 86_400_000;
const ago = (days) => new Date(now.getTime() - days * DAY_MS).toISOString();
const rate = (num, den) =>
  den <= 0 ? { value: null, numerator: num, denominator: den } : { value: Number(((num / den) * 100).toFixed(1)), numerator: num, denominator: den };

const db = new PGlite(resolve(dataDir));
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
const n = (v) => Number(v ?? 0);

const readings = {};

// ── The eight adopted KPIs (kpi-metrics.ts) ──────────────────────────────────────────────────────

// firstScanActivationRate(7): users created >7d ago; activated if any org they are a member of has a
// scan within [createdAt, createdAt+7d]. Membership-less users stay in the denominator.
{
  const r = await one(
    `with u as (select id, "createdAt" from "User" where "createdAt" < $1)
     select count(*)::int as cohort,
            count(*) filter (where exists (
              select 1 from "Membership" m join "Repository" r on r."orgId" = m."orgId"
              join "Scan" s on s."repoId" = r.id
              where m."userId" = u.id and s."scannedAt" >= u."createdAt" and s."scannedAt" <= u."createdAt" + interval '7 days'
            ))::int as activated
     from u`,
    [ago(7)],
  );
  readings.firstScanActivationRate = { ...rate(n(r.activated), n(r.cohort)), evidence: "User×Membership×Scan, 7-day window after signup" };
}

// reScanRate(30): repos whose first scan is >30d old; re-scanned if the second scan is within 30d of the first.
{
  const r = await one(
    `with f as (
       select "repoId", min("scannedAt") as first_at from "Scan" group by "repoId"
     ), s as (
       select f."repoId", f.first_at,
              (select min(sc."scannedAt") from "Scan" sc where sc."repoId" = f."repoId" and sc."scannedAt" > f.first_at) as second_at
       from f where f.first_at <= $1
     )
     select count(*)::int as eligible,
            count(*) filter (where second_at is not null and second_at - first_at <= interval '30 days')::int as rescanned
     from s`,
    [ago(30)],
  );
  readings.reScanRate = { ...rate(n(r.rescanned), n(r.eligible)), evidence: "Scan first/second per repo, 30-day window" };
}

// freeToPaidConversion(30): orgs whose first scan is >30d old; converted if Subscription.createdAt within 30d of it.
{
  const r = await one(
    `with o as (
       select o.id, (select min(s."scannedAt") from "Scan" s join "Repository" r on r.id = s."repoId" where r."orgId" = o.id) as first_scan,
              (select min(sub."createdAt") from "Subscription" sub where sub."orgId" = o.id) as sub_at
       from "Organization" o
     )
     select count(*) filter (where first_scan is not null and first_scan <= $1)::int as eligible,
            count(*) filter (where first_scan is not null and first_scan <= $1 and sub_at is not null and sub_at - first_scan <= interval '30 days')::int as converted
     from o`,
    [ago(30)],
  );
  readings.freeToPaidConversion = { ...rate(n(r.converted), n(r.eligible)), evidence: "Organization first Scan vs Subscription.createdAt, 30-day window" };
}

// orgFleetScanDepth(3): installation-linked orgs; deep if ≥3 repos have at least one scan.
{
  const r = await one(
    `select count(*)::int as orgs,
            count(*) filter (where (select count(distinct r.id) from "Repository" r join "Scan" s on s."repoId" = r.id where r."orgId" = o.id) >= 3)::int as deep
     from "Organization" o where o."githubInstallId" is not null`,
  );
  readings.orgFleetScanDepth = { ...rate(n(r.deep), n(r.orgs)), evidence: "installation-linked orgs with ≥3 scanned repos" };
}

// roadmapEngagementRate(14): scans delivered >14d ago; engaged if a status RecommendationEvent landed within 14d of scannedAt.
{
  const r = await one(
    `select count(*)::int as delivered,
            count(*) filter (where exists (
              select 1 from "RecommendationEvent" e join "Recommendation" rc on rc.id = e."recommendationId"
              where rc."scanId" = s.id and e.kind = 'status' and e."createdAt" >= s."scannedAt" and e."createdAt" <= s."scannedAt" + interval '14 days'
            ))::int as engaged
     from "Scan" s where s."scannedAt" < $1`,
    [ago(14)],
  );
  readings.roadmapEngagementRate = { ...rate(n(r.engaged), n(r.delivered)), evidence: "Scan × RecommendationEvent(kind=status) within 14 days" };
}

// weeklyActiveScanningOrgs(7): distinct orgs with a scan in the trailing 7 days (a count; 0 is real).
{
  const r = await one(
    `select count(distinct r."orgId")::int as orgs from "Scan" s join "Repository" r on r.id = s."repoId" where s."scannedAt" >= $1`,
    [ago(7)],
  );
  readings.weeklyActiveScanningOrgs = { value: n(r.orgs), numerator: null, denominator: null, evidence: "distinct Repository.orgId over Scan.scannedAt ≥ now-7d" };
}

// avgLlmCostPerScan(30): needs the price table (src/lib/db/usage.ts estimateLlmCostFromTable); not
// reproducible in SQL. Reported as the token-bearing cohort only, value null.
{
  const r = await one(
    `select count(*)::int as scans, count(*) filter (where coalesce("inputTokens",0)+coalesce("outputTokens",0) > 0)::int as tokened
     from "Scan" where "scannedAt" >= $1`,
    [ago(30)],
  );
  readings.avgLlmCostPerScan = { value: null, numerator: null, denominator: n(r.tokened), evidence: `price table lives in TypeScript; ${r.tokened} of ${r.scans} scans in window carry tokens — read via /api/kpi` };
}

// scanPipelineErrorRate: QuotaEvent counters, failed / (started - rejected).
{
  const rows = await all(`select kind, sum(count)::int as c from "QuotaEvent" where kind in ('scan_started','scan_rejected','scan_failed','scan_degraded') group by kind`);
  const sum = (k) => n(rows.find((x) => x.kind === k)?.c);
  const attempted = sum("scan_started") - sum("scan_rejected");
  readings.scanPipelineErrorRate = { ...rate(sum("scan_failed"), attempted), evidence: { rejected: sum("scan_rejected"), degraded: sum("scan_degraded"), kinds: Object.fromEntries(rows.map((x) => [x.kind, n(x.c)])) } };
}

// ── KPIs defined by the 2026-09-07 stewardship reading (backlog K1–K3) ───────────────────────────

// 1.1 installationLinkedOrgRate: kind='org' orgs with githubInstallId.
{
  const r = await one(`select count(*)::int as orgs, count(*) filter (where "githubInstallId" is not null)::int as linked from "Organization" where kind = 'org'`);
  readings.installationLinkedOrgRate = { ...rate(n(r.linked), n(r.orgs)), evidence: "Organization.kind='org' with githubInstallId not null" };
}

// 1.2 watchedRepoScanOkRate(7): watched repos in installation-linked orgs attempted in 7d; ok share; top errors.
{
  const r = await one(
    `select count(*)::int as attempted, count(*) filter (where r."lastScanStatus" = 'ok')::int as ok
     from "Repository" r join "Organization" o on o.id = r."orgId"
     where r.watched and o."githubInstallId" is not null and r."lastScanAttemptAt" >= $1`,
    [ago(7)],
  );
  const errs = await all(
    `select r."lastScanError" as err, count(*)::int as c from "Repository" r join "Organization" o on o.id = r."orgId"
     where r.watched and o."githubInstallId" is not null and r."lastScanAttemptAt" >= $1 and r."lastScanStatus" <> 'ok' and r."lastScanError" is not null
     group by 1 order by 2 desc limit 5`,
    [ago(7)],
  );
  readings.watchedRepoScanOkRate = { ...rate(n(r.ok), n(r.attempted)), evidence: { topErrors: errs } };
}

// 2.1 dimensionEvidenceCompleteness(30): ScanDimension rows of non-degraded scans in 30d; non-empty evidence array.
{
  const r = await one(
    `select count(*)::int as dims, count(*) filter (where d.evidence is not null and d.evidence <> '[]' and d.evidence <> '')::int as with_evidence
     from "ScanDimension" d join "Scan" s on s.id = d."scanId"
     where s."scannedAt" >= $1 and coalesce(s."engineDegraded", false) = false`,
    [ago(30)],
  );
  const byDim = await all(
    `select d."dimId", count(*)::int as dims, count(*) filter (where d.evidence is not null and d.evidence <> '[]' and d.evidence <> '')::int as with_evidence
     from "ScanDimension" d join "Scan" s on s.id = d."scanId"
     where s."scannedAt" >= $1 and coalesce(s."engineDegraded", false) = false group by 1 order by 1`,
    [ago(30)],
  );
  readings.dimensionEvidenceCompleteness = { ...rate(n(r.with_evidence), n(r.dims)), evidence: { byDim } };
}

// 3.1 aiPrGovernanceRate(30): AiChange MERGED in 30d; approved share.
{
  const r = await one(
    `select count(*)::int as merged, count(*) filter (where approved)::int as approved from "AiChange" where state = 'MERGED' and "mergedAt" >= $1`,
    [ago(30)],
  );
  readings.aiPrGovernanceRate = { ...rate(n(r.approved), n(r.merged)), evidence: "AiChange.state='MERGED', mergedAt ≥ now-30d, approved=true" };
}

// 3.2 aiUsageMeasuredFidelityRate(30): orgs with AiUsageRecord in 30d; share with any fidelity='measured'.
{
  const r = await one(
    `with o as (select "orgId", bool_or(fidelity = 'measured') as measured from "AiUsageRecord" where "periodStart" >= $1 group by 1)
     select count(*)::int as orgs, count(*) filter (where measured)::int as measured from o`,
    [ago(30)],
  );
  readings.aiUsageMeasuredFidelityRate = { ...rate(n(r.measured), n(r.orgs)), evidence: "AiUsageRecord.periodStart ≥ now-30d grouped by orgId" };
}

// ── KPIs defined by the 2026-09-07 second reading (backlog K10, K11) ─────────────────────────────

// Launch Fleet Map · lit-star rate: repositories in installation-linked orgs; share with ≥1 scan.
// The map paints a repo as a lit star when it has a maturity score and as a faint one when it does
// not (fleetMapStars.starLook); this is the share of the viewer's sky that is lit.
{
  const r = await one(
    `select count(*)::int as repos, count(*) filter (where exists (select 1 from "Scan" s where s."repoId" = r.id))::int as lit
     from "Repository" r join "Organization" o on o.id = r."orgId" where o."githubInstallId" is not null`,
  );
  readings.fleetMapLitStarRate = { ...rate(n(r.lit), n(r.repos)), evidence: "Repository in installation-linked orgs with ≥1 Scan" };
}

// Backlog Management · backlog triage rate: open recommendations older than 30 days on each repo's
// LATEST scan; share with at least one RecommendationEvent (someone or something touched it).
// Only the latest scan's recommendations count: older scans' rows are superseded, not backlog.
{
  const r = await one(
    `with latest as (select distinct on ("repoId") id from "Scan" order by "repoId", "scannedAt" desc)
     select count(*)::int as stale_open,
            count(*) filter (where exists (select 1 from "RecommendationEvent" e where e."recommendationId" = rc.id))::int as touched
     from "Recommendation" rc join latest l on l.id = rc."scanId"
     where rc.status = 'open' and rc."createdAt" < $1`,
    [ago(30)],
  );
  readings.backlogTriageRate = { ...rate(n(r.touched), n(r.stale_open)), evidence: "Recommendation(status=open, createdAt < now-30d) on each repo's latest Scan with ≥1 RecommendationEvent" };
}

await db.close();

const out = { nowIso: now.toISOString(), dataDir: resolve(dataDir), readings };
if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`PGlite KPI readings (env=local) @ ${out.nowIso} from ${out.dataDir}`);
  for (const [k, v] of Object.entries(readings)) {
    const frac = v.denominator === null ? "" : ` (${v.numerator ?? "-"}/${v.denominator})`;
    console.log(`  ${k}: ${v.value ?? "n/a"}${frac}`);
  }
}
