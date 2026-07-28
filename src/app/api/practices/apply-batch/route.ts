// POST /api/practices/apply-batch  { repos: ["owner/name", ...], practiceId, base? }
//   -> { results: [{ repo, ok, url?, reused?, error? }], attempted, skipped }
// Fleet rollout of the "systematic apply" step: open a draft PR seeding a practice's leak-free
// starter into EVERY gap repo in one action, instead of clicking through a dropdown N times. Same
// trust model as /api/practices/apply (App installed + signed-in + org-owned) — all repos must
// belong to one org, gated once, then fanned out with bounded concurrency so a big fleet doesn't
// hammer GitHub or trip the function timeout. One bad repo never aborts the rest.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { applyPracticeToRepo } from "@/lib/practices/apply";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getOrgId } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { classifyPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import type { BatchResult } from "@/components/org/practices/practice-apply-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cap a single batch so one click can't open hundreds of PRs / run past the function ceiling. */
const MAX_BATCH = 25;

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  // The sign-in check used to key on isAuthConfigured() alone -- the DORMANT custom-OAuth env, false
  // in production -- so it never fired there and the actor below was always null. Gate whenever
  // EITHER stack is live (Supabase wall or a dev box with the legacy OAuth configured); a fully
  // auth-off local/demo deployment stays open, exactly as before.
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open starter PRs." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { repos?: string[]; practiceId?: string; base?: string };
  if (!body.practiceId || !Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { repos: ['owner/name', ...], practiceId }." }, { status: 400 });
  }

  // Parse + validate; every repo must belong to ONE org so a single tenant gate covers the batch.
  const parsed = body.repos
    .map((raw) => ({ raw, ref: parseRepoUrl(raw) }))
    .filter((x): x is { raw: string; ref: NonNullable<ReturnType<typeof parseRepoUrl>> } => !!x.ref);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the batch." }, { status: 400 });
  }
  const owners = new Set(parsed.map((x) => x.ref.owner.toLowerCase()));
  if (owners.size > 1) {
    return NextResponse.json({ error: "All repos in a batch must belong to the same org." }, { status: 400 });
  }
  const owner = parsed[0]!.ref.owner;

  // Tenant gate: this opens PRs (WRITES) with the org's installation token — require at least the
  // "admin" role, matching other org-wide mutations of comparable blast radius (segment delete,
  // credit grants), not merely "member".
  const denied = await requireOrgRole(owner, "admin");
  if (denied) return denied;

  // Dedupe before the cap: the API is a public surface (the UI sends from a Set, but a raw caller
  // can repeat a repo), and two workers for one repo race openDraftPr on the SAME ascent/<practice>
  // branch — one wins, the other surfaces a confusing ref-exists error, plus a burned cap slot and a
  // double audit row. "One repo = one worker" is enforced, not assumed.
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
    // Install presence (403) + installation-token mint, single-sourced across the PR-write routes. A
    // mint failure throws into the catch below, which keeps THIS route's own "couldn't mint" 502 copy.
    const ctx = await requirePrWriteContext(owner);
    if (ctx instanceof Response) return ctx;
    const { token } = ctx;
    const orgId = (await getOrgId(owner.toLowerCase()).catch(() => null)) ?? undefined;

    // Bounded fan-out; the per-repo worker owns its errors so one failure can't abort the pool.
    const results = await mapPool<typeof batch[number], BatchResult>(batch, SCAN_CONCURRENCY, async ({ raw, ref }) => {
      try {
        const result = await applyPracticeToRepo(token, ref, body.practiceId!, body.base, {
          orgId,
          actorId: actorLogin ?? undefined,
          batch: true,
        });
        if (result.kind === "unknown-practice") {
          return { repo: result.ctx.fullName, ok: false, error: `Unknown practice "${body.practiceId}".` };
        }
        // Unreachable (the batch passes no fingerprint — its per-repo content is generated at apply
        // time, which the confirm copy states), but keep the union handled exhaustively.
        if (result.kind === "content-drift") {
          return { repo: result.ctx.fullName, ok: false, error: "Content changed since preview — re-preview." };
        }
        const { pr, ctx } = result;
        return { repo: ctx.fullName, ok: true, url: pr.url, reused: pr.reused };
      } catch (err) {
        // Single-sourced with the other PR-write routes' error mapping (@/lib/github/pr-route); only
        // the message is used here (the aggregate response is a 200 whatever the per-repo mix), unlike
        // mapPrWriteError's callers which map the whole route to one HTTP status.
        const classified = classifyPrWriteError(err);
        return { repo: raw, ok: false, error: classified?.message ?? "Failed to open the starter PR." };
      }
    });

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[practices/apply-batch] failed", err);
    return NextResponse.json({ error: "Failed to open the starter PRs." }, { status: 500 });
  }
}
