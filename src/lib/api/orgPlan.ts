// Single-source preamble for the org PLANNING CRUD routes — the four /api/org/{goals,initiatives}
// handlers that previously re-stated the same boilerplate (a 503 db-guard ×4, an identical GET-list
// shape ×2, the POST create-result tail ×2, and a targetDate ISO check ×2 that had DRIFTED — present
// on the goals routes, absent on the initiatives ones). Folding the genuinely-common, order-safe
// pieces here means a change to any cross-cutting rule (503 wording, the read gate, the response
// envelope) lands in exactly one place. Each route keeps its own resource-specific validation inline.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";

/** The 503 db-guard shared by every planning handler. Returns the response when DB is unset, else null. */
export function dbGuard(resourceLabel: string): NextResponse | null {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: `${resourceLabel} require a database.` }, { status: 503 });
  }
  return null;
}

/**
 * The targetDate ISO validation shared by the create/patch handlers. Returns a 400 NextResponse for a
 * present-but-unparseable value (null/undefined are allowed — the field is optional), else null. Now
 * applied to the initiatives routes too (the `Initiative.targetDate` column is a DateTime, so a bad
 * value was silently coerced to null before this gate existed there).
 */
export function invalidTargetDate(value: string | null | undefined): NextResponse | null {
  if (value != null && Number.isNaN(Date.parse(value))) {
    return NextResponse.json({ error: "targetDate must be an ISO date (YYYY-MM-DD)." }, { status: 400 });
  }
  return null;
}

/**
 * The shared GET-list handler for the two org-scoped read routes: db-guard → require `?org` →
 * read-gate → return `{ [key]: items ?? [] }`. The order is identical across both routes, so it is
 * safe to fold whole.
 */
export async function listOrgRoute(
  request: Request,
  opts: { resourceLabel: string; key: string; load: (org: string) => Promise<readonly unknown[] | null> },
): Promise<NextResponse> {
  const guard = dbGuard(opts.resourceLabel);
  if (guard) return guard;
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const items = await opts.load(org);
  return NextResponse.json({ [opts.key]: items ?? [] });
}

/** The shared POST create-result tail: the created row on success, else a 500 with a "Failed to create X." body. */
export function createdResponse(created: { id: string } | null, resource: string): NextResponse {
  return NextResponse.json(created ?? { error: `Failed to create ${resource}.` }, { status: created ? 200 : 500 });
}

/**
 * The per-row tenant gate for the [id] mutation routes: db-guard → resolve the row's TRUE owning org
 * (never a body-supplied value) → 404 when the id is unknown → require write access on that org.
 * Returns the blocking response (503/404/401/403), or null when the caller may act.
 */
export async function rowGate(opts: {
  resourceLabel: string;
  notFound: string;
  getOrgSlug: (id: string) => Promise<string | null>;
  id: string;
}): Promise<NextResponse | null> {
  const guard = dbGuard(opts.resourceLabel);
  if (guard) return guard;
  const org = await opts.getOrgSlug(opts.id);
  if (!org) return NextResponse.json({ error: opts.notFound }, { status: 404 });
  return requireOrgAccess(org);
}
