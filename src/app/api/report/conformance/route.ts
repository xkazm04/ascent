// POST /api/report/conformance  { repo: "owner/name", headSha?, score, fails, warns } -> { ok }
//
// Ingest a `.ai/` standard conformance report from a repo's doctor (`node .ai/doctor.mjs --json`,
// which can auto-POST here when ASCENT_CONFORMANCE_URL + _TOKEN are set in CI). Closes the product's
// core adopt→verify→re-score loop: the doctor self-certifies in-repo, this records the result onto
// the Repository row, and the org dashboard surfaces it. `headSha` orders re-runs via the
// conformance ledger (see recordConformance): a stale CI re-run of an already-superseded commit is
// acknowledged but NOT persisted ({ stale: true }).
//
// AUTH — this is a CROSS-TENANT WRITE, so the credential must name the org it may write:
//   1. an org-scoped API token (`Authorization: Bearer askl_…`, scope `telemetry:write`) — the
//      preferred unattended path. authorizeOrgApi refuses the token unless its org matches the owner
//      of `body.repo`, so org A's CI cannot post org B's score.
//   2. an interactive org owner (session) — the browser/manual path.
//   3. LEGACY: the deployment-wide CONFORMANCE_INGEST_TOKEN. This token is bound to NO org — any
//      holder could POST { repo: "victimOrg/victimRepo", score: 0 } and clobber another tenant's
//      score. It is still accepted (live CI depends on it) but only with a loud warning, and setting
//      CONFORMANCE_INGEST_STRICT=1 disables it entirely so a deployment can close the hole once its
//      runners have moved to per-org tokens.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { isDbConfigured, recordConformance } from "@/lib/db";
import { listConformanceReports } from "@/lib/db/org-conformance";
import { CHECK_LEVELS, isValidCheckId, type CheckLevel } from "@/lib/standard/check-ids";
import { authorizeOrgApi, isDenied } from "@/lib/api-token-auth";
import { PUBLIC_ORG, readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One reported conformance data point, newest-first (mirrors the audit ledger's own order). */
export interface ConformanceTrendPoint {
  at: string;
  score: number;
  fails: number;
  warns: number;
  sha: string | null;
}

// Require an ACTUAL number (or a numeric string a shell-built JSON payload might send) — not
// "coerces to one". `Number(v)` before the finiteness check let null/""/false/[] all coerce to 0
// (and true to 1), silently passing validation and persisting a fabricated score:0 for a buggy CI
// client that sent score:null, instead of a 400 (G3-12). A bare `typeof v === "number"` gate would
// also reject legitimate numeric strings (curl/shell JSON often sends `"score": "82"`), so strings are
// still accepted but only after confirming they're non-empty/non-whitespace — "" must not silently
// become 0 the way `Number("")` does.
/**
 * G2-32 — constant-time compare for the LEGACY shared CONFORMANCE_INGEST_TOKEN. A length mismatch
 * returns false WITHOUT calling timingSafeEqual (which throws on unequal-length buffers) — the length is
 * not the secret. The plain `===` it replaces is a timing oracle on a deployment-wide credential that
 * can write ANY org's conformance score. The per-org path (`verifyOrgApiToken`, via authorizeOrgApi) has
 * always compared in constant time; this brings the deprecated fallback to the same bar until
 * CONFORMANCE_INGEST_STRICT=1 retires it.
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const int = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null; // null / boolean / array / object: no coercion trick, always rejected
};

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Conformance reporting requires a database." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    headSha?: string;
    score?: unknown;
    fails?: unknown;
    warns?: unknown;
    // #16 — the run's shape and its per-check findings. Every one is OPTIONAL: a doctor older than
    // spec 0.3.0 sends none of them and must keep working, so absence is stored as `summaryOnly`
    // rather than rejected. Absence is never read as a pass, which is the whole reason the flag
    // exists (see the matrix's honest `unchecked` cells).
    unchecked?: unknown;
    scored?: unknown;
    specVersion?: unknown;
    runShape?: unknown;
    findings?: unknown;
  };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  const score = int(body.score);
  const fails = int(body.fails);
  const warns = int(body.warns);
  if (score === null || fails === null || warns === null) {
    return NextResponse.json({ error: "Provide numeric score, fails, warns." }, { status: 400 });
  }
  // headSha (optional): the commit this report certifies. Previously parsed and then DROPPED, which
  // left the persisted score last-write-wins — a re-run of an old workflow silently clobbered the
  // newest result (ai-native-standard #2). Validate the shape so the ledger only ever holds real
  // shas; null/absent stays allowed (older doctors, local runs).
  let headSha: string | null = null;
  if (body.headSha !== undefined && body.headSha !== null) {
    if (typeof body.headSha !== "string" || !/^[0-9a-f]{7,40}$/i.test(body.headSha.trim())) {
      return NextResponse.json({ error: "headSha must be a 7-40 char hex commit sha (or null)." }, { status: 400 });
    }
    headSha = body.headSha.trim();
  }
  // Bound the SELF-ATTESTED values before persisting. The doctor always sends in-range numbers, but this
  // endpoint is org/CI-token authed, not trusted — without bounds a buggy or hostile reporter could
  // persist score=999999 (or a negative) and poison the Repository row + every org-dashboard aggregate
  // that reads it. score is a 0-100 percentage; fails/warns are non-negative counts (sane upper cap).
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const boundedScore = clamp(score, 0, 100);
  const boundedFails = clamp(fails, 0, 100_000);
  const boundedWarns = clamp(warns, 0, 100_000);
  const boundedUnchecked = clamp(int(body.unchecked) ?? 0, 0, 100_000);
  const boundedScored = clamp(int(body.scored) ?? 0, 0, 100_000);
  if (body.runShape !== undefined && body.runShape !== "plain" && body.runShape !== "run") {
    return NextResponse.json({ error: "runShape must be 'plain' or 'run'." }, { status: 400 });
  }
  const runShape: "plain" | "run" = body.runShape === "run" ? "run" : "plain";
  const specVersion =
    typeof body.specVersion === "string" && /^\d+\.\d+\.\d+$/.test(body.specVersion.trim())
      ? body.specVersion.trim()
      : null;

  // Findings are SELF-REPORTED by a repo's CI, so every field is validated rather than trusted: a
  // malformed id would become an unqueryable ledger column, and an unbounded array is a write
  // amplification an org token should not be able to buy. A 400 (not a silent drop) so a broken
  // reporter learns it is broken instead of appearing to report cleanly forever.
  let findings: { check: string; level: CheckLevel; message?: string }[] | undefined;
  if (body.findings !== undefined && body.findings !== null) {
    if (!Array.isArray(body.findings)) {
      return NextResponse.json({ error: "findings must be an array." }, { status: 400 });
    }
    if (body.findings.length > 500) {
      return NextResponse.json({ error: "findings may hold at most 500 entries." }, { status: 400 });
    }
    findings = [];
    for (const raw of body.findings as unknown[]) {
      const f = raw as { check?: unknown; level?: unknown; message?: unknown };
      if (typeof f.check !== "string" || !isValidCheckId(f.check)) {
        return NextResponse.json({ error: "Each finding needs a check id matching /^[a-z][a-z0-9]*(\\.[a-z0-9._/-]+)*$/ (max 120 chars)." }, { status: 400 });
      }
      if (typeof f.level !== "string" || !(CHECK_LEVELS as readonly string[]).includes(f.level)) {
        return NextResponse.json({ error: "Each finding's level must be pass | warn | fail | unchecked." }, { status: 400 });
      }
      findings.push({
        check: f.check,
        level: f.level as CheckLevel,
        message: typeof f.message === "string" ? f.message.slice(0, 300) : "",
      });
    }
  }

  // Auth. The legacy shared token is checked FIRST only so we can log/refuse it explicitly; every
  // other credential (org token or session) goes through authorizeOrgApi, which binds the caller to
  // `parsed.owner`. An `askl_` bearer never reaches the legacy branch — it can't equal the shared
  // token in any deployment that mints real org tokens, and authorizeOrgApi owns that credential.
  const ingestToken = process.env.CONFORMANCE_INGEST_TOKEN;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const legacyMatch = !!ingestToken && !!bearer && !bearer.startsWith("askl_") && tokenMatches(bearer, ingestToken);
  const strict = /^(1|true|yes|on)$/i.test(process.env.CONFORMANCE_INGEST_STRICT ?? "");
  if (legacyMatch && strict) {
    return NextResponse.json(
      {
        error:
          "The shared CONFORMANCE_INGEST_TOKEN is disabled (CONFORMANCE_INGEST_STRICT). Use an org-scoped API token with the telemetry:write scope.",
      },
      { status: 403 },
    );
  }
  if (legacyMatch) {
    console.warn(
      `[conformance] DEPRECATED: shared CONFORMANCE_INGEST_TOKEN accepted for ${parsed.owner}/${parsed.repo}. ` +
        "This token is not bound to any org — any holder can overwrite any org's score. Mint an org API " +
        "token with the telemetry:write scope and set CONFORMANCE_INGEST_STRICT=1.",
    );
  } else {
    // telemetry:write — self-reporting a doctor result is the same lower-trust "report usage"
    // capability as skill telemetry, not authoring rights.
    const auth = await authorizeOrgApi(request, parsed.owner, { scope: "telemetry:write", mode: "write" });
    if (isDenied(auth)) return auth.denied;
  }

  const fullName = `${parsed.owner}/${parsed.repo}`;
  const { recorded, stale } = await recordConformance(parsed.owner, fullName, {
    score: boundedScore,
    fails: boundedFails,
    warns: boundedWarns,
    headSha,
    unchecked: boundedUnchecked,
    scored: boundedScored,
    specVersion,
    runShape,
    findings,
  });
  // `stale:true` = this sha was already reported before a newer commit — the score was deliberately
  // NOT overwritten. `recorded:false` (without stale) means the repo isn't tracked under this org
  // yet — not an error; watch it first.
  return NextResponse.json({ ok: true, recorded, stale, repo: fullName });
}

// GET /api/report/conformance?repo=owner/name[&limit=50] -> { repo, points, regressed, checks }
//
// The Continuous Conformance trend. It used to be RECONSTRUCTED by walking up to 1,000 audit rows per
// request — the ledger was the only per-report history there was, so the trend was assembled by
// filtering a shared, org-wide table for `conformance.reported` rows belonging to one repo. #16 gives
// the reports their own table, so this is now an indexed read of exactly the rows asked for, and the
// audit walk is gone. The `conformance.reported` AuditLog row still exists and is still signed — it is
// the tamper-evident copy; only the READER moved off it.
//
// `points` keeps its exact ConformanceTrendPoint shape so no client changes; `checks` is additive.

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Conformance history requires a database." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const parsed = parseRepoUrl(searchParams.get("repo") ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide ?repo=owner/name." }, { status: 400 });

  const org = await readableOrgForOwner(parsed.owner);
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Conformance history is only available for org-owned repositories." }, { status: 403 });
  }
  // Read-side tenant gate — this surfaces the org's own audit ledger content, same sensitivity as
  // /api/audit, so any org member (not just admin) may read it.
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit")) || 50));
  const fullName = `${parsed.owner}/${parsed.repo}`;
  try {
    const reports = (await listConformanceReports(org, fullName, limit)) ?? [];
    const points: ConformanceTrendPoint[] = reports.map((r) => ({
      at: r.reportedAt,
      score: r.score,
      fails: r.fails,
      warns: r.warns,
      sha: r.headSha,
    }));
    // Regression: the newest report scored lower than the one immediately before it (points are
    // newest-first). A single-point history has nothing to regress against.
    // Destructured rather than indexed: `length >= 2` does not narrow index access under
    // noUncheckedIndexedAccess, and an explicit pair reads as the comparison it is.
    const [newest, prior] = points;
    const regressed = newest !== undefined && prior !== undefined && newest.score < prior.score;
    // The per-check state of the LATEST report. A summary-only report (a doctor older than spec
    // 0.3.0) carries no findings, so `checks` is empty and the client says "summary-only" — it must
    // never render an absent finding as a passing control.
    const latest = reports[0];
    const checks = latest && !latest.summaryOnly ? latest.findings : [];
    return NextResponse.json({
      repo: fullName,
      points,
      regressed,
      checks,
      summaryOnly: latest ? latest.summaryOnly : null,
    });
  } catch (err) {
    console.error("[conformance] trend query failed", err);
    return NextResponse.json({ error: "Failed to load conformance history." }, { status: 500 });
  }
}
