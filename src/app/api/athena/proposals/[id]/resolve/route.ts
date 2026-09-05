// POST /api/athena/proposals/:id/resolve  { org, decision: "accept" | "decline" }
//
// THE ONE DOOR. Nothing Athena says executes until a request arrives here. She writes a proposal row;
// a human clicks; this handler is the only thing in the codebase that turns the second into the first.
// There is no background worker, no auto-accept, no "she was confident so we ran it".
//
// AND THE DOOR RE-VALIDATES FROM SCRATCH. Everything the proposal asserted is checked AGAIN, now:
//
//   • the proposal is still open        — a resolved one is finished, and cannot be re-opened here
//   • its payload still parses          — a corrupt row is not a licence to run something
//   • ITS ACTION STILL EXISTS           — a proposal outlives the build that raised it
//   • its params still satisfy the spec — the declared shape may have gained a required field
//   • (inside execute) the thing it names still exists IN THIS TENANT
//
// A proposal-time check is a CLAIM; an execution-time check is the GUARANTEE. Everything interesting
// changes between the reply and the click: an item gets closed, a finding disappears, a snooze date
// passes, an action is retired. Trusting the proposal because it was valid when it was written is how
// a companion ends up confidently doing the wrong thing to a tenant.
//
// A PROPOSAL WHOSE ACTION THIS BUILD NO LONGER CARRIES IS DECLINED ON THE OPERATOR'S BEHALF, with a
// `retired` outcome. The alternative — leaving it open — is an Accept button that can never succeed,
// which teaches the operator that the cards are decorative.
//
// ── claim → run → stamp ─────────────────────────────────────────────────────────────────────────
//
// Write-then-work leaves a failed accept marked done. Work-then-write runs a double-click twice. So the
// accept is three guarded steps (athena-proposals.ts): the claim is a compare-and-set on `status =
// 'open'` so exactly one caller wins and a second gets 409; the work runs; the stamp is guarded on
// `resolvedAt IS NULL`. If the work THROWS, the claim is released — and the release is itself guarded
// on `status = 'accepted' AND resolvedAt IS NULL`, so it can only ever undo a claim, never a resolution.
//
// GATING IS READ OFF THE SPEC (`requiredRole`), never from a list kept here — a second list is how a
// catalog and its gate drift apart. The org's own published stance is CONSULTED rather than restated:
// when it declares `provenance.requireHumanApproval`, an accept must be attributable to a named human,
// because an anonymous click is not a human approval in any sense the stance meant.
//
// EVERY ACCEPT IS AUDITED. That is the bar this door clears and autopilot does not.

import { NextResponse } from "next/server";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { recordOrgAudit } from "@/lib/db/scans-audit";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import {
  IDENTITY_DIFF_KIND,
  claimAthenaProposal,
  getAthenaProposal,
  releaseAthenaProposal,
  resolveAthenaProposal,
  stampAthenaProposal,
} from "@/lib/db/athena";
import {
  athenaActionSpec,
  athenaActionSummary,
  coerceAthenaAction,
  payloadParams,
  OUTCOME_DECLINED,
  OUTCOME_INVALID,
  OUTCOME_RETIRED,
  type AthenaActionOutcome,
} from "@/lib/athena/actions";
import { executeAthenaAction } from "@/lib/athena/actions-execute";
import { gateAthenaOrg, refused } from "@/app/api/athena/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What the client gets back: the settled status plus the outcome that was stamped onto the row. */
interface ResolveResponse {
  id: string;
  status: "accepted" | "declined";
  outcome: AthenaActionOutcome;
  summary: string | null;
}

