// POST /api/app/webhook — GitHub App events. Verifies the HMAC signature, then:
//   • installation events                      → keep stored installations in sync.
//   • pull_request (opened/synced/reopened)    → run the maturity gate on the repo and post a
//                                                Check Run + sticky PR comment (Feature 2).
//   • push (to the default branch, head moved) → re-scan a watched repo and alert on a
//                                                regression vs the prior scan (Feature 4).
//
// GitHub expects a fast 2xx, so the scan work runs in `after()` — scheduled to execute AFTER the
// response is sent, within the route's maxDuration. We always 200 (even on handler errors) so
// GitHub doesn't retry on our transient issues.

import { NextResponse, after } from "next/server";
import { getInstallationToken, isAppConfigured, verifyWebhook } from "@/lib/github/app";
import {
  getInstallationIdForOwner,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  isRepoWatched,
  persistScanReport,
  removeInstallation,
  reportPermalink,
  unwatchReposForInstallation,
  upsertInstallation,
} from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment, GATE_COMMENT_MARKER } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { diffReports } from "@/lib/scoring/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface WebhookPayload {
  action?: string;
  installation?: { id: number; account?: { login?: string } };
  repository?: { full_name?: string; name?: string; default_branch?: string; owner?: { login?: string } };
  pull_request?: { number?: number; head?: { sha?: string; ref?: string }; base?: { ref?: string } };
  ref?: string;
  after?: string;
  before?: string;
  deleted?: boolean;
  // installation_repositories event: repos added/removed from an installation's selected access.
  repositories_added?: { full_name?: string }[];
  repositories_removed?: { full_name?: string }[];
  repository_selection?: string;
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

// Replay defense. GitHub stamps each delivery with a unique X-GitHub-Delivery id. A captured,
// still-valid signed request can be re-sent (the HMAC still verifies) to re-trigger scans/gates;
// remember recently-seen ids (bounded, in-memory) and skip duplicates. Process-local — it collapses
// same-instance replays; recorded only AFTER signature verification so junk can't fill the map.
const DELIVERY_TTL_MS = 10 * 60_000;
const DELIVERY_MAX = 2000;
const seenDeliveries = new Map<string, number>(); // delivery id -> expiry

function deliveryAlreadySeen(id: string): boolean {
  const now = Date.now();
  const exp = seenDeliveries.get(id);
  if (exp && exp > now) return true;
  seenDeliveries.set(id, now + DELIVERY_TTL_MS);
  if (seenDeliveries.size > DELIVERY_MAX) {
    for (const [k, v] of seenDeliveries) if (v <= now) seenDeliveries.delete(k);
    while (seenDeliveries.size > DELIVERY_MAX) {
      const oldest = seenDeliveries.keys().next().value;
      if (oldest === undefined) break;
      seenDeliveries.delete(oldest);
    }
  }
  return false;
}

/** Bind a webhook's claimed installation to our stored org→install mapping. Returns false (skip)
 *  only when a mapping EXISTS and disagrees — so a payload whose installation doesn't match the
 *  repo owner on record can't drive a token mint / scan. Unknown owners (no mapping yet) are allowed
 *  since the HMAC already authenticated the delivery; this is defense-in-depth, not the primary gate. */
async function installationMatchesOwner(installationId: number, owner: string): Promise<boolean> {
  const known = await getInstallationIdForOwner(owner).catch(() => null);
  if (known && known !== String(installationId)) {
    console.warn(
      `[webhook] installation mismatch for ${owner}: payload=${installationId} stored=${known}; skipping`,
    );
    return false;
  }
  return true;
}

function publicBase(): string {
  return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}

interface PrGateRef {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
  /** PR head commit SHA — what the check is attached to AND the ref we score. */
  headSha: string;
  /** PR base branch (e.g. "main") — the ref we diff against to show the PR's impact. */
  baseRef: string;
}

/**
 * Run the maturity gate for a PR. Scores the PR's **head** (so adding tests / a CLAUDE.md / CI in
 * the PR actually moves the gate), diffs it against the **base** branch to show what the PR
 * changes, and posts a Check Run (the merge status) + a sticky comment. Deterministic (mock) so
 * it's fast and free of LLM spend; both scans use the same engine + token, so the diff is clean.
 */
