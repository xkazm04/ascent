// POST /api/org/admission/propose { org, repo, owners?, confirm? } -> { diff, willCreate, willModify, pr? }
//
// AGENT ADMISSION (moonshot #8) — the CODEOWNERS proposal. DRY RUN BY DEFAULT: without `confirm`
// this reads the repo's existing CODEOWNERS, splices the managed block, and returns the unified diff
// having written nothing. `confirm: true` opens a draft PR with that exact diff.
//
// Why the diff comes first and always: this writes into a file a customer already owns. The managed
// block touches only the region between its markers, but "trust me, it only touches the markers" is
// not something a reviewer can verify from a button. The diff is.
//
// Auth: OWNER. The spec sketched admin, but `requireOrgOwnerPost` is the only same-origin POST gate
// this codebase has, and the stricter bar is the safe direction for a route that writes into a
// customer repository. Gate-then-constrain on the repo name, and an audit row on every call — dry
// runs included, because "who looked at what we would write" is itself part of the record.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getActiveOrgStance } from "@/lib/db/org-stance";
import { getRepoAdmission } from "@/lib/db/org-admission";
import { codeownersMarkers, compileStance } from "@/lib/org/admission";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { requirePrWriteContext, mapPrWriteError } from "@/lib/github/pr-route";
import { proposeManagedBlock } from "@/lib/github/admission-write";
import { resolveViewerLogin } from "@/lib/access";
import { repoUnderOrg } from "@/app/api/org/admission/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reviewing teams the block will name. Bounded and shape-checked: these become CODEOWNERS entries
 *  in a customer's repository, so a stray token would silently break their whole ownership file. */
function cleanOwners(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((o): o is string => typeof o === "string" && /^@[\w-]+(\/[\w-]+)?$/.test(o.trim())).map((o) => o.trim()))].slice(0, 10);
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Admission proposals require a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ repo?: unknown; owners?: unknown; confirm?: unknown }>(request, {
    missingOrgError: "Provide { org, repo, owners }.",
  });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  const repo = await repoUnderOrg(org, body.repo);
  if (!repo) return NextResponse.json({ error: 'Provide repo as "owner/name" under this organization.' }, { status: 400 });
  const owners = cleanOwners(body.owners);
  if (owners.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one reviewing team as owners: [\"@org/team\"] — a CODEOWNERS block needs an owner to name." },
      { status: 400 },
    );
  }

  const [stance, admission] = await Promise.all([getActiveOrgStance(org), getRepoAdmission(org, repo)]);
  if (!stance) return NextResponse.json({ error: "This organization has not published an AI stance." }, { status: 400 });
  if (!admission) {
    // Honest null: no assessed tier means no compiled control, and a proposal built from nothing
    // would be a PR asserting a policy the data cannot support.
    return NextResponse.json({ error: `No autonomy tier has been assessed for ${repo}; scan it before proposing controls.` }, { status: 400 });
  }
  const compiled = compileStance(
    stance.stance,
    admission,
    { fullName: repo, derivedTier: admission.derivedTier, codeownersPaths: [], observedRequiredApprovals: null, protectedBranch: null },
    stance.version,
    { owners },
  );
  if (!compiled.codeownersBlock) {
    return NextResponse.json({ error: "This stance declares no path-scoped no-AI zones, so there is nothing to propose." }, { status: 400 });
  }

  const confirm = body.confirm === true;
  const ctx = await requirePrWriteContext(org);
  if (ctx instanceof NextResponse) return ctx;
  const [, name] = repo.split("/");
  const { begin, end } = codeownersMarkers(stance.version);
  const actorLogin = await resolveViewerLogin();

  try {
    const result = await proposeManagedBlock({
      token: ctx.token,
      owner: org,
      repo: name!,
      path: "CODEOWNERS",
      block: compiled.codeownersBlock,
      begin,
      end,
      // Branch name is pinned to the stance VERSION, not to a timestamp: a re-proposal of the same
      // stance reuses the branch (and updates its PR) instead of littering the repo with one branch
      // per click.
      branch: `ascent/ai-stance-v${stance.version}`,
      commitMessage: `chore(codeowners): require named review for AI-restricted paths (ascent stance v${stance.version})`,
      prTitle: `Require named review for the organization's no-AI path zones`,
      prBody:
        `This adds a managed block to \`CODEOWNERS\` for the paths this organization's AI stance ` +
        `(v${stance.version}) declares as no-AI zones.\n\n` +
        `CODEOWNERS cannot see who wrote a change, so this does **not** detect AI authorship. It ` +
        `guarantees a named human reviews any change to those paths — the enforceable half of the ` +
        `declaration. Nothing outside the \`ascent:ai-stance\` markers is touched, and re-running ` +
        `produces no diff.\n\n` +
        `Opened by Ascent on behalf of ${actorLogin ?? "an organization admin"}.`,
      confirm,
    });

    await recordOrgAudit(
      "org.admission_propose",
      org,
      {
        org,
        repo,
        confirmed: confirm,
        stanceVersion: stance.version,
        owners,
        prUrl: result.pr?.url ?? null,
        // A dry run is recorded too: "who looked at what we would write" is part of the record, and a
        // gap between the dry runs and the confirmed one is exactly what an examiner reads.
        status: confirm
          ? `CODEOWNERS PR ${result.pr ? `opened (${result.pr.url})` : "unchanged — no diff"} for ${repo}`
          : `dry run for ${repo}: ${result.diff ? "would modify CODEOWNERS" : "no change"}`,
      },
      actorLogin ?? undefined,
    ).catch(() => {});

    return NextResponse.json(result);
  } catch (err) {
    return mapPrWriteError(err, {
      tag: "admission-propose",
      genericError: "The CODEOWNERS proposal could not be prepared.",
    });
  }
}
