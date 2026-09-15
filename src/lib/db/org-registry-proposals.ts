// `OrgMemoryProposal` — a reflection over REGISTRY-origin memory, and the pull request that carries
// it (#36).
//
// Why a row at all, when the PR is the real artifact: the PR lives in the customer's repo and ascent
// must be able to say what it proposed and who asked for it even if the PR is closed, renamed or the
// repo goes away. The row is written BEFORE the GitHub call for the same reason the signals audit is
// — an attempt to publish is the auditable act.
//
// Named `org-registry-*` deliberately rather than `org-memory-*`: it belongs to this lane's doc glob
// and to the registry's lifecycle, not to the hosted memory store's.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export type MemoryProposalStatus = "proposed" | "pr_open" | "merged" | "closed";

/** One proposal, client-facing (timestamps are ISO strings). */
export interface MemoryProposalRow {
  id: string;
  namespace: string | null;
  kind: string;
  slug: string;
  summaryContent: string;
  /** OrgMemory ids the note would supersede. */
  memberIds: string[];
  /** Their repo-relative paths — what the PR's frontmatter actually cites. */
  memberPaths: string[];
  status: MemoryProposalStatus;
  prUrl: string | null;
  prNumber: number | null;
  createdBy: string | null;
  createdAt: string;
}

const parseList = (raw: string): string[] => {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

/** The members a reflection names, resolved inside ONE org. */
export interface ProposalMember {
  id: string;
  origin: "hosted" | "registry";
  registryPath: string | null;
  registryId: string | null;
  namespace: string | null;
  kind: string;
}

/**
 * Resolve member ids to their rows, org-scoped.
 *
 * The org filter is the tenant boundary, exactly as `applyReflection` treats it: an id belonging to
 * another org is simply not found, so the caller sees fewer members than it asked for and refuses —
 * there is no path by which a foreign row's origin or path reaches the PR body.
 */
export async function resolveProposalMembers(orgId: string, memberIds: string[]): Promise<ProposalMember[]> {
  if (!isDbConfigured() || !memberIds.length) return [];
  const rows = await getPrisma().orgMemory.findMany({
    where: { orgId, id: { in: memberIds.slice(0, 100) }, archived: false },
    select: { id: true, origin: true, registryPath: true, registryId: true, namespace: true, kind: true },
  });
  return rows.map((r) => ({
    id: r.id,
    origin: r.origin === "registry" ? "registry" : "hosted",
    registryPath: r.registryPath ?? null,
    registryId: r.registryId ?? null,
    namespace: r.namespace ?? null,
    kind: r.kind,
  }));
}

/** Record a proposal before the PR is opened. Returns the row, or null when persistence is off. */
export async function createMemoryProposal(input: {
  orgId: string;
  registryId: string | null;
  namespace: string | null;
  kind: string;
  slug: string;
  summaryContent: string;
  memberIds: string[];
  memberPaths: string[];
  createdBy: string | null;
}): Promise<MemoryProposalRow | null> {
  if (!isDbConfigured()) return null;
  const data = {
    registryId: input.registryId,
    namespace: input.namespace,
    kind: input.kind,
    summaryContent: input.summaryContent.slice(0, 20_000),
    memberIdsJson: JSON.stringify(input.memberIds.slice(0, 100)),
    memberPathsJson: JSON.stringify(input.memberPaths.slice(0, 100)),
    status: "proposed",
    prUrl: null,
    prNumber: null,
    createdBy: input.createdBy,
  };
  // Upsert on `(orgId, slug)`: re-proposing the same rollup replaces the previous attempt rather
  // than colliding on the unique key, which is what a user retrying a failed PR actually means.
  const row = await getPrisma().orgMemoryProposal.upsert({
    where: { orgId_slug: { orgId: input.orgId, slug: input.slug } },
    update: data,
    create: { orgId: input.orgId, slug: input.slug, ...data },
  });
  return toRow(row);
}

/** Stamp the PR onto a proposal once GitHub answered. */
export async function setMemoryProposalPr(
  id: string,
  pr: { url: string; number: number },
): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma()
    .orgMemoryProposal.update({ where: { id }, data: { status: "pr_open", prUrl: pr.url, prNumber: pr.number } })
    .catch(() => {});
}

/** Every proposal for an org, newest first. */
export async function listMemoryProposals(orgId: string, limit = 20): Promise<MemoryProposalRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().orgMemoryProposal.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: Math.min(100, Math.max(1, limit)),
  });
  return rows.map(toRow);
}

function toRow(r: {
  id: string;
  namespace: string | null;
  kind: string;
  slug: string;
  summaryContent: string;
  memberIdsJson: string;
  memberPathsJson: string;
  status: string;
  prUrl: string | null;
  prNumber: number | null;
  createdBy: string | null;
  createdAt: Date;
}): MemoryProposalRow {
  return {
    id: r.id,
    namespace: r.namespace,
    kind: r.kind,
    slug: r.slug,
    summaryContent: r.summaryContent,
    memberIds: parseList(r.memberIdsJson),
    memberPaths: parseList(r.memberPathsJson),
    status: (["proposed", "pr_open", "merged", "closed"] as const).includes(r.status as MemoryProposalStatus)
      ? (r.status as MemoryProposalStatus)
      : "proposed",
    prUrl: r.prUrl,
    prNumber: r.prNumber,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}
