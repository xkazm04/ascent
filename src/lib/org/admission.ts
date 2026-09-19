// AGENT ADMISSION (moonshot #8) — the PURE compiler that turns a declared org AI stance plus one
// repo's recorded admission decision into machine-checkable controls. No IO, no clock, no random:
// the db layer (`src/lib/db/org-admission.ts`) reads the row, the writers
// (`src/lib/github/admission-write.ts`) propose the artifacts, and this module is the only place
// that decides WHAT is compiled.
//
// Why this exists. `AI_POLICY.md` says, in its own body, that it is not enforced by tooling; the
// stance evaluator (`stance.ts`) reports "declared vs observed" and enforces nothing; the passport's
// autonomy tier is derived and persisted but was never a DECISION anyone made or could override.
// So an org could declare a perimeter and have no per-repo consequence anywhere. This compiles the
// declaration into four artifacts — a CODEOWNERS managed block, a `.ai/manifest.yaml`
// `controls.oversight` block, a branch-ruleset proposal, and a gate-policy fragment — and, just as
// importantly, publishes the list of clauses that stayed DECLARED, with the reason.
//
// TWO RULES RUN THROUGH EVERYTHING HERE, and both are load-bearing:
//
//  1. THE OVERLAY IS TIGHTEN-ONLY. `admissionGateOverlay` emits floors ADDED, never ceilings
//     removed. A T3 repo gains nothing; it is not held to a LOOSER bar than its org's. The gate
//     endpoint is unauthenticated, so the overlay is folded through `tightenGatePolicy` exactly like
//     a query param — the worst an admission row can do is raise a bar.
//  2. A NULL TIER NEVER COMPILES A CONTROL. `derivedTier === null` means the latest scan carried no
//     passport: the tier was not assessed. It does not default to T0 (the strictest), and it does
//     not default to T3 (the loosest). It compiles NOTHING and the row reads "tier not assessed" —
//     G4, no number the data cannot support.

import type { AiStance, AutonomyTierId } from "@/lib/types";
import type { GatePolicy } from "@/lib/scoring/gate";

/**
 * What an admission decision permits. Ordered loosest-last so a reader can see the ladder:
 * `blocked` (no AI authorship at all) → `assisted-only` (a human drives; AI assists) →
 * `agents-allowed` (an autonomous agent may open work here).
 */
export type AdmissionMode = "agents-allowed" | "assisted-only" | "blocked";

export const ADMISSION_MODES: readonly AdmissionMode[] = ["agents-allowed", "assisted-only", "blocked"];
export const AUTONOMY_TIER_IDS: readonly AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

export function isAdmissionMode(v: unknown): v is AdmissionMode {
  return typeof v === "string" && (ADMISSION_MODES as readonly string[]).includes(v);
}

export function isAutonomyTierId(v: unknown): v is AutonomyTierId {
  return typeof v === "string" && (AUTONOMY_TIER_IDS as readonly string[]).includes(v);
}

/**
 * One repo's recorded admission decision. TIMESTAMPS ARE STRINGS — this crosses to the Governance
 * client (`wire-safe-dates`), and `toRow()` in the db module does the `.toISOString()`.
 *
 * Declared HERE rather than in the db module so the compiler stays importable without pulling the
 * Prisma graph in behind it (the same split `ConformanceReportRow` uses: the type lives with the
 * pure logic, the db module re-exports it).
 */
