// POST /api/org/gate-policy/preview { org, policy } -> { ok, effective, impact, admissionUnread }  (owner)
//
// What saving this draft bar WOULD do, before the write: which repos turn red, which turn green,
// which would be held to a bar nobody can judge for them, and which bars the draft removes. The
// editor used to learn all of that only after Save had written the bar and scheduled a sweep that
// re-posts Check Runs on open PRs, i.e. after merge statuses had already flipped org-wide.
//
// READ-ONLY by contract (route.test pins it): no setOrgGatePolicy, no audit row, no after() sweep.
// Owner-gated anyway, like the write it previews: the response names every repo's verdict under a
// bar the owner is drafting, which is the owner's decision surface, not a member read.
//
// Both sides are judged through the fleet resolver (gate-resolve.ts), so each repo is held to its
// admission-folded bar exactly as the governance tab and the Check Run hold it; the admission list is
// read ONCE and shared by both sides. An unreadable list is flagged (`admissionUnread`), never
// previewed as if the org bar alone were the CI bar.

import { NextResponse } from "next/server";
import { getOrgGatePolicy, getOrgRollup, isDbConfigured } from "@/lib/db";
import { listOrgAdmissions } from "@/lib/db/org-admission";
import { refusePublicOrgAdmin } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { sanitizeGatePolicy, type GatePolicy } from "@/lib/scoring/gate";
import { fleetFromRows } from "@/lib/scoring/gate-resolve";
import { fleetGateRows } from "@/lib/org/fleet-gate-snapshot";
import { gatePolicyImpact, type GatePolicyImpact } from "@/lib/org/gate-policy-impact";
import type { RepoAdmissionRow } from "@/lib/org/admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The same archetype the governance fleet view resolves the org bar against. */
const ORG_POLICY_ARCHETYPE = "org" as const;

export interface GatePolicyPreviewResponse {
  ok: true;
  /** The draft as the server would STORE it. Null = it sanitizes to nothing, so saving it clears the
   *  bar and the preview judged the fleet on the archetype default. */
  effective: GatePolicy | null;
  impact: GatePolicyImpact;
  /** The per-repo admission layers could not be read: both sides use the org bar alone. */
  admissionUnread: boolean;
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Gate policy requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ policy?: unknown }>(request, { missingOrgError: "Provide { org, policy }." });
  if (gate instanceof NextResponse) return gate;
  const noPublic = refusePublicOrgAdmin(gate.org);
  if (noPublic) return noPublic;
  const { org, body } = gate;

  // The SAME sanitization the write applies, so the preview judges exactly what Save would store.
  const effective = body.policy == null ? null : sanitizeGatePolicy(body.policy);

  let current: GatePolicy | null;
  let rollup: Awaited<ReturnType<typeof getOrgRollup>>;
  try {
    // Org-wide on purpose: the policy is org-wide, so its preview is too (scope narrows who is
    // measured on the tab, never the bar).
    [rollup, current] = await Promise.all([getOrgRollup(org), getOrgGatePolicy(org)]);
  } catch (err) {
    // A preview against a guessed current bar would report flips that are not real. Refuse instead.
    console.error("[gate-policy/preview] read failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not read the current gate policy or fleet; nothing was previewed." }, { status: 503 });
  }

  let admissions: RepoAdmissionRow[] = [];
  let admissionUnread = false;
  try {
    admissions = await listOrgAdmissions(org);
  } catch (err) {
    console.error("[gate-policy/preview] admission read failed - previewed on the org bar alone", err instanceof Error ? err.message : err);
    admissionUnread = true;
  }
  const before = fleetFromRows(current, ORG_POLICY_ARCHETYPE, admissions);
  const after = fleetFromRows(effective, ORG_POLICY_ARCHETYPE, admissions);
  const impact = gatePolicyImpact(
    fleetGateRows(rollup?.repos ?? []),
    { stored: current, policyFor: before.policyFor },
    { stored: effective, policyFor: after.policyFor },
  );
  const res: GatePolicyPreviewResponse = { ok: true, effective, impact, admissionUnread };
  return NextResponse.json(res);
}
