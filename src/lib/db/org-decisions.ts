// The decision store: human judgments on derived findings (src/lib/org/findings.ts), plus the
// write-through that publishes each judgment into Shared Org Memory so connected agents and the scan
// prompt learn from it.
//
// Tenancy, belt and suspenders: `orgId` is resolved server-side from the slug and AND-ed into EVERY
// query here — never taken from a request param — while the route gates on requireOrgAccess. Same
// policy org-memory.ts states.
//
// Sparse by construction: an undecided finding has NO row. That is what keeps the badge count a single
// indexed read (`count(status = open)` never even sees the untouched majority) and it is why `decide`
// is an UPSERT on the (orgId, module, itemKey) unique — re-deciding edits the row rather than
// appending. `status: "open"` therefore means REOPENED, not "never looked at".
//
// The memory write-through is deliberately best-effort and NON-transactional with the decision itself.
// A decision is the source of truth for the badge; a memory is a derived artifact for agents. Coupling
// them in one transaction would mean a Team-plan entitlement failure (memory is gated) or a slow LLM-
// adjacent write could roll back a governance decision the user just made. So the decision commits
// first and the memory is attached afterwards — a missing memoryId is a recoverable gap, a lost
// decision is not.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, normalizeOrgSlug } from "@/lib/db/org-shared";
import { createOrgMemory } from "@/lib/db/org-memory";
import { recordAudit } from "@/lib/db/scans-audit";
import { isFindingModule, type FindingModule } from "@/lib/org/findings";

/** open = reopened / awaiting a call. The other three are resolutions. */
export const DECISION_STATUSES = ["open", "accepted", "dismissed", "snoozed"] as const;

export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export function isDecisionStatus(v: string | null | undefined): v is DecisionStatus {
  return typeof v === "string" && (DECISION_STATUSES as readonly string[]).includes(v);
}

/** A status that takes the finding OUT of the badge (a snooze only until its date passes). */
export function isResolved(status: string, snoozedUntil: Date | null, now = new Date()): boolean {
  if (status === "accepted" || status === "dismissed") return true;
  if (status === "snoozed") return snoozedUntil != null && snoozedUntil > now;
  return false;
}

export interface DecisionRow {
  module: string;
  itemKey: string;
  status: string;
  rationale: string;
  title: string;
  decidedBy: string | null;
  snoozedUntil: Date | null;
  updatedAt: Date;
}

export interface DecideInput {
  module: FindingModule;
  itemKey: string;
  status: DecisionStatus;
  /** Why. This is the payload agents actually learn from — empty is allowed but discouraged. */
  rationale?: string;
  /** The finding's title at decision time, so the record still reads after the finding disappears. */
  title?: string;
  snoozedUntil?: Date | null;
}

/** Every decision an org has recorded. Sparse — typically far smaller than the finding set. */
export async function listDecisions(orgSlug: string, module?: FindingModule): Promise<DecisionRow[] | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  return getPrisma().orgDecision.findMany({
    where: { orgId: org.id, ...(module ? { module } : {}) },
    select: {
      module: true,
      itemKey: true,
      status: true,
      rationale: true,
      title: true,
      decidedBy: true,
      snoozedUntil: true,
      updatedAt: true,
    },
  });
}

/** The itemKeys currently resolved, per module — what the badge subtracts from the derived findings. */
export async function resolvedKeys(orgSlug: string, now = new Date()): Promise<Map<string, Set<string>>> {
  const rows = (await listDecisions(orgSlug)) ?? [];
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!isResolved(r.status, r.snoozedUntil, now)) continue;
    let set = out.get(r.module);
    if (!set) out.set(r.module, (set = new Set()));
    set.add(r.itemKey);
  }
  return out;
}

/** A decision as the scan prompt sees it — the judgment plus the reason it was made. */
export interface DecisionNote {
  module: string;
  title: string;
  status: string;
  rationale: string;
}

/** Keep the prompt block bounded: a repo with 40 dismissed findings must not crowd out its own code. */
const MAX_PROMPT_DECISIONS = 12;

