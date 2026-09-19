// Pure follow-up claim authorization and lease arithmetic.
import type { AiStance, AutonomyTierId } from "@/lib/types";
// Type-only: the admission compiler is pure and has no db edge, so this stays a leaf import.
import type { AdmissionMode } from "@/lib/org/admission";
// TYPE-ONLY, and it has to stay that way: `lane-report.ts` reaches for `node:fs/promises`, and this
// module is imported by the ledger's client model. The import is erased at compile time, so the two
// share a vocabulary without the client sharing a filesystem.
import type { LaneVerdict } from "@/lib/local/lane-report";


// ─── The work LEASE and who may hold it (moonshot #3) ────────────────────────────────────────────
//
// Everything below is PURE. The claim itself is one compare-and-set in `src/lib/db/followup-claims.ts`
// that BOTH the local loop engine and a remote agent over MCP call — the database decides who wins.
// What lives here is the arithmetic and the authorization that must read identically in a unit test,
// in the ledger UI and at the MCP door: when a lease has lapsed, who may take one at all, and what
// the agent is told about the perimeter it is working inside.

/** What is holding a row. The ledger renders it; `claimability` authorizes against it. */
export type ClaimExecutor = "local" | "remote-agent" | "human";

/**
 * The default lease: ONE WORKING SESSION. Long enough that an agent working five gaps in a real
 * repository is not interrupted; short enough that a crashed agent's rows are back on the queue
 * before anybody notices they were gone. The cap exists because a lease is the only thing standing
 * between "an agent is working this" and "this row is invisible to everyone forever" — four hours is
 * already a generous outer bound for a session nobody is watching.
 */
export const AGENT_LEASE_MS_DEFAULT = 45 * 60_000;
export const AGENT_LEASE_MS_MAX = 4 * 60 * 60_000;
export const AGENT_LEASE_MS_MIN = 5 * 60_000;

/**
 * The verdicts a remote agent may report. A STRICT SUBSET of the lane report's own `LaneVerdict`,
 * asserted against it rather than re-declared: `.ascent/lane-report.json` v1 and this door describe
 * the same event — "what the session says it did with one item" — and a second, nearly-identical
 * vocabulary is how the two would drift into disagreeing about what `skipped` means. Absent from it
 * deliberately: `attempted` (a coercion the file parser applies to a verdict it could not read; a
 * caller with a declared schema has no excuse for one) and `absent` (which the lane assigns to an id
 * nobody mentioned, and a per-id call cannot be).
 */
export const ATTEMPT_VERDICTS = ["resolved", "skipped", "needs_human"] as const satisfies readonly LaneVerdict[];
export type AttemptVerdict = (typeof ATTEMPT_VERDICTS)[number];

export function isAttemptVerdict(v: unknown): v is AttemptVerdict {
  return typeof v === "string" && (ATTEMPT_VERDICTS as readonly string[]).includes(v);
}

/**
 * Has this lease lapsed? `null` is NOT expiry and never will be: a null lease on an in-progress row
 * means A HUMAN TOOK IT from the browser hand-off, which is a claim with no clock on it. Reading
 * null as "expired" would let the sweep pull work out from under a person.
 */
export function leaseExpired(leaseUntil: string | null, now: Date): boolean {
  if (!leaseUntil) return false;
  const t = Date.parse(leaseUntil);
  return Number.isFinite(t) && t <= now.getTime();
}

/** Milliseconds left on a lease; null when there is none (see `leaseExpired`), 0 once lapsed. */
export function leaseRemainingMs(leaseUntil: string | null, now: Date): number | null {
  if (!leaseUntil) return null;
  const t = Date.parse(leaseUntil);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t - now.getTime());
}

/** Clamp a caller-supplied lease into the band above. Asking for nothing gets the default. */
export function clampLeaseMs(ms: number | null | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return AGENT_LEASE_MS_DEFAULT;
  return Math.min(AGENT_LEASE_MS_MAX, Math.max(AGENT_LEASE_MS_MIN, Math.round(ms)));
}

export type ClaimRefusal = "tier-blocked" | "tier-unknown" | "no-ai-zone" | "admission-blocked";

export type ClaimVerdict =
  | { allowed: true; requiresHumanReview: boolean }
  | { allowed: false; reason: ClaimRefusal };

