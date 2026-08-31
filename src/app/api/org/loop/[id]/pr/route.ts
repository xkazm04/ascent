// POST /api/org/loop/[id]/pr — open a reviewed PR from a finished loop lane's branch.
//
// `[id]` is the RUN id, the same meaning the sibling `GET /api/org/loop/[id]` gives it; the lane is
// named in the body. This is the one loop action whose effect leaves the operator's machine, so it
// carries the heaviest gate stack in local mode and a typed confirmation:
//
//   selfHostGuard()            — on managed cloud the surface does not exist (404, never 403)
//   requireSameOrigin(request) — it mutates, and it pushes commits into a customer repository
//   dbGuard()                  — the ledger row is the point; without a database there is none
//   requireOrgRole(org,"owner")— pushing into a real repo is owner-shaped, exactly like `start`
//
// TENANCY IS GATE-THEN-CONSTRAIN: the run is fetched and its `orgId` compared against the org the
// caller was authorized for, and the lane is then looked up as `{ id: laneId, runId: id }` — so a
// lane from another org's run is simply not found. Trusting either id alone would let an owner of A
// push a branch from B.
//
// The typed `confirm` (the repo's full name) is deliberate friction. Every other loop control is
// reversible on the operator's own disk; this one writes to a remote everyone can see.
//
// AND THE SAME DELIVERY RULE THE UNATTENDED DOOR HOLDS: under `verifyMode: on`, only a `verified`
// lane may be published. A rule that bound the automatic path alone would be no rule at all.

import { NextResponse } from "next/server";
import { PUBLIC_ORG, requireSameOrigin } from "@/lib/auth";
import { getViewer } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { AppApiError } from "@/lib/github/app";
import { getLane, getLoopRun } from "@/lib/db/loop-runs";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";
import { getRepoLocalPath, recordAudit } from "@/lib/db";
import { openPrForLane } from "@/lib/local/loop-pr";
import { unverifiedDeliveryReason } from "@/lib/local/verify-options";
import { verifyModeOf } from "@/lib/local/run-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { org?: unknown; laneId?: unknown; confirm?: unknown };

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard =
    selfHostGuard() ??
    requireSameOrigin(request) ??
    dbGuard("Opening a PR from a lane", "Opening a PR from a lane requires a database.");
  if (guard) return guard;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as Body;
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const laneId = typeof body.laneId === "string" ? body.laneId.trim() : "";
  if (!org || !laneId) return NextResponse.json({ error: "Missing 'org' or 'laneId'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no loop." }, { status: 403 });

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // Gate-then-constrain, both hops.
  const run = await getLoopRun(id);
  if (!run || run.orgId !== (await orgIdForSlug(org))) {
    return NextResponse.json({ error: "No such loop run." }, { status: 404 });
  }
  const lane = await getLane(laneId);
  if (!lane || lane.runId !== id) return NextResponse.json({ error: "No such lane." }, { status: 404 });

  // The typed confirmation. Checked AFTER the lane is resolved so the message can name what it wants,
  // and before anything is pushed.
  if (typeof body.confirm !== "string" || body.confirm.trim() !== lane.repoFullName) {
    return NextResponse.json({ error: `Type ${lane.repoFullName} to confirm the push.` }, { status: 400 });
  }

  if (lane.phase !== "done") return NextResponse.json({ error: "This lane has not finished." }, { status: 409 });
  if (!lane.branch) return NextResponse.json({ error: "This lane produced no branch." }, { status: 409 });
  if (lane.commits === 0) {
    return NextResponse.json({ error: "This lane committed nothing, so there is nothing to review." }, { status: 409 });
  }
  // THE DEGRADATION GUARD'S VETO. The unattended delivery step refuses a rejected lane too
  // (`loop-delivery.ts`); this is the same rule at the one-click door, because a verdict that only
  // bound the automatic path would be no verdict at all — a human clicking "open a PR" is exactly how
  // a reversed cycle would otherwise reach a remote everyone can see.
  if (lane.verifyVerdict === "rejected") {
    return NextResponse.json(
      {
        error:
          "The degradation guard rejected this lane: the repository's own check passed before the agent's session and failed after it, " +
          "so the work was discarded rather than committed. A rejected lane cannot be opened as a pull request.",
      },
      { status: 409 },
    );
  }
  // VERIFIED-ONLY, THE SAME RULE THE UNATTENDED DOOR APPLIES (`loop-delivery.ts`), from the same
  // sentence (`unverifiedDeliveryReason`). `rejected` is one of four verdicts and gating on it alone
  // let `baseline-red` work — work the repository's own check never cleared, because it was already
  // failing — reach a remote everyone can see. A run whose `verifyMode` is on asked for the check;
  // three of the four verdicts and the absent one all mean the check was never made.
  const unverified =
    verifyModeOf(run.verifyMode) === "on" ? unverifiedDeliveryReason(lane.verifyVerdict) : null;
  if (unverified) {
    return NextResponse.json(
      {
        error:
          `This run asked for verification (verifyMode: on) and ${unverified}. A verdict other than "verified" means the check ` +
          `could not be made, which is not permission to publish: the work stays on ${lane.branch}. Re-run this lane with a green ` +
          `baseline, or start a run with verification off if you mean to publish unchecked work.`,
      },
      { status: 409 },
    );
  }
  const pairedPath = await getRepoLocalPath(org, lane.repoFullName);
  if (!pairedPath) {
    return NextResponse.json({ error: `${lane.repoFullName} is no longer paired with a local path.` }, { status: 409 });
  }

  const viewer = await getViewer().catch(() => null);
  try {
    const result = await openPrForLane({ orgSlug: org, orgId: run.orgId, lane, pairedPath, actor: viewer?.login ?? null });
    await recordAudit(
      "loop.pr.opened",
      { runId: id, laneId, repoFullName: lane.repoFullName, branch: lane.branch, prNumber: result.prNumber, reused: result.reused },
      { orgId: run.orgId, actorId: viewer?.login ?? undefined },
    );
    return NextResponse.json(result);
  } catch (err) {
    // Audited on refusal too: by the time most of these fire the branch is already on the remote, and
    // "we pushed and then could not open the PR" is precisely the state an operator must be able to
    // find in the log rather than discover on GitHub.
    const status = err instanceof AppApiError ? (err.status === 409 || err.status === 400 ? err.status : 502) : 500;
    const message = err instanceof AppApiError ? err.body : "Could not open a PR for that lane.";
    await recordAudit(
      "loop.pr.refused",
      { runId: id, laneId, repoFullName: lane.repoFullName, branch: lane.branch, reason: message.slice(0, 300) },
      { orgId: run.orgId, actorId: viewer?.login ?? undefined },
    );
    return NextResponse.json({ error: message }, { status });
  }
}