export interface RepoAdmissionRow {
  id: string;
  repoFullName: string;
  /** The OrgAiStance version this decision was made against. */
  stanceVersion: number;
  /** Copied from the passport resolver at seed time. NULL = the latest scan carried no passport. */
  derivedTier: AutonomyTierId | null;
  /** The recorded, OVERRIDABLE decision. Seeded from `derivedTier`; an owner may move it. */
  grantedTier: AutonomyTierId;
  mode: AdmissionMode;
  /** GitHub login. NULL = seeded from the derived tier and never actually decided by a person. */
  decidedBy: string | null;
  decidedAt: string | null;
  rationale: string;
  /** GitHub ruleset id once an apply landed — the reversal handle. */
  rulesetId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Where the effective tier came from — the triple a CI log needs to explain the bar it just hit. */
export type AdmissionTierSource = "granted" | "derived" | "none";

/** Facts about the repo the compiler needs. Every one is honest-null where it can be unknown. */
export interface AdmissionRepoFacts {
  fullName: string;
  /** The passport-derived tier. Null = not assessed; see rule 2 in the header. */
  derivedTier: AutonomyTierId | null;
  /** In-repo paths already covered by a CODEOWNERS rule (scan-parsed). */
  codeownersPaths: string[];
  /** Observed required-approval count from the control ledger. NULL = unobserved, never 0. */
  observedRequiredApprovals: number | null;
  /** Default-branch protection. NULL = governance unreadable — never rendered as a false negative. */
  protectedBranch: boolean | null;
}

/** A branch ruleset, in the shape GitHub's `POST /repos/{o}/{r}/rulesets` accepts. */
export interface RulesetProposal {
  name: string;
  target: "branch";
  enforcement: "active";
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: { type: string; parameters?: Record<string, unknown> }[];
}

/** A stance clause that stayed DECLARED, and the reason it could not be compiled. */
export interface UnenforceableClause {
  clause: string;
  why: string;
}

export interface CompiledControls {
  /** The EFFECTIVE tier: the granted decision when a tier was assessed, else null. */
  tier: AutonomyTierId | null;
  tierSource: AdmissionTierSource;
  mode: AdmissionMode;
  /** The row's stanceVersion is behind the active one — recompiled, but flagged, never re-decided. */
  staleDecision: boolean;
  /** TIGHTEN-ONLY. Folded into the gate through `tightenGatePolicy`, never assigned. */
  gateOverlay: GatePolicy;
  /** The managed CODEOWNERS block for path-scoped no-AI zones, or null when there are none. */
  codeownersBlock: string | null;
  ruleset: RulesetProposal | null;
  manifestOversight: ManifestOversight | null;
  unenforceable: UnenforceableClause[];
}

/** The `controls.oversight` block written into `.ai/manifest.yaml`. OVERSIGHT METADATA, never a
 *  threshold: the manifest declares who reviews AI work here, and the gate reads its bar from the
 *  `GatePolicy` fold. Keeping it metadata is why this needs no spec version bump. */
export interface ManifestOversight {
  tier: AutonomyTierId;
  /** The stance's review sentence for that tier band, when it declared one. */
  review: string;
  /** Provenance requirements the stance declared, as flat strings the doctor can read back. */
  provenance: string[];
}

// ---------------------------------------------------------------------------
// Tier → gate overlay
// ---------------------------------------------------------------------------

/**
 * The tier→policy table. EVERY value is a floor ADDED; nothing here can remove a bar an earlier
 * layer set, because the result is folded with `tightenGatePolicy` and that merge is strictest-wins
 * per field.
 *
 * The ladder reads: a T0 repo (least autonomy earned) is held to the most oversight, and the bar
 * relaxes as the repo earns autonomy — which is the inversion people expect and get backwards. T3
 * and an UNASSESSED tier both compile `{}`: the first because the repo earned its autonomy, the
 * second because we do not know, and an unknown must not silently become the strictest bar (it would
 * make every unscanned repo unmergeable) nor the loosest (it would make "not assessed" a way to
 * escape the org's bar — but note it cannot be, since the ORG layer is folded in first and the
 * overlay only ever tightens it).
 */
export function admissionGateOverlay(mode: AdmissionMode, tier: AutonomyTierId | null): GatePolicy {
  const pol: GatePolicy = {};
  switch (tier) {
    case "T0":
      pol.requireProtectedBranch = true;
      pol.minAiGovernedRate = 100;
      pol.forbidPostures = ["ungoverned"];
      break;
    case "T1":
      pol.requireProtectedBranch = true;
      pol.minAiGovernedRate = 100;
      break;
    case "T2":
      pol.minAiGovernedRate = 90;
      break;
    // T3 and null add nothing. See the doc comment.
    default:
      break;
  }
  // `blocked` is a decision about the repo, not about the tier, so it applies at every tier —
  // including an unassessed one, which is the one case where a mode DOES compile without a tier.
  // That is deliberate: "no AI may land here" is a statement an owner made, not a measurement.
  if (mode === "blocked") pol.forbidAiAuthorship = true;
  return pol;
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

const CODEOWNERS_BEGIN = (v: number) => `# BEGIN ascent:ai-stance v${v}`;
const CODEOWNERS_END = (v: number) => `# END ascent:ai-stance v${v}`;

/** The managed-block markers for a stance version — the ONLY region the CODEOWNERS writer touches. */
export function codeownersMarkers(stanceVersion: number): { begin: string; end: string } {
  return { begin: CODEOWNERS_BEGIN(stanceVersion), end: CODEOWNERS_END(stanceVersion) };
}

/**
 * Render the managed CODEOWNERS block for a stance's path-scoped no-AI zones. Byte-stable for a
 * given (stance, version): the block is spliced into a customer's file on every proposal, and a
 * renderer whose output wobbled would open a PR with an empty diff every time.
 *
 * Returns null when there is nothing to seal — a repo with no path zones must not receive an empty
 * managed block, which would be a diff that says nothing and still asks for a review.
 */
export function renderCodeownersBlock(stance: AiStance, stanceVersion: number, owners: string[]): string | null {
  const paths = [...new Set(stance.noAiZones.flatMap((z) => z.pathGlobs))].sort();
  if (paths.length === 0 || owners.length === 0) return null;
  const { begin, end } = codeownersMarkers(stanceVersion);
  const ownerList = owners.join(" ");
  const lines = [
    begin,
    "# Generated by Ascent from this organization's declared AI stance. Everything between these",
    "# markers is managed; edit the stance, not this block. Nothing outside the markers is touched.",
    "#",
    "# These paths are declared no-AI zones. CODEOWNERS cannot see WHO wrote a change, so this does",
    "# not detect AI authorship — it guarantees a named human reviews any change to these paths,",
    "# which is the enforceable half of the declaration.",
    ...paths.map((p) => `${p} ${ownerList}`),
    end,
  ];
  return lines.join("\n");
}

/** The ruleset proposal for a tier: required approvals + code-owner review on the default branch. */
export function renderRulesetProposal(fullName: string, tier: AutonomyTierId | null, mode: AdmissionMode): RulesetProposal | null {
  // Rule 2: an unassessed tier compiles nothing — UNLESS the owner blocked the repo outright, which
  // is a decision and not a measurement.
  const approvals = tier === "T0" ? 2 : tier === "T1" || mode === "blocked" ? 1 : 0;
  if (approvals === 0) return null;
  return {
    name: `ascent:ai-oversight (${fullName})`,
    target: "branch",
    enforcement: "active",
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          required_approving_review_count: approvals,
          require_code_owner_review: true,
          dismiss_stale_reviews_on_push: true,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
    ],
  };
}

/**
 * THE CLAUSES A STANCE CANNOT COMPILE, and why — the honest half of the policy.
 *
 * Extracted from `compileStance` (which now calls it, so there is exactly ONE derivation) because the
 * list had exactly two readers, both of them MCP tools: the agent was told which clauses only it can
 * honour, and the owner who publishes the stance was not. The Perimeter reads the same function at
 * ORG scope, and a clause therefore cannot say one thing to an agent and another to a person.
 *
 * TWO SCOPES, ONE FUNCTION. `facts: null` is the org-wide reading — the clauses that are true of the
 * DECLARATION itself, whichever repository it is applied to. A repo's facts add the two clauses that
 * are only answerable per repository (unreadable branch governance, unobserved approval counts), and
 * sharpen the path-zone clause from "advisory until compiled" to the paths actually uncovered.
 *
 * The org scope deliberately emits NOTHING it cannot know. It never claims a repo's branch protection
 * is unreadable — it has read no repo — because a false "we cannot enforce this" is the same kind of
 * lie as a false "we do".
 */
export function unenforceableClauses(
  stance: AiStance,
  facts: AdmissionRepoFacts | null,
  opts: { owners?: string[] } = {},
): UnenforceableClause[] {
  const unenforceable: UnenforceableClause[] = [];

  // permittedModels: NOT buildable, and the gap line stays in the docs rather than being deleted.
  // `AiUsage` keys by (source, scope, scopeKey, day) and retains no model dimension, so nothing in
  // the product observes which model wrote a change. A compiled control here would be a bar that can
  // never fire, which reads to an auditor as "no violations".
  if (stance.permittedModels.length > 0) {
    unenforceable.push({
      clause: `permittedModels (${stance.permittedModels.length} declared)`,
      why: "No ingest retains a model dimension — AiUsage keys by (source, scope, scopeKey, day) — so a model allowlist cannot be observed, only declared. Enforcing it waits for a sensor that sees models.",
    });
  }
  // permittedTools IS checked, but only as observed-vs-declared attribution in the stance evaluator;
  // no control can stop an undeclared tool from being used, so say which half is which.
  if (stance.permittedTools.length > 0) {
    unenforceable.push({
      clause: `permittedTools (${stance.permittedTools.length} declared)`,
      why: "Observed after the fact from PR attribution (a stance finding), never prevented at commit time. Nothing in a repository can refuse a tool.",
    });
  }
  const pathZones = stance.noAiZones.filter((z) => z.pathGlobs.length > 0);
  if (pathZones.length > 0) {
    if (facts) {
      const uncovered = pathZones
        .flatMap((z) => z.pathGlobs)
        .filter((p) => !facts.codeownersPaths.includes(p));
      if (uncovered.length > 0 && opts.owners?.length === 0) {
        unenforceable.push({
          clause: `no-AI path zones (${uncovered.length} path${uncovered.length === 1 ? "" : "s"} uncovered)`,
          why: "A CODEOWNERS block needs an owner to name. The stance declares no reviewing team for these paths, so no block can be rendered — the clause stays advisory.",
        });
      }
    } else {
      const declared = pathZones.flatMap((z) => z.pathGlobs).length;
      unenforceable.push({
        clause: `no-AI path zones (${declared} path glob${declared === 1 ? "" : "s"} declared)`,
        why: "Path scope is advisory until it is compiled per repository: a managed CODEOWNERS block can only be rendered where the stance names a reviewing team for the paths, and coverage is resolved against that repository's own CODEOWNERS.",
      });
    }
  }
  if (!facts) return unenforceable;

  if (facts.protectedBranch === null) {
    unenforceable.push({
      clause: "branch protection",
      why: "Default-branch governance was unreadable for this repository (no token, or the installation lacks the scope), so protection is unobserved — never reported as absent.",
    });
  }
  if (facts.observedRequiredApprovals === null && stance.reviewTiers.length > 0) {
    unenforceable.push({
      clause: "per-tier review requirement",
      why: "No required-approval count has been observed for this repository, so the declared review tier cannot be compared against reality. The proposal below states the bar; nothing yet confirms it.",
    });
  }
  return unenforceable;
}

/**
 * Compile one repo's admission decision into its control set.
 *
 * `activeStanceVersion` is passed separately from the row's own `stanceVersion` on purpose: a stance
 * publish must NOT silently re-decide a repo. The row keeps the version it was decided against, is
 * recompiled against the ACTIVE stance (so the controls reflect current policy), and is flagged
 * `staleDecision` so the surface can ask a human to re-affirm rather than pretending they did.
 */
export function compileStance(
  stance: AiStance,
  admission: RepoAdmissionRow,
  facts: AdmissionRepoFacts,
  activeStanceVersion: number,
  opts: { owners?: string[] } = {},
): CompiledControls {
  // The effective tier. A granted tier is only meaningful when a tier was ASSESSED at all: with no
  // passport there is no ladder to be on, and a granted value in the row is then a seed nobody
  // measured. Rule 2 in the header — this is where it is enforced, once, for every output below.
  const assessed = facts.derivedTier !== null;
  const tier = assessed ? admission.grantedTier : null;
  const tierSource: AdmissionTierSource = !assessed
    ? "none"
    : admission.decidedBy
      ? "granted"
      : "derived";

  const unenforceable = unenforceableClauses(stance, facts, opts);

  const reviewFor = tier ? (stance.reviewTiers.find((t) => t.tier === tier)?.review ?? "") : "";
  const provenance: string[] = [];
  if (stance.provenance.requireTrailer) provenance.push("attribution-trailer");
  if (stance.provenance.requireHumanApproval) provenance.push("human-approval");

  return {
    tier,
    tierSource,
    mode: admission.mode,
    staleDecision: admission.stanceVersion < activeStanceVersion,
    gateOverlay: admissionGateOverlay(admission.mode, tier),
    codeownersBlock: renderCodeownersBlock(stance, activeStanceVersion, opts.owners ?? []),
    ruleset: renderRulesetProposal(facts.fullName, tier, admission.mode),
    // Oversight metadata is only written when a tier was actually assessed: a manifest block saying
    // `tier: T0` for a repo nobody scored would be the product asserting a grade it does not hold.
    manifestOversight: tier ? { tier, review: reviewFor, provenance } : null,
    unenforceable,
  };
}
