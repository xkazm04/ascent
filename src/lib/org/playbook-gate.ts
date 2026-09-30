// Per-row authorization for the playbook routes. A playbook's org is not in the URL — it's resolved
// FROM the playbook id, then the caller is authorized against that org. This single guard is the one
// place that encodes that resolve-then-gate ordering + the not-found contract, so the per-row routes
// ([id], [id]/repos, [id]/apply, [id]/apply-batch) can't drift on the 404 message, the role default,
// or the order.

import { NextResponse } from "next/server";
import { getPlaybookOrgSlug, isDbConfigured, type PlaybookRow } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { parseRepoUrl } from "@/lib/github/source";
import { repoUnderOrg } from "@/lib/github/pr-route";
import type { OrgRole } from "@/lib/db/members";

/**
 * Resolve the owning org from a playbook id and authorize the caller against it.
 * Returns the resolved `{ org }` on success, or a `Response` (503 / 404 / the gate's denial — every
 * branch is a `NextResponse`, which extends `Response`) to return verbatim. Callers distinguish the
 * two with `instanceof Response`. `min` defaults to member-level (`requireOrgAccess`); a stricter role
 * routes through `requireOrgRole`.
 */
export async function resolvePlaybookOrg(
  id: string,
  min: OrgRole = "member",
): Promise<{ org: string } | Response> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const org = await getPlaybookOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const denied = min === "member" ? await requireOrgAccess(org) : await requireOrgRole(org, min);
  if (denied) return denied;
  return { org };
}

/**
 * Tenant gate on a caller-supplied repo coordinate for the playbook write routes. Parses `owner/name`
 * and requires the repo to belong to the playbook's `org`: either the org's own namespace
 * (case-insensitive) or a repository the org TRACKS under another owner (org `kiro` over
 * `xkazm04/kp`). The second half is `repoUnderOrg`, the same tracked-set predicate the admission
 * routes and the `tracked` rule of the customer-repo write door use (backlog develop-2026-09-17 row
 * 41; it used to be `owner === org` only, so a playbook could not reach repos the loop already works).
 * A random owner the org does not track is still refused (400), so a member cannot record or open a
 * PR against a foreign or typo'd repo under the org's playbook (the cross-tenant write /
 * inflated-adoption bug). Returns the validated coordinate, or a `Response` (400) to return verbatim
 * (callers branch on `instanceof Response`). Shared by [id]/repos, [id]/apply and [id]/apply-batch.
 */
export async function parseOrgRepo(
  repo: string | undefined,
  org: string,
): Promise<{ fullName: string; owner: string; repo: string } | Response> {
  const parsed = parseRepoUrl(repo ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  const fullName = `${parsed.owner}/${parsed.repo}`;
  if (!(await repoUnderOrg(org, fullName))) {
    return NextResponse.json({ error: `Repo must belong to ${org} or be one it tracks.` }, { status: 400 });
  }
  return { fullName, owner: parsed.owner, repo: parsed.repo };
}

/**
 * The write doors (apply, apply-batch, mark-applied) share this refusal. `listPlaybooks` hides an
 * archived row, but a caller who still has the id could otherwise open PRs and record adoption for
 * a standard an admin withdrew. Null is 404 (same not-found contract as {@link resolvePlaybookOrg});
 * archived is 409. Unmark is deliberately not this check — clearing a mark after withdrawal is cleanup.
 */
export function archivedPlaybookRefusal(playbook: Pick<PlaybookRow, "archived"> | null): Response | null {
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  if (playbook.archived === true) {
    return NextResponse.json({ error: "This playbook is archived." }, { status: 409 });
  }
  return null;
}
