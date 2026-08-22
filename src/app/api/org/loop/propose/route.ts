// GET /api/org/loop/propose?org=…&repos=a/b,c/d — the CURATION step's data.
//
// Returns the batch each repo's lane WOULD get if a run started now: the top five open follow-ups by
// projected points, through the very same `openBatch` the engine calls. That identity is the point —
// a curation screen built on a second, "equivalent" query would eventually propose a batch the engine
// then declines to work, and nobody would know which side was wrong.
//
// A GET (not a POST action) because it is a pure read that creates nothing: no LoopRun row is written
// until `POST { action: "start" }`, so a user can open, close and reopen the curation panel freely.
// Static-segment `propose` resolves ahead of the sibling `[id]` route, so the two never collide.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { openBatch } from "@/lib/local/loop-lane";
import type { FollowUpItem } from "@/lib/org/followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One repo's proposed lane batch. `items` is empty when the repo has no open follow-ups left. */
export interface LoopProposal {
  repo: string;
  items: FollowUpItem[];
  /** Sum of the batch's projected points — the "what this lane is worth" headline. */
  projectedPoints: number;
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
    proposals.push({
      repo,
      items,
      projectedPoints: items.reduce((n, it) => n + (it.projectedPoints ?? 0), 0),
    });
  }
  return NextResponse.json({ proposals });
}