/**
 * The org's settled decisions ABOUT ONE REPO, for injection into that repo's scan prompt. Every
 * itemKey is either the repo's fullName (teams, contributors) or `${fullName}::${suffix}` (security
 * checks, passport blockers) — see src/lib/org/findings.ts — so a prefix match is exact, not a guess.
 *
 * Only RESOLVED decisions carrying a rationale are returned: an open finding teaches the model nothing,
 * and a resolution with no reason ("dismissed", full stop) would read as unexplained noise that the
 * model might over-fit to. Newest first, bounded.
 */
export async function decisionsForRepo(orgSlug: string, fullName: string): Promise<DecisionNote[]> {
  const rows = (await listDecisions(orgSlug).catch(() => null)) ?? [];
  const now = new Date();
  const prefix = `${fullName}::`;
  return rows
    .filter((r) => r.itemKey === fullName || r.itemKey.startsWith(prefix))
    .filter((r) => isResolved(r.status, r.snoozedUntil, now) && r.rationale.trim())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, MAX_PROMPT_DECISIONS)
    .map((r) => ({ module: r.module, title: r.title || r.itemKey, status: r.status, rationale: r.rationale }));
}

/** The memory `kind` for a decision: it happened, on a date, to a named thing. */
const DECISION_MEMORY_KIND = "episodic";

function memoryContent(input: DecideInput, decidedBy: string | null): string {
  const who = decidedBy ? ` by ${decidedBy}` : "";
  const why = input.rationale?.trim() ? ` Rationale: ${input.rationale.trim()}` : "";
  return `Decision (${input.module}): ${input.status}${who} — ${input.title || input.itemKey}.${why}`;
}

/**
 * Record a decision and publish it to Shared Org Memory. Returns the persisted row, or null when the
 * DB is off / the org is unknown. The caller must have already passed requireOrgAccess.
 *
 * The memory write is best-effort (see the header): it is attached to the decision when it lands, and
 * swallowed when it doesn't — memory is a Team-plan feature, so a Free-plan org records decisions and
 * simply publishes nothing.
 */
export async function decide(
  orgSlug: string,
  input: DecideInput,
  decidedBy: string | null,
): Promise<{ id: string; memoryId: string | null } | null> {
  if (!isDbConfigured()) return null;
  if (!isFindingModule(input.module) || !isDecisionStatus(input.status)) return null;
  const itemKey = input.itemKey.trim();
  if (!itemKey) return null;

  const prisma = getPrisma();
  const org = await getOrgBySlug(normalizeOrgSlug(orgSlug));
  if (!org) return null;

  const snoozedUntil = input.status === "snoozed" ? (input.snoozedUntil ?? null) : null;
  const data = {
    status: input.status,
    rationale: input.rationale?.trim() ?? "",
    title: input.title?.trim() ?? "",
    decidedBy,
    snoozedUntil,
  };

  const row = await prisma.orgDecision.upsert({
    where: { orgId_module_itemKey: { orgId: org.id, module: input.module, itemKey } },
    update: data,
    create: { orgId: org.id, module: input.module, itemKey, ...data },
    select: { id: true },
  });

  // Publish to memory so agents + the scan prompt inherit the reasoning. Reopening isn't a decision
  // worth teaching an agent, so only resolutions are published.
  let memoryId: string | null = null;
  if (input.status !== "open") {
    const memory = await createOrgMemory(
      orgSlug,
      {
        content: memoryContent(input, decidedBy),
        kind: DECISION_MEMORY_KIND,
        source: `ascent:${input.module}`,
        tags: ["decision", input.module, input.status],
      },
      decidedBy,
    ).catch(() => null);
    memoryId = memory?.id ?? null;
    if (memoryId) {
      await prisma.orgDecision.update({ where: { id: row.id }, data: { memoryId } }).catch(() => {});
    }
  }

  await recordAudit(
    "org_decision.recorded",
    { module: input.module, itemKey, status: input.status, memoryId },
    { orgId: org.id, actorId: decidedBy ?? undefined },
  );

  return { id: row.id, memoryId };
}
