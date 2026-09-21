// MERGE THE RUNNER BRANCH OUT — the operator's "Merge runner into <base>" (spark theater-upgrade,
// 2026-09-18; self-hosted only).
//
//   POST { org, repo } → MergeOutResult  ({ ok, outcome: "fast-forward" | "merged" | "commands", … })
//
// The standing runner accumulates verified work on each repo's `ascent/runner` branch and NEVER merges
// it into the operator's branch on its own. This is the one door that does, and only when that is a
// fast-forward nobody's working copy can be hurt by (`mergeRunnerInto`, runner-branch.ts):
//   • the base is not checked out anywhere → the base ref is moved with `update-ref` (`fast-forward`);
//   • it is checked out and clean          → `git merge --ff-only ascent/runner` there (`merged`);
//   • diverged, or checked out and dirty   → nothing is touched; the exact commands come back
//                                             (`commands`) — a real merge is the operator's to make.
// Never a force, a stash or a reset. A `commands` outcome is an answer, not a failure: 200.
//
// Guards mirror the drive route: self-host 404 (the surface does not exist on managed cloud), DB,
// PUBLIC_ORG 403, then OWNER — this writes to a branch of the operator's paired checkout. The loop
// flag is NOT required: merging what the runner already produced must work after the loop is off.
// Unknown repo 404; known but unpaired 409, the pairing family's convention; a broken pairing 422.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { listLocalPairings } from "@/lib/db/org-local";
import { verifyLocalPath } from "@/lib/local/pairing";
import { mergeRunnerInto, resolveBaseBranch, runnerAheadCount } from "@/lib/local/runner-branch";
import { noteRunnerAhead, runnerBaseFor } from "@/lib/local/runner-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("Runner merge", "Merging the runner branch requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as { org?: unknown; repo?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const repo = typeof body.repo === "string" ? body.repo.trim() : "";
  if (!org || !repo) return NextResponse.json({ error: "Missing 'org' or 'repo'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no runner." }, { status: 403 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  // The repo is resolved WITHIN the org the caller was authorized for, so a name from another org is
  // simply not found.
  const pairing = (await listLocalPairings(org)).find((p) => p.fullName.toLowerCase() === repo.toLowerCase());
  if (!pairing) return NextResponse.json({ error: "Unknown repository for this organization." }, { status: 404 });
  if (!pairing.localPath) {
    return NextResponse.json({ error: `${pairing.fullName} is not paired with a local path — pair it on Admin → Pairing.` }, { status: 409 });
  }
  const check = await verifyLocalPath(pairing.localPath, pairing.fullName);
  if (!check.ok) return NextResponse.json({ error: `Pairing broken: ${check.error}` }, { status: 422 });

  const base = (await runnerBaseFor(org, pairing.fullName)) ?? (await resolveBaseBranch(pairing.localPath));
  if (!base) {
    return NextResponse.json(
      { error: "Could not tell which branch the runner merges into: the checkout has no origin/HEAD and is not on a branch." },
      { status: 409 },
    );
  }
  const result = await mergeRunnerInto(pairing.localPath, base);
  if (result.ok) await noteRunnerAhead(org, pairing.fullName, await runnerAheadCount(pairing.localPath, base)).catch(() => undefined);
  return NextResponse.json({ ...result, base });
}