async function runPrGate(ref: PrGateRef) {
  const { installationId, owner, repo, prNumber, headSha, baseRef } = ref;
  try {
    if (!(await installationMatchesOwner(installationId, owner))) return;
    const token = await getInstallationToken(installationId);
    const fullName = `${owner}/${repo}`;

    // Score the PR head. A fork PR's head commit can be unreachable via the base repo's tree API —
    // fall back to the default branch so the check still posts (just without per-PR resolution).
    let headReport;
    let scoredHead = true;
    try {
      headReport = await scanRepository(fullName, { mock: true, token, ref: headSha });
    } catch (err) {
      console.warn("[webhook] head-ref scan failed, falling back to default branch", err instanceof Error ? err.message : err);
      headReport = await scanRepository(fullName, { mock: true, token });
      scoredHead = false;
    }
    const gate = evaluateGate(headReport);

    // Diff base → head to show the PR's impact. Only meaningful when we actually scored the head
    // ref; both scans are mock at two refs, so the delta reflects the PR's tree changes alone.
    let baseline = null;
    if (scoredHead) {
      const baseReport = await scanRepository(fullName, { mock: true, token, ref: baseRef }).catch(() => null);
      if (baseReport) baseline = diffReports(baseReport, headReport);
    }

    const comment = buildGateComment(headReport, gate, baseline, { baselineSuffix: "in this PR" });
    const detailsUrl = publicBase() + reportPermalink(fullName, headReport.repo.headSha);

    await createCheckRun({
      token,
      owner,
      repo,
      headSha,
      conclusion: comment.conclusion,
      title: comment.title,
      summary: comment.summary,
      detailsUrl: detailsUrl.startsWith("http") ? detailsUrl : undefined,
    }).catch((err) => console.error("[webhook] check-run failed", err instanceof Error ? err.message : err));

    await upsertStickyComment({ token, owner, repo, prNumber, marker: GATE_COMMENT_MARKER, body: comment.commentBody }).catch(
      (err) => console.error("[webhook] sticky comment failed", err instanceof Error ? err.message : err),
    );
  } catch (err) {
    console.error("[webhook] PR gate failed", err instanceof Error ? err.message : err);
  }
}

/** Re-scan a watched repo on push, persist, and alert on a regression vs the prior scan. */
async function runPushRescan(installationId: number, owner: string, repo: string) {
  try {
    const fullName = `${owner}/${repo}`;
    const orgSlug = owner.toLowerCase();
    if (!(await installationMatchesOwner(installationId, owner))) return;
    if (!(await isRepoWatched(orgSlug, fullName))) return; // only watched repos auto-rescan
    const token = await getInstallationToken(installationId);
    const prev = await getScanReportByCommit(owner, repo, { orgSlug }).catch(() => null);
    const report = await scanRepository(fullName, { token });
    const persisted = await persistScanReport(report, { orgSlug });
    if (persisted && !persisted.deduped) {
      const orgId = (await getOrgId(orgSlug).catch(() => null)) ?? undefined;
      await checkAndAlertRegression(prev, report, { orgId });
    }
  } catch (err) {
    console.error("[webhook] push rescan failed", err instanceof Error ? err.message : err);
  }
}

export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhook(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") ?? "";
  // Reject replays of an already-processed delivery (a verified signature alone can't distinguish a
  // fresh delivery from a re-sent capture). Answer 200 so a genuine GitHub redelivery isn't retried.
  const delivery = request.headers.get("x-github-delivery");
  if (delivery && deliveryAlreadySeen(delivery)) {
    return NextResponse.json({ ok: true, event, duplicate: true });
  }
  let payload: WebhookPayload = {};
  try {
    payload = JSON.parse(raw) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  try {
    if (event === "installation") {
      const login = payload.installation?.account?.login;
      const id = payload.installation?.id;
      if (id != null) {
        if ((payload.action === "created" || payload.action === "unsuspend") && login) {
          await upsertInstallation({ login, installationId: id });
        } else if (payload.action === "deleted" || payload.action === "suspend") {
          await removeInstallation(id);
        }
      }
    } else if (event === "installation_repositories" && isDbConfigured()) {
      // The user changed WHICH repos an installation can see (Add/Remove on GitHub's Configure page).
      // Quiesce repos that lost access so their scheduled rescan stops minting a token that no longer
      // covers them and 401ing forever. (Added repos surface on the next connect-list refresh / re-sync.)
      const id = payload.installation?.id;
      const removed = (payload.repositories_removed ?? [])
        .map((r) => r.full_name)
        .filter((n): n is string => Boolean(n));
      if (id != null && removed.length > 0) {
        await unwatchReposForInstallation(id, removed);
      }
    } else if (event === "pull_request" && isAppConfigured()) {
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const prNumber = payload.pull_request?.number;
      const headSha = payload.pull_request?.head?.sha;
      const baseRef = payload.pull_request?.base?.ref ?? payload.repository?.default_branch;
      if (installationId && owner && repo && prNumber && headSha && baseRef && PR_ACTIONS.has(payload.action ?? "")) {
        // Defer the scan to after the response so GitHub gets its fast 2xx.
        after(() => runPrGate({ installationId, owner, repo, prNumber, headSha, baseRef }));
      }
    } else if (event === "push" && isAppConfigured() && isDbConfigured()) {
      const installationId = payload.installation?.id;
      const owner = payload.repository?.owner?.login;
      const repo = payload.repository?.name;
      const defaultBranch = payload.repository?.default_branch;
      const onDefault = defaultBranch != null && payload.ref === `refs/heads/${defaultBranch}`;
      const headMoved = !payload.deleted && !!payload.after && !/^0+$/.test(payload.after);
      if (installationId && owner && repo && onDefault && headMoved) {
        after(() => runPushRescan(installationId, owner, repo));
      }
    }
  } catch (err) {
    console.error("[app/webhook] handler error", err);
    // Still 200 so GitHub doesn't endlessly retry on our transient DB issues.
  }

  return NextResponse.json({ ok: true, event });
}
