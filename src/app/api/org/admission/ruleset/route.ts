// POST   /api/org/admission/ruleset { org, repo, dryRun: true } -> { proposal, observed }  (no write)
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
//   • A DRY RUN FIRST — `dryRun: true` GETs the observed rulesets and returns them beside the
//     compiled proposal, with no typed confirm and no write, so the caller sees what is already
//     there before adding to it. (It used to be a promise only: the typed confirm ran before any
//     read, and `observed` was read in the same call that applied.) It still needs the owner, the
//     same-origin POST and a repo under the org — reading a customer's rulesets is not a public act.
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
import { requirePrWriteTarget, mapPrWriteError, repoUnderOrg } from "@/lib/github/pr-route";
import { applyRuleset, listRulesets, revertRuleset } from "@/lib/github/admission-write";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  repo?: unknown;
  confirm?: unknown;
  dryRun?: unknown;
}

/** The gate every method here shares: db, owner + same-origin, repo constrained to the org, and the
 *  typed confirm. Returns the resolved coordinates or a ready-to-return refusal. Only a POST may
 *  waive the typed confirm, and only for `dryRun === true` (the boolean, never a truthy string),
 *  because that branch writes nothing. */
async function gateRulesetRequest(request: Request, method: "POST" | "DELETE") {
  if (!isDbConfigured()) return NextResponse.json({ error: "Ruleset actions require a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<Body>(request, { missingOrgError: "Provide { org, repo, confirm }." });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  const repo = await repoUnderOrg(org, body.repo);
  if (!repo) return NextResponse.json({ error: 'Provide repo as "owner/name" under this organization.' }, { status: 400 });
  if (method === "POST" && body.dryRun === true) return { org, repo, dryRun: true as const };
  // The typed confirm. Compared to the repository's own full name, so a client cannot satisfy it
  // with a constant — the value is different for every repo the action could touch.
  if (body.confirm !== repo) {
    return NextResponse.json(
      { error: `This changes what can merge in ${repo}. Type the repository name to confirm.`, confirmWith: repo },
      { status: 400 },
    );
  }
  return { org, repo, dryRun: false as const };
}

export async function POST(request: Request) {
  const gated = await gateRulesetRequest(request, "POST");
  if (gated instanceof NextResponse) return gated;
  const { org, repo, dryRun } = gated;

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

  // Token for the gated org, coordinate of the ADMITTED repo: a tracked `xkazm04/kp` under org `kiro`
  // is configured in `xkazm04/kp` (these calls used to pass `org` as the owner, i.e. `kiro/kp`).
  const target = await requirePrWriteTarget(org, repo, "tracked");
  if (target instanceof Response) return target;
  const actorLogin = await resolveViewerLogin();

  if (dryRun) {
    try {
      const observed = await listRulesets(target.token, target.owner, target.repo);
      // Same action as the apply, marked dryRun: "who looked at what we would enforce" is part of the
      // record, exactly as propose audits its dry runs.
      await recordOrgAudit(
        "org.admission_ruleset",
        org,
        { org, repo, dryRun: true, tier: compiled.tier, observedBefore: observed.map((r) => r.name), status: `dry run for ${repo}: nothing applied` },
        actorLogin ?? undefined,
      ).catch(() => {});
      return NextResponse.json({ proposal: compiled.ruleset, observed });
    } catch (err) {
      return mapPrWriteError(err, { tag: "admission-ruleset-dry-run", genericError: "The repository's rulesets could not be read." });
    }
  }

  try {
    // Observed-vs-proposed: read what is already on the repo BEFORE adding to it, and return it so a
    // caller who is about to double up on an existing rule can see that.
    const observed = await listRulesets(target.token, target.owner, target.repo).catch(() => []);
    const rulesetId = await applyRuleset(target.token, target.owner, target.repo, compiled.ruleset);
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
  const gated = await gateRulesetRequest(request, "DELETE");
  if (gated instanceof NextResponse) return gated;
  const { org, repo } = gated;

  const admission = await getRepoAdmission(org, repo);
  if (!admission?.rulesetId) {
    return NextResponse.json({ error: `No Ascent ruleset is recorded for ${repo}.` }, { status: 404 });
  }
  const target = await requirePrWriteTarget(org, repo, "tracked");
  if (target instanceof Response) return target;
  const actorLogin = await resolveViewerLogin();

  try {
    await revertRuleset(target.token, target.owner, target.repo, admission.rulesetId);
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
