// GET  /api/org/gate-policy?org=slug         -> { policy }                     (member read)
// POST /api/org/gate-policy { org, policy }    -> { ok, policy, sweep }        (owner)  set; policy:null clears
//
// The per-org CI maturity-gate policy (GATE-1). The App-mode PR Check Run + the governance fleet view
// resolve THIS policy (falling back to the archetype default when unset). Owner-gated on write — it
// changes the bar that blocks merges across the org. The stored value is sanitized on write.
//
// A policy change must take effect HONESTLY. Before, tightening the bar re-evaluated nothing: the
// handler wrote an audit row and returned, so every already-open PR kept its stale green check until
// the next push or a manual re-run — while the fleet dashboard re-evaluated live on page load. "I
// changed the bar on Monday and Friday's PRs still show green" is the fastest way to lose trust in a
// merge-blocking control. So a successful save now schedules a BOUNDED, best-effort sweep that
// re-runs the gate on the org's open PRs through the SAME check-writing path the webhook uses
// (@/lib/github/pr-gate) — never a second, drifting check writer. The response says exactly what was
// scheduled (or why nothing was), so the editor can state when the bar applies instead of guessing.

import { NextResponse, after } from "next/server";
import {
  getInstallationIdForOwner,
  getOrgGatePolicy,
  isDbConfigured,
  listWatchedRepos,
  recordOrgAudit,
  setOrgGatePolicy,
} from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";
import { describeGatePolicy, sanitizeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";
import { getInstallationToken, githubAppFetch, isAppConfigured } from "@/lib/github/app";
import { runPrGate } from "@/lib/github/pr-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The sweep runs in after(), which shares the route's max duration — a policy save answers instantly
// but the deferred re-checks need room to scan up to SWEEP_PR_CAP PRs (mock scans, same budget the
// webhook gate gets).
export const maxDuration = 300;

/** Hard ceiling on re-checked PRs per policy change. A best-effort courtesy sweep, not a guarantee —
 *  anything past the cap picks the new bar up on its next push or a manual "Re-run". */
const SWEEP_PR_CAP = 20;
/** Ceiling on repos we ask GitHub to list PRs for, so a large fleet can't turn one save into hundreds
 *  of API calls before the PR budget happens to run out. */
const SWEEP_REPO_CAP = 25;
/** How many REPOS are swept at once. Deliberately across repos, never within one: GitHub asks callers
 *  not to issue concurrent MUTATING requests against the same repository, and every gated PR writes a
 *  Check Run plus a comment. So each repo's PRs stay strictly serial while several repos progress in
 *  parallel — the shape that shortens the sweep without courting a secondary rate limit. */
const SWEEP_CONCURRENCY = 4;
/** Wall-clock ceiling on the deferred sweep, inside the route's maxDuration=300 with headroom for the
 *  gate already in flight to finish. Serial sweeps of 20 PRs (2 mock scans each) could exceed the
 *  runtime's budget and be KILLED mid-flight, which looks identical to "the bar applied everywhere" —
 *  the response already promised a re-check. Stopping on our own terms lets us SAY what was left. */
const SWEEP_DEADLINE_MS = 240_000;

type SweepPlan =
  | { status: "scheduled"; repos: number; cap: number }
  | { status: "skipped"; reason: "no-installation" | "no-watched-repos"; repos: number; cap: number };

interface OpenPr {
  number?: number;
  draft?: boolean;
  head?: { sha?: string };
  base?: { ref?: string };
}

/**
 * Re-run the maturity gate on the org's open PRs after its bar changed. Bounded (SWEEP_REPO_CAP repos
 * / SWEEP_PR_CAP PRs), deferred, and TOTALLY best-effort: every failure is logged and isolated to the
 * one repo or PR it belongs to, so a single 404/rate-limit can neither abort the sweep nor bubble out
 * of after(). runPrGate itself never throws and posts a neutral check when it can't evaluate.
 */
async function sweepOpenPrGates(
  org: string,
  installationId: number,
  repos: { owner: string; name: string }[],
): Promise<void> {
  let token: string;
  try {
    token = await getInstallationToken(installationId);
  } catch (err) {
    console.warn(`[gate-policy] sweep: no installation token for ${org}`, err instanceof Error ? err.message : err);
    return;
  }
  // The PR budget is claimed SYNCHRONOUSLY (JS single-threaded, so the read-decrement pair is atomic),
  // which is what lets several repo workers share one cap without over-spending it.
  let budget = SWEEP_PR_CAP;
  const claimPr = (): boolean => (budget > 0 ? (budget -= 1, true) : false);
  const startedAt = Date.now();
  const outOfTime = () => Date.now() - startedAt > SWEEP_DEADLINE_MS;
  let timedOut = false;

  // A shared work queue rather than a slice-per-worker: repos have wildly different PR counts, so a
  // static split would leave workers idle while one grinds through the busiest repo.
  const queue = [...repos];
  const sweepRepo = async (r: { owner: string; name: string }): Promise<void> => {
    let prs: OpenPr[];
    try {
      // per_page is deliberately NOT the remaining budget. One listing costs the same single API call
      // at any page size, and sizing it to the budget meant a repo whose first N open PRs are all
      // drafts (skipped below) could yield nothing while mergeable PRs sat just past the page edge.
      // The budget still bounds the WORK — it is decremented per gated PR, not per listed one.
      prs = await githubAppFetch<OpenPr[]>(
        `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/pulls?state=open&per_page=100`,
        token,
      );
    } catch (err) {
      // Failure isolation: an archived/renamed/inaccessible repo must not cost the rest of the fleet
      // its re-check.
      console.warn(
        `[gate-policy] sweep: could not list open PRs for ${r.owner}/${r.name}`,
        err instanceof Error ? err.message : err,
      );
      return;
    }
    for (const pr of Array.isArray(prs) ? prs : []) {
      if (budget <= 0) return;
      if (outOfTime()) {
        timedOut = true;
        return;
      }
      // A DRAFT costs no budget. GitHub refuses to merge one, so its check blocks nothing today, and
      // the App webhook's PR_ACTIONS includes `ready_for_review` — the moment a draft becomes
      // mergeable it is re-gated against the CURRENT bar anyway. Spending the courtesy budget on
      // drafts starved the PRs actually waiting to merge, which are the only ones a bar change can
      // wrongly keep green or wrongly keep blocked. (`draft` was declared on OpenPr and never read.)
      if (pr.draft === true) continue;
      const prNumber = pr.number;
      const headSha = pr.head?.sha;
      const baseRef = pr.base?.ref;
      if (!prNumber || !headSha || !baseRef) continue;
      if (!claimPr()) return; // another repo's worker took the last slot
      // No hooks: the installation was resolved FROM the org (not from an untrusted webhook payload),
      // so there is no (installationId, owner) pair to bind, and there is no delivery claim to release.
      await runPrGate({ installationId, owner: r.owner, repo: r.name, prNumber, headSha, baseRef });
    }
  };

  // Each worker pulls the next repo until the queue drains or the sweep runs out of budget/time. The
  // shift is synchronous, so workers can never take the same repo twice.
  const worker = async (): Promise<void> => {
    for (;;) {
      if (budget <= 0 || outOfTime()) {
        if (budget > 0 && queue.length > 0) timedOut = true;
        return;
      }
      const r = queue.shift();
      if (!r) return;
      await sweepRepo(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, repos.length) }, worker));

  // Say what was left undone. A truncated sweep that logs only its successes reads exactly like a
  // complete one, and the owner was told open PRs would re-check.
  const swept = SWEEP_PR_CAP - budget;
  const unswept = queue.length;
  console.info(
    `[gate-policy] swept ${swept} open PR(s) for ${org} after a policy change` +
      (timedOut ? ` — STOPPED at the ${SWEEP_DEADLINE_MS / 1000}s deadline with ${unswept} repo(s) unswept` : "") +
      (!timedOut && budget <= 0 && unswept > 0 ? ` — hit the ${SWEEP_PR_CAP}-PR cap with ${unswept} repo(s) unswept` : ""),
  );
}

