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
import { sanitizeGatePolicy } from "@/lib/scoring/gate";
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
  let budget = SWEEP_PR_CAP;
  for (const r of repos) {
    if (budget <= 0) break;
    let prs: OpenPr[];
    try {
      prs = await githubAppFetch<OpenPr[]>(
        `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}/pulls?state=open&per_page=${budget}`,
        token,
      );
    } catch (err) {
      // Failure isolation: an archived/renamed/inaccessible repo must not cost the rest of the fleet
      // its re-check.
      console.warn(
        `[gate-policy] sweep: could not list open PRs for ${r.owner}/${r.name}`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }
    for (const pr of Array.isArray(prs) ? prs : []) {
      if (budget <= 0) break;
      const prNumber = pr.number;
      const headSha = pr.head?.sha;
      const baseRef = pr.base?.ref;
      if (!prNumber || !headSha || !baseRef) continue;
      budget -= 1;
      // No hooks: the installation was resolved FROM the org (not from an untrusted webhook payload),
      // so there is no (installationId, owner) pair to bind, and there is no delivery claim to release.
      await runPrGate({ installationId, owner: r.owner, repo: r.name, prNumber, headSha, baseRef });
    }
  }
  console.info(`[gate-policy] swept ${SWEEP_PR_CAP - budget} open PR(s) for ${org} after a policy change`);
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
  const stored = await setOrgGatePolicy(org, clean);
  if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  // resolveViewerLogin, not getSession: the dormant custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this audit row recorded a null actor in production.
  const actorLogin = await resolveViewerLogin();
  // SEC #1: actor goes in the dedicated `actorId` column so the viewer/filter can surface it.
  await recordOrgAudit(
    "org.gate_policy",
    org,
    { org, action: stored ? "set" : "cleared" },
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
