// POST /api/report/conformance  { repo: "owner/name", headSha?, score, fails, warns } -> { ok }
//
// Ingest a `.ai/` standard conformance report from a repo's doctor (`node .ai/doctor.mjs --json`,
// which can auto-POST here when ASCENT_CONFORMANCE_URL + _TOKEN are set in CI). Closes the product's
// core adopt→verify→re-score loop: the doctor self-certifies in-repo, this records the result onto
// the Repository row, and the org dashboard surfaces it. `headSha` orders re-runs via the
// conformance ledger (see recordConformance): a stale CI re-run of an already-superseded commit is
// acknowledged but NOT persisted ({ stale: true }). Gated either by a deployment CI token
// (CONFORMANCE_INGEST_TOKEN, the unattended path) or, for an interactive caller, org ownership.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { isDbConfigured, recordConformance } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const int = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
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

  // Auth: a deployment-wide CI token (the unattended doctor/CI path) OR an interactive org owner.
  const ingestToken = process.env.CONFORMANCE_INGEST_TOKEN;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const ciAuthed = !!ingestToken && bearer === ingestToken;
  if (!ciAuthed) {
    const denied = await requireOrgAccess(parsed.owner);
    if (denied) return denied;
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