/**
 * Decide — synchronously and cheaply (two DB reads, no GitHub calls) — whether a sweep can run, then
 * schedule it. The plan is returned so the response can tell the owner when the new bar actually
 * applies; the PR listing + re-checks happen in after(), never blocking the save.
 */
async function scheduleSweep(org: string): Promise<SweepPlan> {
  const installationId = isAppConfigured() ? await getInstallationIdForOwner(org).catch(() => null) : null;
  if (!installationId) {
    // No App installation → we have no way to write a Check Run at all. Say so plainly rather than
    // implying a re-check that can never happen.
    return { status: "skipped", reason: "no-installation", repos: 0, cap: SWEEP_PR_CAP };
  }
  const watched = await listWatchedRepos(org).catch(() => []);
  const repos = watched.slice(0, SWEEP_REPO_CAP).map((r) => ({ owner: r.owner, name: r.name }));
  if (repos.length === 0) {
    return { status: "skipped", reason: "no-watched-repos", repos: 0, cap: SWEEP_PR_CAP };
  }
  after(() => sweepOpenPrGates(org, Number(installationId), repos));
  return { status: "scheduled", repos: repos.length, cap: SWEEP_PR_CAP };
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Gate policy requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  return NextResponse.json({ policy: await getOrgGatePolicy(org) });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Gate policy requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ policy?: unknown }>(request, { missingOrgError: "Provide { org, policy }." });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  // null clears (back to the archetype default); anything else is sanitized — an all-invalid object
  // sanitizes to null, which also clears (a no-op policy is the default).
  const clean = body.policy == null ? null : sanitizeGatePolicy(body.policy);
  // The bar BEFORE this write, captured for the audit row below. Best-effort on purpose — unlike the
  // gate's own policy read (which fails closed, because gating on the wrong bar is a security event),
  // this one only enriches a log line and must never fail a save that is otherwise fine.
  const previous = await getOrgGatePolicy(org).catch(() => null);
  const stored = await setOrgGatePolicy(org, clean);
  if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
  //
  // Record WHAT the bar became, not just that it moved. This is the org's merge-blocking control, and
  // an audit row saying only `action: "set"` cannot answer the question such a log exists for — "who
  // lowered the security floor from 70 to 30, and when". Peer routes (alerts thresholds, llm-provider)
  // already log their actual values; this one didn't. `status` is the generic field the audit viewer
  // renders for non-scan rows, so the bar shows up in the table with no change to that component, and
  // the bits come from describeGatePolicy — the same canonical enumeration the dashboard, gate URL, CI
  // snippet and PR footer render, so the audit trail can't advertise a bar different from the enforced one.
  const barBits = (p: GatePolicy | null) => describeGatePolicy(p ?? {}).map((c) => c.bit).join(" · ");
  await recordOrgAudit(
    "org.gate_policy",
    org,
    {
      org,
      action: stored ? "set" : "cleared",
      status: stored ? barBits(stored) || "no enforced condition" : "cleared: archetype default",
      policy: stored ?? null,
      previousPolicy: previous,
      previousStatus: previous ? barBits(previous) : "archetype default",
    },
    actorLogin ?? undefined,
  ).catch(() => {});
  // The bar moved — re-evaluate open PRs so they don't sit on a verdict from the OLD policy. Both
  // directions matter: a tightened bar must stop showing green, and a relaxed one must stop blocking.
  // Best-effort; a planning failure must never fail the save that already succeeded.
  const sweep = await scheduleSweep(org).catch((err) => {
    console.warn("[gate-policy] could not schedule the re-check sweep", err instanceof Error ? err.message : err);
    return { status: "skipped", reason: "no-installation", repos: 0, cap: SWEEP_PR_CAP } satisfies SweepPlan;
  });
  return NextResponse.json({ ok: true, policy: stored, sweep });
}
