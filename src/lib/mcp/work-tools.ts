// THE WORK-PROTOCOL HANDLERS (moonshot #3) — claim, brief, report.
//
// A THIRD handler module, and the split follows the same rule the first two did: `registry-reads.ts`
// projects, `registry-writes.ts` reports evidence about the agent's own behaviour, and this one
// operates the org's WORK QUEUE. That is a different kind of write again — it changes which rows are
// available to everyone else — so it carries an authorization the other two do not need
// (`claimability` against the repo's EFFECTIVE autonomy tier and its recorded admission mode) and
// every accepted call is audited by the shared claim path rather than by this module.
//
// WHAT THESE TOOLS ARE FOR. Ascent adjudicates and runs no code. A competitor that remediates only
// with its own agent cannot copy this without conceding the agent; a scorer that has no queue cannot
// copy it at all. The whole protocol is: claim rows under a lease → read the brief with the org's own
// perimeter in it → do the work in your own harness → report what you did. The ruling stays with the
// default-branch rescan, and NO handler here can reach `status: "done"`.
//
// PRINCIPAL IN, NOT AMBIENT. Each handler takes the verified caller's actor id explicitly. A work
// tool that resolved "who am I" from module state would be a tool whose behaviour depends on which
// door dispatched it, and Athena dispatches these same handlers in-process for the read side.

import { claimFollowups, heldFollowups, reportAttempt, type FollowupClaimRow } from "@/lib/db/followup-claims";
import { getActiveOrgStance, getStanceRepoFacts } from "@/lib/db/org-stance";
import { getRepoAdmission } from "@/lib/db/org-admission";
import type { AdmissionMode } from "@/lib/org/admission";
import { attachRemoteClaim } from "@/lib/db/loop-runs-write";
import { repoGlobMatches } from "@/lib/org/stance";
import { openBatch } from "@/lib/local/loop-lane";
import { loadLaneBriefInput } from "@/lib/db/lane-brief-read";
import { buildLaneBrief } from "@/lib/org/lane-brief";
import {
  buildAgentBrief,
  claimRefusalText,
  claimability,
  clampLeaseMs,
  isAttemptVerdict,
  type FollowUpItem,
} from "@/lib/org/followups";
import { fail, str, type Args } from "@/lib/mcp/registry-reads";
import type { McpPrincipal, ToolResult } from "@/lib/mcp/handlers";
import type { AutonomyTierId } from "@/lib/types";

const DEFAULT_CLAIM_COUNT = 3;
const MAX_CLAIM_COUNT = 10;