/**
 * MAY THIS EXECUTOR CLAIM WORK IN THIS REPO? Pure, ONE input struct — and the struct is the whole
 * extension seam: W4-O's compiled `RepoAdmission` swaps in as the source of `autonomyTier` without
 * a single caller changing.
 *
 * The rules, and why each is where it is:
 *   • **T0 refuses a remote agent.** T0 is the tier that means "no unattended AI authorship here". A
 *     queue an agent PULLS from has to honour that at the claim, not by trusting the agent to read
 *     the brief it is handed afterwards.
 *   • **An unknown tier refuses too** — the rule that will look wrong to somebody one day, so: a
 *     repository with no passport has not PROVEN it can be worked unattended. Unknown is not green.
 *     Failing open here would make the newest, least-understood repository in the fleet the one an
 *     agent may work with no supervision at all, which is exactly backwards.
 *   • **T1/T2 allow the claim and flag review.** The flag rides into the brief and the ledger; it
 *     changes nobody's permission to claim, because a human reviewing the RESULT is a different
 *     control from a human authorizing the ATTEMPT.
 *   • **T3 allows it plainly.**
 *   • A repo inside a declared no-AI zone is refused outright, whatever its tier.
 *   • **An admission MODE below `agents-allowed` refuses outright too**, whatever the tier. The tier
 *     answers "how much supervision has this repository earned"; the mode answers "may an agent open
 *     work here at all", and the second question is not the first. A repo can sit at T3 and still be
 *     `assisted-only` — an owner deciding a person drives here — and a gate reading only the tier
 *     would wave an agent straight through that decision. An ABSENT mode refuses nothing: an org
 *     that has recorded no decision is governed by its tier exactly as it was.
 *
 * The tier this receives is the EFFECTIVE one — the recorded `grantedTier` where a decision exists,
 * the derived tier otherwise. `repoGate` resolves that, so the seam this header promised is finally
 * used (UAT `PRIYA-L2-C4`: the claim gate read the DERIVED tier and never consulted the admission
 * table, so an owner who recorded T2 still got a T0 refusal at the only door that acts on it).
 *
 * `local` and `human` are unaffected by tier: self-hosted consent is the operator's own box, and a
 * person claiming their own organization's row does not need the fleet's permission to do it.
 */
export function claimability(f: {
  autonomyTier: AutonomyTierId | null;
  executor: ClaimExecutor;
  /** True when the repo matched a declared no-AI zone's repo globs. */
  sealed?: boolean;
  /** The recorded admission mode, or null/undefined when this org has decided nothing for the repo.
   *  ABSENCE IS NOT A REFUSAL — see the mode rule above. */
  admissionMode?: AdmissionMode | null;
}): ClaimVerdict {
  if (f.executor !== "remote-agent") return { allowed: true, requiresHumanReview: false };
  if (f.sealed) return { allowed: false, reason: "no-ai-zone" };
  if (f.admissionMode && f.admissionMode !== "agents-allowed") return { allowed: false, reason: "admission-blocked" };
  if (f.autonomyTier == null) return { allowed: false, reason: "tier-unknown" };
  if (f.autonomyTier === "T0") return { allowed: false, reason: "tier-blocked" };
  return { allowed: true, requiresHumanReview: f.autonomyTier !== "T3" };
}

/** The refusal in words the agent can act on. Every input is about the caller's own org. */
export function claimRefusalText(reason: ClaimRefusal, repo: string): string {
  if (reason === "admission-blocked") {
    return `${repo} has a recorded admission decision that does not permit an agent to open work here. The autonomy tier is not the obstacle — an owner decided this repository is worked with a person driving. Moving that is a decision on the Governance tab, not something a claim can route around.`;
  }
  if (reason === "no-ai-zone") {
    return `${repo} is inside a no-AI zone this organization declared. Nothing here may be claimed by an agent — a person has to do this work.`;
  }
  if (reason === "tier-blocked") {
    return `${repo} is at autonomy tier T0: this organization has not cleared it for unattended AI authorship, so its follow-ups cannot be claimed by an agent.`;
  }
  return `${repo} has no assessed autonomy tier, so there is no evidence it can be worked unattended. An unknown tier is refused rather than assumed safe — scan the repository to establish one.`;
}

/** The perimeter a claiming agent is handed with its brief. Every field a STORED value. */
export interface AgentPerimeter {
  repo: string;
  autonomyTier: AutonomyTierId | null;
  /** The stance's own review text for this tier, verbatim. Null when the org wrote none. */
  reviewText: string | null;
  requiresHumanReview: boolean;
  /** ISO — when the claim lapses and the rows return to the queue. */
  leaseUntil: string;
  stance: AiStance | null;
}
