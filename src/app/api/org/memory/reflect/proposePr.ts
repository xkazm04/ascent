// The `proposePr` branch of POST /api/org/memory/reflect (#36) — a consolidation over
// registry-origin memory, published as a reviewable pull request.
//
// Split out of `route.ts` so that file stays the thin adapter its header promises: this branch is
// four gates, a resolve, a row and a GitHub call, and inlining it would double the route's length.
//
// The floor is MEMBER, not admin, and that is deliberate. Nothing here lands in the registry — it
// opens a draft PR that a CODEOWNER must merge, and CODEOWNERS review is the real control. Requiring
// admin to *propose* would mean the people who write the memory cannot propose consolidating it.

import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/db";
import { getOrgRegistry } from "@/lib/db/org-registry";
import { guardRegistryWrite } from "@/lib/registry/api";
import { createMemoryProposal, resolveProposalMembers, setMemoryProposalPr } from "@/lib/db/org-registry-proposals";
import { proposeMemoryPr, slugifyNoteName } from "@/lib/registry/memory-pr";

export interface ProposePrInput {
  summaryContent?: string;
  memberIds?: string[];
  confidence?: number;
  namespace?: string;
  kind?: string;
  slug?: string;
}

/** `memory/<kind>/…` — the directory a note lands in. Anything else cannot address a path. */
const KIND = /^[a-z][a-z0-9-]{0,30}$/;

export async function proposePrBranch(
  orgSlug: string,
  input: ProposePrInput,
  ctx: { orgId: string | undefined; viewer: string | null },
): Promise<NextResponse> {
  const { summaryContent, memberIds } = input;
  if (!summaryContent?.trim() || !Array.isArray(memberIds) || memberIds.length < 2) {
    return NextResponse.json(
      { error: "Provide { proposePr: { summaryContent, memberIds: [>=2 ids] } }." },
      { status: 400 },
    );
  }
  if (!memberIds.every((id) => typeof id === "string" && id)) {
    return NextResponse.json({ error: "memberIds must be strings." }, { status: 400 });
  }
  const kind = input.kind?.trim() || "summary";
  if (!KIND.test(kind)) return NextResponse.json({ error: "kind must be a simple lowercase name." }, { status: 400 });
  if (!ctx.orgId) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });

  const registry = await getOrgRegistry(orgSlug).catch(() => null);
  if (!registry) {
    return NextResponse.json(
      { error: "This organization has no registry mapped, so there is nowhere to propose to.", code: "not-mapped" },
      { status: 409 },
    );
  }

  // Org-scoped resolve — the same tenant boundary `applyReflection` relies on. An id from another
  // org is simply not found, so it can never reach the PR body; the count mismatch is the refusal.
  const members = await resolveProposalMembers(ctx.orgId, memberIds);
  if (members.length !== memberIds.length) {
    return NextResponse.json({ error: "Some members are not live memories in this organization." }, { status: 400 });
  }
  const paths = members.map((m) => m.registryPath).filter((p): p is string => Boolean(p));
  if (!paths.length) {
    return NextResponse.json(
      {
        error: "None of these notes are mirrored in your registry, so there is nothing for a pull request to supersede. Apply it here instead.",
        code: "no-registry-members",
      },
      { status: 409 },
    );
  }

  const gate = await guardRegistryWrite(orgSlug, { minRole: "member" });
  if (gate instanceof NextResponse) return gate;

  const slug = slugifyNoteName(input.slug || summaryContent.split("\n")[0] || "reflection");
  const namespace = input.namespace?.trim() || members.find((m) => m.namespace)?.namespace || null;

  // The row is written BEFORE the GitHub call: an attempt to publish into someone's repo is the
  // auditable act, and recording only the successes would hide the attempts worth looking at.
  const proposal = await createMemoryProposal({
    orgId: ctx.orgId,
    registryId: registry.id,
    namespace,
    kind,
    slug,
    summaryContent,
    memberIds,
    memberPaths: paths,
    createdBy: ctx.viewer,
  }).catch(() => null);

  const pr = await proposeMemoryPr({
    token: gate.token,
    fullName: registry.fullName,
    defaultBranch: registry.defaultBranch || undefined,
    kind,
    slug,
    note: {
      kind,
      namespace,
      confidence: typeof input.confidence === "number" ? input.confidence : 0.6,
      content: summaryContent,
      supersedes: paths,
    },
    actor: ctx.viewer,
  });
  if (!pr.ok) {
    // The proposal row stays at `proposed`. It is the record of what was attempted.
    return NextResponse.json({ error: pr.reason, code: "github-error" }, { status: pr.status });
  }

  if (proposal) await setMemoryProposalPr(proposal.id, { url: pr.url, number: pr.number });
  await recordAudit(
    "org_memory.pr_proposed",
    { proposalId: proposal?.id ?? null, slug, prUrl: pr.url, memberIds },
    { orgId: ctx.orgId, actorId: ctx.viewer ?? undefined },
  );
  return NextResponse.json({
    proposalId: proposal?.id ?? null,
    url: pr.url,
    number: pr.number,
    branch: pr.branch,
    path: pr.path,
    reused: pr.reused,
    supersedes: paths,
  });
}