const ids = (a: Args, k: string): string[] => {
  const v = a[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : [];
};

const int = (a: Args, k: string, dflt: number, min: number, max: number): number => {
  const v = a[k];
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : dflt;
};

/**
 * One repo's facts as the claim gate needs them. Null = the org has no scan of that repo.
 *
 * THE ADMISSION ROW IS THE AUTHORITY ON THE TIER, NOT THE PASSPORT (UAT `PRIYA-L2-C4`). This read
 * used to take `row.autonomyTier` — the DERIVED grade — and stop there, so moonshot #8's whole
 * point, *"the recorded, **overridable** per-repo decision"*, was invisible to the one gate that
 * would act on it. Live, a correctly-scoped org token was refused *"xkazm04/kp is at autonomy tier
 * T0"* on a repo whose owner could have recorded T2 and changed nothing.
 *
 * The precedence is the compiler's own, not a second rule invented here (`compileStance`):
 *   • a tier is EFFECTIVE only where one was ASSESSED — `derivedTier === null` compiles nothing, and
 *     a `grantedTier` sitting beside an unassessed derivation is a seed nobody measured;
 *   • where it was assessed, the GRANT wins. That is the whole meaning of an overridable decision:
 *     an owner may raise T0 → T2, and `mode` is what lowers (a T3 repo held `assisted-only` refuses
 *     an agent outright — `claimability`'s mode rule);
 *   • no admission row at all leaves the derived tier and a null mode, so an org that has decided
 *     nothing is gated exactly as it was.
 *
 * The admission read is best-effort like its two siblings. A gate that threw on an unreadable
 * governance table would turn one degraded read into "this org has no queue", which is a different
 * and much worse sentence than falling back to the derived tier the passport already proved.
 */
async function repoGate(
  org: string,
  repo: string,
): Promise<{ tier: AutonomyTierId | null; sealed: boolean; reviewText: string | null; mode: AdmissionMode | null } | null> {
  const [facts, published, admission] = await Promise.all([
    getStanceRepoFacts(org).catch(() => []),
    getActiveOrgStance(org).catch(() => null),
    getRepoAdmission(org, repo).catch(() => null),
  ]);
  const row = facts.find((f) => f.fullName.toLowerCase() === repo.toLowerCase());
  if (!row) return null;
  const stance = published?.stance ?? null;
  const sealed = Boolean(stance?.noAiZones.some((z) => z.repoGlobs.some((g) => repoGlobMatches(g, row.fullName))));
  const tier = admission && admission.derivedTier !== null ? admission.grantedTier : row.autonomyTier;
  // The review sentence follows the EFFECTIVE tier, so an agent working under a granted T2 is handed
  // the org's own T2 review text rather than the text for the grade it was promoted from.
  const reviewText = tier ? (stance?.reviewTiers.find((t) => t.tier === tier)?.review ?? null) : null;
  return { tier, sealed, reviewText, mode: admission?.mode ?? null };
}

/**
 * `claim_followups` — take rows off the queue under a lease.
 *
 * The tier gate runs BEFORE the claim, and refuses the whole call for the repo rather than per row:
 * "may an agent work unattended here" is a property of the repository, so answering it per id would
 * be the same question asked five times with the same answer, and a partial refusal would read as if
 * some of the repo's rows were more claimable than others.
 */
export async function claimFollowupsTool(org: string, args: Args, principal: McpPrincipal): Promise<ToolResult> {
  const actor = principal.actor;
  const repo = str(args, "repo");
  if (!repo) return fail('Provide `repo` as "owner/name" — a claim is always scoped to one repository.');

  const gate = await repoGate(org, repo);
  if (!gate) {
    return fail(
      `"${repo}" has no scan in this organization, so it has no follow-ups to claim. Absence of a queue is not permission to start work here.`,
    );
  }
  const verdict = claimability({ autonomyTier: gate.tier, executor: "remote-agent", sealed: gate.sealed, admissionMode: gate.mode });
  if (!verdict.allowed) return fail(claimRefusalText(verdict.reason, repo));

  const named = ids(args, "ids");
  let wanted = named;
  if (wanted.length === 0) {
    // No ids: take the top open items the ledger would dispatch itself. `includeDeferred: false` is
    // the honest default — a row a previous session already skipped and explained is not the row to
    // hand the next agent first.
    const batch = await openBatch(org, repo, int(args, "count", DEFAULT_CLAIM_COUNT, 1, MAX_CLAIM_COUNT)).catch(
      () => [] as FollowUpItem[],
    );
    wanted = batch.map((b) => b.id);
  }
  if (wanted.length === 0) {
    return fail(
      `"${repo}" has no open follow-ups and no craft rungs left to claim. That is a real answer about this repository, not an error.`,
    );
  }

  const leaseMs = clampLeaseMs(int(args, "leaseMinutes", 0, 0, 240) * 60_000 || null);
  const res = await claimFollowups({
    org,
    ids: wanted.slice(0, MAX_CLAIM_COUNT),
    actor,
    executor: "remote-agent",
    leaseMs,
    note: "Claimed over the agent door (MCP)",
    tokenId: principal.tokenId,
  });
  if (!res) return fail("This installation has no persistence configured, so there is no queue to claim from.");

  // The cockpit's half. A `remote-agent` lane sits in `queued` under a `curating` run until somebody
  // claims into it; this is the moment that becomes visible. Best-effort by contract — a claim that
  // succeeded is never undone because its display could not be updated.
  if (res.claimed.length > 0) {
    await attachRemoteClaim({
      orgSlug: org,
      repoFullName: repo,
      // The LABEL, not the identity: this string is rendered in the cockpit's lane rail, and
      // `agent:tok_0f3…` names nothing a person recognizes. The identity that arbitrates the claim is
      // `actor` above, and it is the only one the ledger compares.
      claimedBy: principal.label ? `agent:${principal.label}` : actor,
      leaseUntil: res.claimed[0]!.leaseUntil ? new Date(res.claimed[0]!.leaseUntil) : null,
    }).catch(() => false);
  }

  return {
    structuredContent: {
      org,
      repo,
      claimed: res.claimed,
      refused: res.refused,
      requiresHumanReview: verdict.requiresHumanReview,
      autonomyTier: gate.tier,
      next:
        res.claimed.length > 0
          ? "Call get_fix_brief with these ids for the working brief and this organization's perimeter, then report_attempt on each before your lease expires."
          : "Nothing was claimed. Every id you named is held by another worker or is no longer open.",
    },
  };
}

/** The rows a brief is built from, read fresh so the prompt states the gap as the scan states it. */
async function itemsFor(org: string, held: readonly FollowupClaimRow[]): Promise<Map<string, FollowUpItem>> {
  const byRepo = new Map<string, FollowupClaimRow[]>();
  for (const h of held) byRepo.set(h.repo, [...(byRepo.get(h.repo) ?? []), h]);
  const out = new Map<string, FollowUpItem>();
  for (const [repo] of byRepo) {
    // `includeDeferred` because these rows are CLAIMED: a deferral is advisory to the picker, and a
    // row the caller already holds must never be missing from its own brief.
    const batch = await openBatch(org, repo, 500, { includeDeferred: true }).catch(() => [] as FollowUpItem[]);
    for (const it of batch) out.set(it.id, it);
  }
  return out;
}

/**
 * `get_fix_brief` — the working brief for rows this caller HOLDS.
 *
 * A row held by somebody else is named in `refused` rather than dropped: an agent that asked for five
 * briefs and got three needs to know which two it lost, because those are the two it must not work.
 */
export async function getFixBriefTool(org: string, args: Args, principal: McpPrincipal): Promise<ToolResult> {
  const actor = principal.actor;
  const wanted = ids(args, "ids");
  if (wanted.length === 0) return fail("Provide `ids` — the follow-ups you hold. Claim some first with claim_followups.");

  const held = await heldFollowups(org, wanted, actor, principal.legacyActor);
  const heldIds = new Set(held.map((h) => h.id));
  const refused = wanted.filter((id) => !heldIds.has(id));
  if (held.length === 0) {
    return fail(
      "You hold none of those follow-ups. A lease that expired released its rows back to the queue; claim again with claim_followups.",
    );
  }

  const items = await itemsFor(org, held);
  const published = await getActiveOrgStance(org).catch(() => null);
  const generatedAt = new Date().toISOString();
  const briefs: { repo: string; ids: string[]; leaseUntil: string | null; brief: string }[] = [];

  const byRepo = new Map<string, FollowupClaimRow[]>();
  for (const h of held) byRepo.set(h.repo, [...(byRepo.get(h.repo) ?? []), h]);

  for (const [repo, rows] of byRepo) {
    const gate = await repoGate(org, repo);
    const picked = rows.map((r) => items.get(r.id)).filter((x): x is FollowUpItem => Boolean(x));
    if (picked.length === 0) continue;
    // THE ORG'S STANDARD TRAVELS WITH THE REMOTE BRIEF TOO (`PRIYA-L1-706`). The local lane has
    // assembled it since moonshot #25 and this door did not, so the same organization briefed a
    // local agent with its playbooks, house pattern, memory and skills and a remote one with none of
    // them. SAME assembly, deliberately — a second "equivalent" one is how the two drift. A failed
    // read degrades to no standard rather than failing the brief: an agent holding a lease needs its
    // rows more than it needs the preamble.
    const standardInput = await loadLaneBriefInput(
      org,
      repo,
      [...new Set(picked.map((p) => p.dimId).filter(Boolean))],
    ).catch(() => null);
    const standard = standardInput ? buildLaneBrief(standardInput).text : null;
    briefs.push({
      repo,
      ids: picked.map((p) => p.id),
      // The EARLIEST lease across the repo's rows: an agent should pace itself against the first one
      // that lapses, not the last. Null when the rows carry no lease (a human hand-off), which this
      // door cannot produce but a mixed read could.
      leaseUntil: rows.map((r) => r.leaseUntil).filter((l): l is string => Boolean(l)).sort()[0] ?? null,
      brief: buildAgentBrief(picked, { org, generatedAt, standard }, {
        repo,
        autonomyTier: gate?.tier ?? null,
        reviewText: gate?.reviewText ?? null,
        requiresHumanReview: gate ? gate.tier !== "T3" : true,
        leaseUntil: rows.map((r) => r.leaseUntil).filter((l): l is string => Boolean(l)).sort()[0] ?? "no lease",
        stance: published?.stance ?? null,
      }),
    });
  }

  return {
    structuredContent: {
      org,
      briefs,
      // Named, never silently dropped — see the doc comment.
      refused: refused.map((id) => ({ id, reason: "not-held" })),
    },
    // The brief is the payload a model actually reads, so it is the text channel too, joined rather
    // than JSON-quoted: a markdown document rendered as an escaped JSON string is a document the
    // model has to un-escape before it can follow it.
    text: briefs.map((b) => b.brief).join("\n\n---\n\n"),
  };
}

/**
 * `report_attempt` — the agent's account of ONE row it holds.
 *
 * Nothing here closes. `resolved` clears the lease and leaves the row in progress for the rescan to
 * rule on; `skipped` returns it to the queue; `needs_human` flags the escalation and leaves the work
 * visibly open. This is the answer to the catalog's own question — the write path has no verb that
 * closes a recommendation, so an agent cannot certify its own homework.
 */
export async function reportAttemptTool(org: string, args: Args, principal: McpPrincipal): Promise<ToolResult> {
  const actor = principal.actor;
  const id = str(args, "id");
  const verdict = str(args, "verdict");
  const reason = str(args, "reason");
  if (!id) return fail("Provide `id` — the follow-up you are reporting on.");
  if (!isAttemptVerdict(verdict)) {
    return fail('Provide `verdict` as one of "resolved", "skipped" or "needs_human".');
  }
  if (!reason) {
    return fail("Provide `reason` — one sentence in your own words. A verdict with no reason is not an account of anything.");
  }

  const row = await reportAttempt({
    org,
    id,
    actor,
    legacyActor: principal.legacyActor,
    verdict,
    reason,
    branch: str(args, "branch"),
    prUrl: str(args, "prUrl"),
    tokenId: principal.tokenId,
  });
  if (!row) {
    return fail(
      `You do not hold "${id}", so there is nothing to report against it. A lease that expired released its rows; claim again with claim_followups.`,
    );
  }

  return {
    structuredContent: {
      org,
      id: row.id,
      repo: row.repo,
      verdict,
      // THE ROW'S REAL STATE, not an echo of the verdict. An agent that reported `resolved` is being
      // told, in the same breath, that the row is still in progress and why.
      claim: row,
      adjudication:
        verdict === "resolved"
          ? "Recorded. This does not close the row: Ascent's next scan of the default branch decides, by whether the gap stops being raised and the dimension measurably moves."
          : verdict === "skipped"
            ? "Recorded. The row is back on the queue for whoever comes next."
            : "Recorded and escalated. The row stays open and is flagged for a person; it has not been closed.",
    },
  };
}
