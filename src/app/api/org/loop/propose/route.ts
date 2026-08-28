// GET /api/org/loop/propose?org=…&repos=a/b,c/d — the CURATION step's data.
//
// Returns the batch each repo's lane WOULD get if a run started now: the top five open follow-ups by
// projected points, through the very same `openBatch` the engine calls. That identity is the point —
// a curation screen built on a second, "equivalent" query would eventually propose a batch the engine
// then declines to work, and nobody would know which side was wrong.
//
// It also returns the lane KIND, through the very same `proposeLaneKind` the engine re-runs at arm
// time, for exactly the same reason. A repo with no `.ai/` foundation leads with a `foundation` lane
// (that install used to be reachable only from the per-repo report header — a 7-hop detour); a repo
// whose biggest open gap has a Practice Library starter it lacks leads with a `practice` lane; the
// agent lane is everything else, and stays the default.
//
// A GET (not a POST action) because it is a pure read that creates nothing: no LoopRun row is written
// until `POST { action: "start" }`, so a user can open, close and reopen the curation panel freely.
// Static-segment `propose` resolves ahead of the sibling `[id]` route, so the two never collide.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { getRepoLocalPath } from "@/lib/db";
import { openBatch } from "@/lib/local/loop-lane";
import { proposeLaneKind } from "@/lib/local/lane-kind";
import type { LoopLaneKind } from "@/lib/db/loop-runs-types";
import type { FollowUpItem } from "@/lib/org/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One repo's proposed lane batch. `items` is empty when the repo has no open follow-ups left. */
export interface LoopProposal {
  repo: string;
  items: FollowUpItem[];
  /** Sum of the batch's projected points — the "what this lane is worth" headline. */
  projectedPoints: number;
  /** What this lane would DO. `backlog` is the agent lane and the default. */
  kind: LoopLaneKind;
  /** Practice Library id, on a `practice` proposal only. */
  practiceId: string | null;
  /** One line explaining the kind — rendered under the repo name in the curation panel. */
  reason: string;
}

export async function GET(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const url = new URL(request.url);
  const org = url.searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const repos = [
    ...new Set(
      (url.searchParams.get("repos") ?? "")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
    ),
  ];
  if (repos.length === 0) return NextResponse.json({ error: "Missing 'repos'." }, { status: 400 });

  const proposals: LoopProposal[] = [];
  for (const repo of repos) {
    const items = await openBatch(org, repo);
    // The lane KIND, from the very same rule the engine re-runs at arm time (loop-engine.ts). A repo
    // with no `.ai/` foundation leads with the foundation lane; a repo whose biggest open gap has a
    // Practice Library starter it is missing leads with that; everything else is the agent lane.
    const path = await getRepoLocalPath(org, repo).catch(() => null);
    const plan = await proposeLaneKind(path, async () => items);
    // A FOUNDATION lane has nothing to curate — its work is the install, not the backlog — so it
    // proposes no items rather than showing checkboxes the run would ignore. The backlog is still
    // there and cycle 2 works it, with the standard already in place.
    const laneItems = plan.kind === "foundation" ? [] : items;
    proposals.push({
      repo,
      items: laneItems,
      projectedPoints: laneItems.reduce((n, it) => n + (it.projectedPoints ?? 0), 0),
      kind: plan.kind,
      practiceId: plan.practiceId,
      reason: plan.reason,
    });
  }
  return NextResponse.json({ proposals });
}