const say = (body: ResolveResponse) => NextResponse.json(body);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { org?: unknown; decision?: unknown };
  const decision = body.decision === "accept" || body.decision === "decline" ? body.decision : null;

  // dbGuard → org → PUBLIC_ORG refusal → requireOrgAccess → orgId. The same preamble every Athena
  // route runs; a proposal id alone never crosses a tenant boundary because `orgId` is ANDed below.
  const gated = await gateAthenaOrg(typeof body.org === "string" ? body.org : null, "write");
  if (refused(gated)) return gated;
  if (!decision) {
    return NextResponse.json({ error: "decision must be 'accept' or 'decline'." }, { status: 400 });
  }

  const proposal = await getAthenaProposal(gated.orgId, id);
  if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  if (proposal.status !== "open") {
    // Not an error the operator caused — someone (possibly them, twice) already answered it. 409 is
    // the honest code: the request is well-formed, the state has moved on.
    return NextResponse.json(
      { error: "That proposal has already been answered.", status: proposal.status },
      { status: 409 },
    );
  }

  const actor = await resolveViewerLogin();

  // ── decline ───────────────────────────────────────────────────────────────────────────────────
  // Kind-agnostic on purpose: declining is refusing to run something, and refusing works for a kind
  // this build does not know how to run at all.
  if (decision === "decline") {
    const outcome: AthenaActionOutcome = { ok: true, kind: OUTCOME_DECLINED, detail: "Declined." };
    const row = await resolveAthenaProposal(gated.orgId, id, "declined", actor, { ...outcome });
    if (!row) return NextResponse.json({ error: "That proposal has already been answered." }, { status: 409 });
    await recordOrgAudit(
      "athena_proposal.declined",
      gated.org,
      { proposalId: id, threadId: proposal.threadId, kind: proposal.kind },
      actor ?? undefined,
    );
    return say({ id, status: "declined", outcome, summary: null });
  }

  // ── accept ────────────────────────────────────────────────────────────────────────────────────

  // An identity diff is NOT an action — it edits her self-model through the anchored-diff engine, which
  // is a different door with a different safety argument. It is refused here rather than auto-declined:
  // declining another surface's proposal on the operator's behalf would silently eat a real offer.
  if (proposal.kind === IDENTITY_DIFF_KIND) {
    return NextResponse.json(
      { error: "An identity diff is not accepted through the action door." },
      { status: 409 },
    );
  }

  // RE-VALIDATION, from the stored payload, against the catalog as it stands RIGHT NOW.
  const coerced = coerceAthenaAction({ action: proposal.kind, params: payloadParams(proposal.payload) });
  if (!coerced.ok) {
    // Retired, or no longer shaped the way the current spec requires. Either way this can never
    // succeed, so it is closed with a reason rather than left as a button that lies.
    const retired = coerced.reason === "unknown_action";
    const outcome: AthenaActionOutcome = {
      ok: false,
      kind: retired ? OUTCOME_RETIRED : OUTCOME_INVALID,
      detail: retired
        ? "This build no longer carries that action, so it was declined rather than left open."
        : `This offer no longer matches what the action accepts (${coerced.detail}), so it was declined.`,
    };
    const row = await resolveAthenaProposal(gated.orgId, id, "declined", actor, { ...outcome });
    if (!row) return NextResponse.json({ error: "That proposal has already been answered." }, { status: 409 });
    await recordOrgAudit(
      "athena_proposal.declined",
      gated.org,
      { proposalId: id, threadId: proposal.threadId, kind: proposal.kind, outcome: outcome.kind },
      actor ?? undefined,
    );
    return say({ id, status: "declined", outcome, summary: null });
  }

  const action = coerced.action;
  const summary = athenaActionSummary(action.id, action.params);

  // GATE, OFF THE SPEC. `requireOrgRole` is the repo's RBAC layer; the role it is handed comes from the
  // catalog, so there is exactly one statement anywhere of who may accept what. `?? "owner"` is
  // unreachable (the coercion above already proved the spec exists) and fails CLOSED if it ever isn't.
  const denied = await requireOrgRole(gated.org, athenaActionSpec(action.id)?.requiredRole ?? "owner");
  if (denied) return denied;

  // The org's OWN published policy, inherited rather than duplicated. `requireHumanApproval` says an
  // AI-attributed change needs a human approval before it lands. This click IS that approval — which
  // means it has to be attributable to a person. On a deployment where the viewer cannot be named,
  // accepting would record an AI-originated change approved by nobody, which is the exact thing the
  // stance was published to prevent.
  const stance = await getActiveOrgStance(gated.org).catch(() => null);
  if (stance?.stance.provenance.requireHumanApproval && !actor) {
    return NextResponse.json(
      {
        error:
          "This organization's AI stance requires a human approval on AI-attributed changes. Sign in so the acceptance can be attributed.",
      },
      { status: 403 },
    );
  }

  // ── claim ─────────────────────────────────────────────────────────────────────────────────────
  const claimed = await claimAthenaProposal(gated.orgId, id, actor);
  if (!claimed) {
    // Someone else won the compare-and-set between the read above and here. Nothing ran twice.
    return NextResponse.json({ error: "That proposal has already been answered." }, { status: 409 });
  }

  // ── run ───────────────────────────────────────────────────────────────────────────────────────
  let outcome: AthenaActionOutcome;
  try {
    outcome = await executeAthenaAction(action, { org: gated.org, orgId: gated.orgId, actor });
  } catch (err) {
    // A THROW is not a refusal — a refusal comes back as an outcome. This is something breaking, so
    // the claim is released and the card goes back to open for the operator to try again.
    await releaseAthenaProposal(gated.orgId, id).catch(() => false);
    console.error("[athena] action failed", { proposalId: id, kind: proposal.kind, err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The action failed. Nothing was changed." },
      { status: 500 },
    );
  }

  // ── stamp ─────────────────────────────────────────────────────────────────────────────────────
  // The outcome is MERGED INTO payloadJson (there is no outcome column and there must not be one), so
  // one row tells you both what was offered and what came of it. A refusal is stamped too: "it ran and
  // declined to act" is a resolution, and re-offering it would only refuse again.
  const stamped = await stampAthenaProposal(gated.orgId, id, { ...outcome });
  if (!stamped) {
    return NextResponse.json({ error: "That proposal has already been answered." }, { status: 409 });
  }

  await recordOrgAudit(
    "athena_proposal.accepted",
    gated.org,
    {
      proposalId: id,
      threadId: proposal.threadId,
      kind: proposal.kind,
      outcome: outcome.kind,
      ok: outcome.ok,
      summary,
      ...(outcome.data ? { data: outcome.data } : {}),
    },
    actor ?? undefined,
  );

  return say({ id, status: "accepted", outcome, summary });
}
