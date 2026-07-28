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

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { isDbConfigured, recordConformance } from "@/lib/db";
import { authorizeOrgApi, isDenied } from "@/lib/api-token-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Require an ACTUAL number (or a numeric string a shell-built JSON payload might send) — not
// "coerces to one". `Number(v)` before the finiteness check let null/""/false/[] all coerce to 0
// (and true to 1), silently passing validation and persisting a fabricated score:0 for a buggy CI
// client that sent score:null, instead of a 400 (G3-12). A bare `typeof v === "number"` gate would
// also reject legitimate numeric strings (curl/shell JSON often sends `"score": "82"`), so strings are
// still accepted but only after confirming they're non-empty/non-whitespace — "" must not silently
// become 0 the way `Number("")` does.
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

  // Auth. The legacy shared token is checked FIRST only so we can log/refuse it explicitly; every
  // other credential (org token or session) goes through authorizeOrgApi, which binds the caller to
  // `parsed.owner`. An `askl_` bearer never reaches the legacy branch — it can't equal the shared
  // token in any deployment that mints real org tokens, and authorizeOrgApi owns that credential.
  const ingestToken = process.env.CONFORMANCE_INGEST_TOKEN;
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  const legacyMatch = !!ingestToken && !!bearer && bearer === ingestToken && !bearer.startsWith("askl_");
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
  });
  // `stale:true` = this sha was already reported before a newer commit — the score was deliberately
  // NOT overwritten. `recorded:false` (without stale) means the repo isn't tracked under this org
  // yet — not an error; watch it first.
  return NextResponse.json({ ok: true, recorded, stale, repo: fullName });
}
