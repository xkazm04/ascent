// GET  /api/practices/rollout?org=<slug>&practiceId=<id>
//        -> { latestVersion, behind: string[], drifted: string[], removed: string[] }
// POST /api/practices/rollout  { org, practiceId, mode: "behind" | "drifted", repos: string[] }
//        -> { results: BatchResult[], attempted, skipped }
//
// MOONSHOT #33 — RE-CONVERGENCE. The fleet rollout that already exists (`/api/practices/apply-batch`)
// answers "who has never adopted this?". This one answers the question a subscription has to answer:
// who adopted it and has since fallen behind the org's own pattern, or let the artifact drift.
//
// It opens draft PRs into customer repositories, so it carries `apply-batch`'s exact floors and no
// weaker ones: org **admin** (not member), the 25-repo cap with the excess reported as `skipped`, a
// same-origin typed confirm on the client, per-repo error isolation, and every write through
// `applyPracticeToRepo` — one path, no fork. It is NOT an `[id]` route: the org arrives in the body
// and is gated BEFORE it reaches any query (gate-then-constrain), and every repo is re-validated
// against that org, so a foreign coordinate fails the whole call rather than partially applying.
//
// NOTHING HERE IS AUTOMATIC. Drift is a finding a human decides; this endpoint exists only because a
// human decided. Doing nothing remains a valid outcome and there is no scheduled caller.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { applyPracticeToRepo } from "@/lib/practices/apply";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getOrgId, recordAudit } from "@/lib/db";
import { listBehindRepos, listDriftedRepos } from "@/lib/db/practice-adoption";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { classifyPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import type { BatchResult } from "@/features/shared/practices/practiceApplyShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Mirrors `/api/practices/apply-batch`'s MAX_BATCH. A deliberate bound, not a tuning knob. */
const MAX_BATCH = 25;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const org = (url.searchParams.get("org") ?? "").trim().toLowerCase();
  const practiceId = (url.searchParams.get("practiceId") ?? "").trim();
  if (!org || !practiceId) {
    return NextResponse.json({ error: "Provide ?org= and ?practiceId=." }, { status: 400 });
  }
  // Read-only, so the MEMBER gate — the same floor every other org-scoped read on this tab uses.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const [behind, drift] = await Promise.all([
    listBehindRepos(org, practiceId),
    listDriftedRepos(org, practiceId),
  ]);
  // `latestVersion: null` means the org has NO mined pattern for this practice — not v0, and not
  // "everyone is current". The client must render it as "not version-tracked".
  return NextResponse.json({
    latestVersion: behind.latestVersion,
    behind: behind.repos,
    drifted: drift.drifted,
    removed: drift.removed,
  });
}

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open starter PRs." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    practiceId?: string;
    mode?: string;
    repos?: string[];
    base?: string;
  };
  const org = (body.org ?? "").trim().toLowerCase();
  const practiceId = (body.practiceId ?? "").trim();
  const mode = body.mode === "drifted" ? "drifted" : body.mode === "behind" ? "behind" : null;
  if (!org || !practiceId || !mode || !Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json(
      { error: "Provide { org, practiceId, mode: 'behind' | 'drifted', repos: ['owner/name', ...] }." },
      { status: 400 },
    );
  }

  // GATE FIRST, then constrain every query by the gated org. This pushes into customer repos, so the
  // floor is `admin` — identical to apply-batch, and deliberately above the member gate the GET uses.
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  const parsed = body.repos
    .map((raw) => ({ raw, ref: parseRepoUrl(raw) }))
    .filter((x): x is { raw: string; ref: NonNullable<ReturnType<typeof parseRepoUrl>> } => !!x.ref);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the batch." }, { status: 400 });
  }

  // Re-validate every coordinate against the org that was just GATED. A foreign repo fails the WHOLE
  // call rather than being reported as one failed row among successes: by then the successes have
  // already written into repositories, and no per-repo error line can undo a PR opened under a tenant
  // the caller had no standing over. (apply-batch derives its org FROM the repos; this route is given
  // the org in the body, so the check runs the other way round — and is strictly the tighter one.)
  const foreign = parsed.filter(({ ref }) => ref.owner.toLowerCase() !== org);
  if (foreign.length > 0) {
    return NextResponse.json(
      { error: `Not repositories of ${org}: ${foreign.map((f) => f.raw).slice(0, 5).join(", ")}.` },
      { status: 403 },
    );
  }

  // Dedupe BEFORE the cap: two workers on one repo race `openDraftPr` on the same branch — one wins,
  // the other surfaces a confusing ref-exists error, and a cap slot is burned for nothing.
  const seen = new Set<string>();
  const unique = parsed.filter(({ ref }) => {
    const key = `${ref.owner}/${ref.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const batch = unique.slice(0, MAX_BATCH);
  const skipped = unique.length - batch.length;

  try {
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;
    const { token } = ctx;
    const orgId = (await getOrgId(org).catch(() => null)) ?? undefined;
    // The version span this rollout is closing, recorded on the audit row so "why did 12 PRs open on
    // Tuesday" has an answer that outlives the session. Null for a drift rollout (no version moved) and
    // for a practice with no mined pattern — absent, never 0.
    const versions = mode === "behind" ? await listBehindRepos(org, practiceId).catch(() => null) : null;

    const results = await mapPool<(typeof batch)[number], BatchResult>(batch, SCAN_CONCURRENCY, async ({ raw, ref }) => {
      try {
        const result = await applyPracticeToRepo(
          token,
          ref,
          practiceId,
          body.base,
          { orgId, actorId: actorLogin ?? undefined, batch: true },
          { orgSlug: org },
        );
        if (result.kind === "unknown-practice") {
          return { repo: result.ctx.fullName, ok: false, error: `Unknown practice "${practiceId}".` };
        }
        if (result.kind === "content-drift") {
          return { repo: result.ctx.fullName, ok: false, error: "Content changed since preview. Re-preview." };
        }
        return { repo: result.ctx.fullName, ok: true, url: result.pr.url, reused: result.pr.reused };
      } catch (err) {
        const classified = classifyPrWriteError(err);
        return { repo: raw, ok: false, error: classified?.message ?? "Failed to open the starter PR." };
      }
    });

    await recordAudit(
      "practice.rollout_opened",
      {
        practiceId,
        mode,
        fromVersion: versions?.fromVersion ?? null,
        toVersion: versions?.latestVersion ?? null,
        repos: batch.length,
        batch: true,
      },
      { orgId, actorId: actorLogin ?? undefined },
    );

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[practices/rollout] failed", err);
    return NextResponse.json({ error: "Failed to open the rollout PRs." }, { status: 500 });
  }
}
