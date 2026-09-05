// POST /api/report/foundation/pr { repo: "owner/name", base? }  ->  { url, number, reused, committed, skipped }
//
// Open a DRAFT PR that installs the generated `.ai/` FOUNDATION (manifest spine, doctor, CI backstop,
// maintain, memory seed, CONTEXT scaffold) into the scanned repo — one click instead of the adopting
// repo's agent hand-transcribing the same files out of the downloaded SKILL.md. The SKILL.md download
// (/api/report/skill) is unchanged and remains the fallback for repos without the App installed.
//
// Sibling of /api/report/passport/pr and deliberately identical in its gate chain (db + App configured,
// same-origin, signed-in, org-owned, org ADMIN, installation token) — it is the same customer-repo
// WRITE surface, so it reuses the same helpers (requirePrWriteContext / mapPrWriteError / openDraftPr
// via openFoundationPr) rather than forking a second client.

import { NextResponse } from "next/server";
import { isAppConfigured } from "@/lib/github/app";
import { getScanReportByCommit, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { PUBLIC_ORG, isAuthConfigured, requireSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { mapPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { buildFoundation } from "@/lib/standard";
import { openFoundationPr } from "@/lib/standard/pr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseRepo(q: string): { owner: string; name: string } | null {
  const slash = q.indexOf("/");
  if (slash <= 0 || slash === q.length - 1 || q.indexOf("/", slash + 1) >= 0) return null;
  return { owner: q.slice(0, slash), name: q.slice(slash + 1) };
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Installing the foundation requires a database." }, { status: 503 });
  if (!isAppConfigured()) {
    return NextResponse.json({ error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." }, { status: 503 });
  }
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if ((authGateEnabled() || isAuthConfigured()) && !(await resolveViewerLogin())) {
    return NextResponse.json({ error: "Sign in to open a foundation PR." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { repo?: string; base?: string };
  const parsed = body.repo ? parseRepo(body.repo) : null;
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });

  const org = await readableOrgForOwner(parsed.owner);
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Foundation PRs are only for org-owned repositories." }, { status: 403 });
  }
  // Opening a PR is a WRITE into a customer repo with the org's installation token, so this needs the
  // SAME gate as /api/practices/apply{,-batch}: at least the "admin" role, not merely membership. It
  // used to be requireOrgAccess (member), which left one action with two gates once those routes were
  // tightened. The blast radius is if anything larger here — the foundation seeds a whole `.ai/` tree
  // including a CI workflow, and "the caller can already READ this repo" is not the question; the write
  // is. Draft status is a review convenience, not an authorization boundary.
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  // The foundation is generated FROM the persisted scan (commands, archetype, freshness anchors), so a
  // repo with no saved scan has nothing to install — same 404 contract as the SKILL.md export.
  const report = await getScanReportByCommit(parsed.owner, parsed.name, { orgSlug: org }).catch(() => null);
  if (!report) {
    return NextResponse.json({ error: "No saved scan for this repository yet. Scan it first, then install." }, { status: 404 });
  }
  const files = buildFoundation(report);
  const actorLogin = await resolveViewerLogin();
  try {
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;
    const { token } = ctx;
    const pr = await openFoundationPr({
      token,
      owner: parsed.owner,
      repo: parsed.name,
      base: body.base,
      files,
      prTitle: "Install the .ai/ AI-native foundation",
      prBody:
        `Seeds the \`.ai/\` foundation Ascent generated from this repo's latest scan: the agent-facing ` +
        `contract (\`.ai/manifest.yaml\`), the executable conformance check (\`.ai/doctor.mjs\`) and its CI ` +
        `backstop, the upkeep script, the durable memory store, and the CONTEXT graph seed.\n\n` +
        `Next: adapt every \`TODO\` to this repo, wire \`node .ai/doctor.mjs\` into your existing pre-push ` +
        `hook, then run it for a conformance baseline. Sibling to the descriptive \`.ai/passport.json\`.`,
    });
    await recordOrgAudit(
      "foundation.pr_opened",
      org,
      { repo: `${parsed.owner}/${parsed.name}`, pr: pr.number, reused: pr.reused, committed: pr.committed.length, skipped: pr.skipped },
      actorLogin ?? undefined,
    );
    return NextResponse.json(pr);
  } catch (err) {
    // A 409 here can only come from the SPINE (`.ai/manifest.yaml` already on base) — later collisions
    // are skipped, not thrown. Surface openDraftPr's own message, matching passport/pr.
    return mapPrWriteError(err, {
      tag: "foundation/pr",
      genericError: "Failed to open the foundation PR.",
      conflict: (e) => e.message,
    });
  }
}
