// Per-row authorization for the playbook routes. A playbook's org is not in the URL — it's resolved
// FROM the playbook id, then the caller is authorized against that org. This single guard is the one
// place that encodes that resolve-then-gate ordering + the not-found contract, so the three per-row
// routes ([id], [id]/repos, [id]/apply) can't drift on the 404 message, the role default, or the order.

import { NextResponse } from "next/server";
import { getPlaybookOrgSlug, isDbConfigured } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { parseRepoUrl } from "@/lib/github/source";
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
 * Tenant gate on a caller-supplied repo coordinate for the playbook write routes. Parses
 * `owner/name` and requires the owner to BE the playbook's `org` (case-insensitive) — without this a
 * member could record / open a PR against a foreign or typo'd repo under the org's playbook (a
 * cross-tenant write / inflated-adoption bug). Returns the validated coordinate on success, or a
 * `Response` (400) to return verbatim (callers branch on `instanceof Response`). Shared by
 * [id]/repos and [id]/apply so their two 400 messages + the owner-match rule can't drift.
 */
export function parseOrgRepo(
  repo: string | undefined,
  org: string,
): { fullName: string; owner: string; repo: string } | Response {
  const parsed = parseRepoUrl(repo ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  if (parsed.owner.toLowerCase() !== org.toLowerCase()) {
    return NextResponse.json({ error: `Repo must belong to ${org}.` }, { status: 400 });
  }
  return { fullName: `${parsed.owner}/${parsed.repo}`, owner: parsed.owner, repo: parsed.repo };
}
