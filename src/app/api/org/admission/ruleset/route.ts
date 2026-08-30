// POST   /api/org/admission/ruleset { org, repo, confirm }  -> { ok, rulesetId, observed }
// DELETE /api/org/admission/ruleset { org, repo, confirm }  -> { ok, reverted }
//
// AGENT ADMISSION (moonshot #8) — THE ONE CALL IN THIS LANE THAT MUTATES A CUSTOMER'S REPOSITORY
// CONFIGURATION rather than opening a reviewable PR. Everything else here is a proposal; a branch
// ruleset takes effect the instant it is created, with no review step of its own. So it carries
// every guard the codebase has for a destructive action, stacked:
//
//   • OWNER, not admin — this changes what can merge.
//   • SAME-ORIGIN (requireOrgOwnerPost) — a cross-site POST must not be able to reach it.
//   • TYPED CONFIRM — `confirm` must be the literal "owner/name". A boolean flag can be sent by
//     accident or by a stale client; typing the repository's own name cannot.
//   • A DRY RUN FIRST — GET the observed rulesets and return them beside the proposal, so the
//     caller sees what is already there before adding to it.
//   • REVERSIBLE — the created id is stored on RepoAdmission.rulesetId and DELETE removes it. A
//     control a customer cannot undo from the surface that created it is one they will disable
//     outside the product instead, and then Ascent's record of their posture is simply wrong.
//   • AUDITED on both directions (`org.admission_ruleset`, `org.admission_ruleset_revert`).

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { getRepoAdmission, setAdmissionRulesetId } from "@/lib/db/org-admission";
import { compileStance } from "@/lib/org/admission";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { requirePrWriteContext, mapPrWriteError } from "@/lib/github/pr-route";
import { applyRuleset, listRulesets, revertRuleset } from "@/lib/github/admission-write";
import { resolveViewerLogin } from "@/lib/access";
import { repoUnderOrg } from "@/app/api/org/admission/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  repo?: unknown;
  confirm?: unknown;
}

/** The gate every method here shares: db, owner + same-origin, repo constrained to the org, and the
 *  typed confirm. Returns the resolved coordinates or a ready-to-return refusal. */
async function gateRulesetRequest(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Ruleset actions require a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<Body>(request, { missingOrgError: "Provide { org, repo, confirm }." });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  const repo = repoUnderOrg(org, body.repo);
  if (!repo) return NextResponse.json({ error: 'Provide repo as "owner/name" under this organization.' }, { status: 400 });
  // The typed confirm. Compared to the repository's own full name, so a client cannot satisfy it
  // with a constant — the value is different for every repo the action could touch.
  if (body.confirm !== repo) {
    return NextResponse.json(
      { error: `This changes what can merge in ${repo}. Type the repository name to confirm.`, confirmWith: repo },
      { status: 400 },
    );
  }
  return { org, repo };
}

export async function POST(request: Request) {
  const gated = await gateRulesetRequest(request);
  if (gated instanceof NextResponse) return gated;
  const { org, repo } = gated;

  const [stance, admission] = await Promise.all([getActiveOrgStance(org), getRepoAdmission(org, repo)]);
  if (!stance) return NextResponse.json({ error: "This organization has not published an AI stance." }, { status: 400 });
  if (!admission) {
    return NextResponse.json({ error: `No autonomy tier has been assessed for ${repo}; scan it before applying controls.` }, { status: 400 });
  }
  if (admission.rulesetId) {
    // Idempotent refusal rather than a second ruleset: two rules enforcing the same thing is a
    // configuration a customer cannot reason about, and only one id fits in the reversal handle.
    return NextResponse.json({ error: `An Ascent ruleset is already applied to ${repo}. Revert it before applying a new one.` }, { status: 409 });
  }
  const compiled = compileStance(
    stance.stance,
    admission,
    { fullName: repo, derivedTier: admission.derivedTier, codeownersPaths: [], observedRequiredApprovals: null, protectedBranch: null },
    stance.version,
  );
  if (!compiled.ruleset) {
    return NextResponse.json(
      { error: `${repo}'s tier (${compiled.tier ?? "not assessed"}) and mode compile no ruleset, so there is nothing to apply.` },
      { status: 400 },
    );
  }

  const ctx = await requirePrWriteContext(org);
  if (ctx instanceof NextResponse) return ctx;
  const [, name] = repo.split("/");
  const actorLogin = await resolveViewerLogin();

  try {
    // Observed-vs-proposed: read what is already on the repo BEFORE adding to it, and return it so a
    // caller who is about to double up on an existing rule can see that.
    const observed = await listRulesets(ctx.token, org, name!).catch(() => []);
    const rulesetId = await applyRuleset(ctx.token, org, name!, compiled.ruleset);
    await setAdmissionRulesetId(org, repo, rulesetId);
    await recordOrgAudit(
      "org.admission_ruleset",
      org,
      {
        org,
        repo,
        rulesetId,
        tier: compiled.tier,
        observedBefore: observed.map((r) => r.name),
        status: `applied ruleset ${rulesetId} to ${repo} (tier ${compiled.tier ?? "unassessed"}, mode ${compiled.mode})`,
      },
      actorLogin ?? undefined,
    ).catch(() => {});
    return NextResponse.json({ ok: true, rulesetId, observed });
  } catch (err) {
    return mapPrWriteError(err, { tag: "admission-ruleset", genericError: "The ruleset could not be applied." });
  }
}

export async function DELETE(request: Request) {
  const gated = await gateRulesetRequest(request);
  if (gated instanceof NextResponse) return gated;
  const { org, repo } = gated;

  const admission = await getRepoAdmission(org, repo);
  if (!admission?.rulesetId) {
    return NextResponse.json({ error: `No Ascent ruleset is recorded for ${repo}.` }, { status: 404 });
  }
  const ctx = await requirePrWriteContext(org);
  if (ctx instanceof NextResponse) return ctx;
  const [, name] = repo.split("/");
  const actorLogin = await resolveViewerLogin();

  try {
    await revertRuleset(ctx.token, org, name!, admission.rulesetId);
    // The column is cleared only after GitHub confirms (a 404 counts — someone deleting it directly
    // is the same end state). Clearing first would strand a live ruleset with no reversal handle.
    await setAdmissionRulesetId(org, repo, null);
    await recordOrgAudit(
      "org.admission_ruleset_revert",
      org,
      { org, repo, rulesetId: admission.rulesetId, status: `reverted ruleset ${admission.rulesetId} on ${repo}` },
      actorLogin ?? undefined,
    ).catch(() => {});
    return NextResponse.json({ ok: true, reverted: admission.rulesetId });
  } catch (err) {
    return mapPrWriteError(err, { tag: "admission-ruleset-revert", genericError: "The ruleset could not be reverted." });
  }
}
