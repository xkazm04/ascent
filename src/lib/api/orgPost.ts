// Single-source preamble for owner-gated, same-origin org POST mutations. Many /api/org/* write
// handlers open with the identical 4-step ritual: reject cross-origin → parse the JSON body →
// require an `org` field → require the caller hold the `owner` role. Collapsing it into one call
// means the CSRF/owner gate can't silently drift route-to-route (the prior copy-paste hazard).
//
// Routes that interleave EXTRA field validation BEFORE the role check (plan / members / invites /
// credits-grant / llm-provider POST) deliberately keep their bespoke preamble inline: folding them
// in would reorder the 400-vs-403 outcome (e.g. an invalid `amount` from a non-owner would flip
// from a 400 to a 403), which is observable behaviour we must preserve.

import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";

/**
 * Run the owner-gated same-origin preamble for an org POST. Returns the parsed `{ org, body }` on
 * success, or a ready-to-return NextResponse on failure (403 cross-origin / 400 missing org /
 * 401-403 role — the exact same responses the inline copies returned). Usage:
 *
 *   const gate = await requireOrgOwnerPost<MyBody>(request);
 *   if (gate instanceof NextResponse) return gate;
 *   // proceed with gate.org / gate.body
 *
 * `missingOrgError` overrides the 400 body for routes whose original message named more fields
 * (e.g. gate-policy's "Provide { org, policy }.") so the message stays byte-identical.
 */
export async function requireOrgOwnerPost<T = unknown>(
  request: Request,
  opts?: { missingOrgError?: string },
): Promise<{ org: string; body: T & { org?: string } } | NextResponse> {
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as T & { org?: string };
  if (!body.org) {
    return NextResponse.json({ error: opts?.missingOrgError ?? "Provide { org }." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  return { org: body.org, body };
}
