// CITED-CLAIM SCORING — how a dimension can be scored from what the model RECOGNISES rather than from
// what a regex can NAME. Introduced for D4 (Agentic Workflows), rubric r9. docs/SCORING-VALIDITY.md.
//
// THE PROBLEM THIS SOLVES. A deterministic detector is a list of names — vendor configs, action ids,
// API-key variables. That makes it a snapshot of the tools known when it was written, which is the
// opposite of universal: a team that built its own review step (a versioned prompt, a call to any
// model, a posted review) matched nothing and scored zero, while a vendor config matched 35. The one
// component able to recognise "this bespoke workflow is functionally an automated review" — the
// model — was clamped to ±4 points of that regex by the guardband. The audit tightened the band for a
// good reason (the model's NUMBER drifts); this module keeps that and changes what the number is fed.
//
// THE MECHANISM. The rubric decomposes the practice into FACETS — shapes any tool can satisfy. The
// model asserts a facet and CITES it: a sampled file path and a verbatim quote. A deterministic
// verifier checks the citation exists and says what the model says it says. Only a VERIFIED claim
// awards the facet's points. So the model's judgment moves the number again — through evidence it
// can point at, never through appetite. Drift is bounded by what is actually in the repository.
//
// ONE AUTHORITY. `D4_FACETS` is the only place a facet is named. The rubric text the model reads
// (`facetContract`), the JSON schema's enum, the runtime coercion, the detector's point values and
// the engine's verifier all derive from it. The action-catalog lesson applies here verbatim: a
// vocabulary written down in five places drifts in five directions, and the model gets blamed for
// citing a facet it was taught. Add a facet HERE and every derivation follows.
//
// WHAT VERIFICATION DOES AND DOES NOT PROVE. A verified quote proves the evidence EXISTS in the file
// named. It does not prove the model's interpretation of it — a model can cite a real line and be
// wrong about what it means. That residual is narrower than fabrication, and it is auditable: the
// quote is rendered in the evidence list, so a reader can see exactly what the score rests on. The
// rules below narrow it further (operational facets may not be cited from prose; "observed" may only
// be cited from commit history), and the model is told a bare config or an empty file is not
// evidence of operation. Pure and dependency-free so all of it is unit-testable without a model.

import type { DimensionId, RepoSnapshot } from "@/lib/types";

/** How a facet may be evidenced — decides which citations the verifier will accept. */
export type FacetKind =
  /** A thing that RUNS: cite configuration or code, never prose. */
  | "operational"
  /** The team's own judgment written down: may cite a prompt/rubric file (often markdown). */
  | "judgment"
  /** A trail that it RAN: cite a commit subject from the sample, never a file. */
  | "behavioral";

export interface FacetSpec {
  id: string;
  /** Points awarded when the facet is evidenced, by the detector OR by a verified claim.
   *  ZERO is a legitimate value: a facet can be evidence worth RENDERING and worth nothing to the
   *  score (D1's `contradiction`). See the note on D1_FACETS. */
  points: number;
  kind: FacetKind;
  /** Shipped to the model verbatim as the facet's definition — written as a shape, never a vendor. */
  doc: string;
  /** How many citations the facet needs. A claim ABOUT two files ("these two agree", "these two
   *  contradict") is unverifiable from one of them, so `2` requires `path2`/`quote2` and verifies
   *  BOTH before the facet counts. Default 1. */
  citations?: 1 | 2;
  /** How many claims of this facet survive the seen-set. Default 1 — one claim per facet, the r9
   *  rule. A facet that ENUMERATES (each contradiction is a different pair of files) sets this
   *  higher; the surplus is still rejected as `duplicate-facet` so the bound is visible. */
  multi?: number;
  /** A CLAIMED facet that only makes sense as evidence OF another: awarded only when at least one of
   *  these is already evidenced (by the detector, the platform folds, or an earlier verified claim).
   *  A trail is a trail of something — without a mechanism it is an interpretation, not an
   *  observation. Measured signals (the pulls fold) are exempt; this binds model claims only. */
  requiresAny?: readonly string[];
}

/**
 * D4 — Agentic Workflows, as SHAPES. Sums to exactly 100: a fully-realised practice is the ceiling.
 *
 * The ordering of points is itself a claim the rubric makes: a review whose judgment is the team's
 * own (custom_judgment) is worth nearly as much as the review existing at all, and MORE than a
 * vendor default gets — because a versioned, iterated prompt is the practice made repeatable, which
 * is what "AI-native" means here. A vendor config alone reaches 25; it cannot reach green without
 * the review having teeth and leaving a trail.
 */
export const D4_FACETS: readonly FacetSpec[] = [
  {
    id: "automated_review",
    points: 25,
    kind: "operational",
    doc:
      "a step that runs automatically on changes (pull request, push, pre-push or pre-commit), reads " +
      "the change, and hands it to a model for review — by ANY means: a hosted app, a CI job calling " +
      "any model API or CLI, a local model, a script. Cite the trigger or the invocation.",
  },
  {
    id: "custom_judgment",
    points: 20,
    kind: "judgment",
    doc:
      "the review's own prompt, rubric or checklist lives in the repository and is versioned — the " +
      "team's judgment made repeatable, not a vendor default. Worth MORE than a vendor default. Cite " +
      "the prompt or rubric file itself.",
  },
  {
    id: "review_teeth",
    points: 15,
    kind: "operational",
    doc:
      "the automated review has consequences: it is a required check, it blocks merge, or its " +
      "findings must be resolved before a change lands. Cite the gating configuration.",
  },
  {
    id: "observed",
    points: 15,
    kind: "behavioral",
    // The first live run awarded this on ONE tagged commit subject in a repo with no review step, no
    // fix step and no dispatch — a trail of nothing. Hence `requiresAny`: a claimed trail counts only
    // once the mechanism it is a trail of is evidenced.
    requiresAny: ["automated_review", "autofix", "agent_dispatch"],
    doc:
      "evidence the automation actually RAN: a bot or agent review on a merged change, a commit that " +
      "responds to automated findings, an agent-authored fix. Cite a commit subject from the sample " +
      "with path \"commits\". Counts only when an automated_review, autofix or agent_dispatch facet is " +
      "also evidenced — a trail must be a trail OF something.",
  },
  {
    id: "autofix",
    points: 10,
    kind: "operational",
    doc:
      "automated correction is applied to changes — formatting, lint fixes or agent-authored fix " +
      "commits — by a bot or a CI step rather than by hand.",
  },
  {
    id: "dependency_automation",
    points: 10,
    kind: "operational",
    doc: "a bot proposes or merges dependency updates: a committed configuration, or its update commits in history.",
  },
  {
    id: "agent_dispatch",
    points: 5,
    kind: "operational",
    doc:
      "work items become changes through automation: an issue, a comment or a manual trigger " +
      "dispatches an agent that opens a change.",
  },
];

/**
 * D1 — AI Tooling & Conventions, under rubric r11. The dimension stopped counting FORMATS and started
 * judging COHERENCE (see analyze/guidance-graph.ts), and these are the shapes the deterministic
 * parser cannot see: an authority declared in words no regex matched, and agreement or disagreement
 * between two documents that only a reader can recognise.
 *
 * Every facet is `judgment` kind, and that is forced rather than chosen: guidance files are markdown,
 * and `isProsePath` rejects EVERY `.md` path for an `operational` facet. A guidance document is not
 * prose about a mechanism — it IS the mechanism an agent executes — so the honest kind is `judgment`,
 * narrowed instead by `allowedPaths` (the engine passes the graph's own node paths), which is a
 * tighter bound than the prose rule ever was: the model may cite a guidance file and nothing else.
 *
 * `contradiction` is worth ZERO on purpose, and it is the reconciliation of the two scout findings
 * this item merged. One wanted contradictions verified by citation; the other insisted they never
 * touch the score ("report as possible, never fail"). Both hold: a verified contradiction is
 * EVIDENCE AT ZERO POINTS — it renders, it persists, it feeds the practice — while only the graph's
 * deterministic penalties move the number. No alert fires and no gate fails on one (G4/G5).
 */
export const D1_FACETS: readonly FacetSpec[] = [
  {
    id: "canonical_declared",
    points: 8,
    kind: "judgment",
    doc:
      "one guidance file names ANOTHER file as the authority for agents — in words, not in a format " +
      "a parser matched (\"the real conventions live in X\", \"read X instead\"). Cite the sentence.",
  },
  {
    id: "projection_declared",
    points: 6,
    kind: "judgment",
    doc:
      "a vendor guidance file states it is GENERATED from another file and should not be hand-edited. " +
      "Cite the statement.",
  },
  {
    id: "commands_agree",
    points: 6,
    kind: "judgment",
    citations: 2,
    doc:
      "two different guidance files state the SAME build/test/lint command — the agent gets one answer " +
      "whichever file it opened. Cite BOTH files (path/quote and path2/quote2).",
  },
  {
    id: "contradiction",
    points: 0,
    kind: "judgment",
    citations: 2,
    multi: 4,
    doc:
      "two guidance files tell agents DIFFERENT things about the same subject — a command, or a rule " +
      "one forbids and the other requires. Cite BOTH files (path/quote and path2/quote2). This scores " +
      "NOTHING: it is recorded as evidence and shown to the maintainer, never as a penalty.",
  },
];

/**
 * THE registry: dimension → its facet table. One authority per dimension, and `facetPoints`/
 * `facetSpec`/`facetContract`/the schema enum/the coercion all derive from it — the action-catalog
 * lesson (a vocabulary written in five places drifts in five directions) applied across dimensions
 * now that there is more than one.
 *
 * D4 keeps `D4_FACETS` verbatim as its entry: r9 semantics are unchanged and the r9 suite is the proof.
 */
export const FACETS_BY_DIMENSION: Partial<Record<DimensionId, readonly FacetSpec[]>> = {
  D1: D1_FACETS,
  D4: D4_FACETS,
};

/** Which dimensions are scored from claims. A dimension not listed here ignores `claims` entirely. */
export const CLAIM_SCORED_DIMENSIONS: readonly DimensionId[] = ["D1", "D4"];

export const D4_FACET_IDS: readonly string[] = D4_FACETS.map((f) => f.id);

/** Every facet id the model may name, across every claim-scored dimension. Ids are globally unique
 *  (asserted below), so the schema enum is one flat list and a claim's dimension still decides which
 *  table verifies it. */
export const ALL_FACET_IDS: readonly string[] = CLAIM_SCORED_DIMENSIONS.flatMap((d) =>
  (FACETS_BY_DIMENSION[d] ?? []).map((f) => f.id),
);

const BY_DIMENSION = new Map<string, Map<string, FacetSpec>>(
  Object.entries(FACETS_BY_DIMENSION).map(([dim, facets]) => [dim, new Map((facets ?? []).map((f) => [f.id, f]))]),
);

/** Every facet spec by id, across dimensions. Safe as a flat map BECAUSE the ids are globally unique
 *  — which `claims.test.ts` asserts, so adding a colliding id fails a test rather than silently
 *  making one dimension's facet answer for another's. */
const BY_ID = new Map<string, FacetSpec>(
  CLAIM_SCORED_DIMENSIONS.flatMap((d) => (FACETS_BY_DIMENSION[d] ?? []).map((f) => [f.id, f] as const)),
);

/**
 * Points for a facet id — the detectors (D1, D4, the platform folds) and the engine all read the
 * table through this.
 *
 * Deliberately NOT dimension-scoped, though the registry is: ids are globally unique, so a dimension
 * argument would carry no information at any call site while forcing three detector call sites in two
 * other modules to be rewritten to pass a constant. Unknown facet is 0, never a throw — a scorer must
 * degrade, not crash.
 */
export function facetPoints(id: string): number {
  return BY_ID.get(id)?.points ?? 0;
}

export function facetSpec(dimension: DimensionId, id: string): FacetSpec | null {
  return BY_DIMENSION.get(dimension)?.get(id) ?? null;
}

/** How many citations a facet needs (1 unless it declares otherwise). */
export function facetCitations(spec: FacetSpec): 1 | 2 {
  return spec.citations ?? 1;
}

/** Quote bounds. Shorter than MIN is too generic to be evidence of anything; longer than MAX is a
 *  paragraph, and a paragraph is what a model produces when it is paraphrasing rather than quoting. */
export const CLAIM_QUOTE_MIN = 12;
export const CLAIM_QUOTE_MAX = 200;
/** At most this many claims survive coercion — one per facet, with room for the model to repeat. */
export const CLAIM_MAX = 16;

/** The literal path a behavioral claim must carry: it cites the commit sample, not a file. */
export const COMMITS_PATH = "commits";

// ---- the prompt contract (derived) -------------------------------------------------------------

const DIMENSION_LABEL: Partial<Record<DimensionId, string>> = {
  D1: "AI Tooling & Conventions",
  D4: "Agentic Workflows",
};

/** Rules that only make sense for one dimension's facet table — kept beside the table they belong to
 *  rather than concatenated into one paragraph the model has to filter. */
const DIMENSION_RULES: Partial<Record<DimensionId, string>> = {
  D4:
    `Rules: judge the PRACTICE, not the vendor — a bespoke CI step calling any model is an automated ` +
    `review; a hosted app is one instance of the same facet. Cite configuration or code for ` +
    `operational facets, never README or docs prose, and never a file that merely mentions a tool. ` +
    `A configuration file that is empty or contains no trigger, invocation or gate is not evidence ` +
    `of operation. For "observed" the path is "${COMMITS_PATH}" and the quote is a commit subject ` +
    `from the sample.`,
  D1:
    `Rules: every citation must be an AGENT GUIDANCE DOCUMENT that was sampled — CLAUDE.md, AGENTS.md, ` +
    `.cursorrules or .cursor/rules/*, .github/copilot-instructions.md, .windsurfrules. A README, a ` +
    `design doc or any other markdown file is NOT guidance and is rejected. Judge whether an agent ` +
    `reading these files gets ONE answer or several: naming an authority and agreeing across files is ` +
    `what scores. Reporting a contradiction is worth zero points and is still worth doing.`,
};

/**
 * The paragraph that teaches the model what it may claim for ONE dimension. Built from that
 * dimension's table, never hand-written — so a facet added to the table is taught, enumerated in the
 * JSON schema and accepted by the verifier in the same edit.
 */
export function facetContract(dimension: DimensionId): string {
  const table = FACETS_BY_DIMENSION[dimension] ?? [];
  const facets = table
    .map((f) => {
      const two = facetCitations(f) === 2 ? " · CITE TWO FILES" : "";
      const many = f.multi && f.multi > 1 ? ` · up to ${f.multi} claims` : "";
      return `  - ${f.id} (${f.points} pts${two}${many}): ${f.doc}`;
    })
    .join("\n");
  return (
    `CLAIMS — ${dimension} (${DIMENSION_LABEL[dimension] ?? dimension}) is scored from VERIFIED ` +
    `CITATIONS. Your ${dimension} "score" field is recorded but does not move the number; only a claim ` +
    `whose quote is found verbatim in the file it names awards points. For each facet the evidence ` +
    `genuinely supports, emit ONE entry in "claims": {"dimension":"${dimension}","facet":"<id>",` +
    `"path":"<a sampled file path exactly as shown>","quote":"<${CLAIM_QUOTE_MIN}-${CLAIM_QUOTE_MAX} ` +
    `chars copied EXACTLY from that file>","note":"<one sentence: what this shows>"}. A facet marked ` +
    `CITE TWO FILES also needs "path2" and "quote2" from a DIFFERENT file; without both it is dropped.\n` +
    `Facets:\n${facets}\n` +
    `${DIMENSION_RULES[dimension] ?? ""} One claim per facet unless the facet says otherwise. A facet ` +
    `you cannot quote is not a claim: a paraphrased or invented quote is dropped and counted against ` +
    `the assessment's reliability.`
  );
}

/** Every claim-scored dimension's contract, in dimension order — what the prompt interpolates. */
export function allFacetContracts(): string {
  return CLAIM_SCORED_DIMENSIONS.map(facetContract).join("\n\n");
}

// ---- the verifier (deterministic) --------------------------------------------------------------

export interface Claim {
  dimension: DimensionId;
  facet: string;
  path: string;
  quote: string;
  /** Second citation for a `citations: 2` facet. */
  path2?: string;
  quote2?: string;
  note?: string;
}

export type ClaimRejection =
  | "not-this-dimension"
  | "unknown-facet"
  | "duplicate-facet"
  | "quote-too-short"
  | "path-not-sampled"
  | "prose-evidence"
  | "quote-not-found"
  /** The quote is real, but the facet needs a mechanism (`requiresAny`) that nothing evidenced. */
  | "unsupported-trail"
  /** The path is real and sampled, but it is not one of the repo's guidance documents (D1). */
  | "not-guidance-file"
  /** A two-citation facet arrived with one citation, or with both citations naming the same file —
   *  a claim that two documents agree (or disagree) is not evidenced by quoting one of them twice. */
  | "missing-second-citation";

// ---- composition (the engine's rule, pure) -----------------------------------------------------

export interface ClaimApplication {
  /** Verified claims on facets NOT already evidenced — these award points. */
  awarded: VerifiedClaim[];
  /** Verified claims on facets the detector already found — rendered, never re-scored. */
  confirmed: VerifiedClaim[];
  /** Verified quotes whose facet's `requiresAny` was not met — rendered with the reason, not scored. */
  unsupported: RejectedClaim[];
  /** Points to add to the detector's signal score. */
  points: number;
}

/**
 * Apply verified claims on top of what the detector evidenced. Facet-table order, so a claim for a
 * mechanism (automated_review) is settled before the trail that depends on it (observed) — the
 * order of the table is the dependency order, by construction.
 */
export function applyVerifiedClaims(
  verified: readonly VerifiedClaim[],
  detectedFacets: readonly string[],
  dimension: DimensionId,
): ClaimApplication {
  const have = new Set(detectedFacets);
  const out: ClaimApplication = { awarded: [], confirmed: [], unsupported: [], points: 0 };
  for (const spec of FACETS_BY_DIMENSION[dimension] ?? []) {
    // A `multi` facet enumerates (four different contradicting pairs are four findings, not one
    // repeated claim), so take every verified claim on it rather than the first.
    const claims = verified.filter((v) => v.facet === spec.id);
    if (claims.length === 0) continue;
    if (have.has(spec.id)) {
      out.confirmed.push(...claims);
      continue;
    }
    if (spec.requiresAny && !spec.requiresAny.some((id) => have.has(id))) {
      for (const v of claims) out.unsupported.push({ ...v, reason: "unsupported-trail" });
      continue;
    }
    have.add(spec.id);
    out.awarded.push(...claims);
    // Points come from the SPEC once, not per claim: four verified contradictions are four pieces of
    // evidence and one facet. (`contradiction` is 0 anyway; this keeps the rule true for any future
    // multi facet that is worth points.)
    out.points += spec.points;
  }
  return out;
}

export interface VerifiedClaim extends Claim {
  points: number;
}

export interface RejectedClaim extends Claim {
  reason: ClaimRejection;
}

export interface ClaimVerification {
  verified: VerifiedClaim[];
  rejected: RejectedClaim[];
}

/** Whitespace-insensitive, case-insensitive containment — a quote is evidence of content, and a
 *  CRLF or a re-indented line is transport, not content. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Prose surfaces: an operational facet may not be evidenced by something that merely SAYS a review
 *  exists. Judgment facets may cite markdown (a review rubric is often one) but never the project's
 *  own front matter, which describes rather than defines. */
const PROSE_EXT = /\.(md|mdx|markdown|rst|txt|adoc)$/i;
const FRONT_MATTER = /(^|\/)(readme|changelog|contributing|code_of_conduct|license)[^/]*$/i;

function isProsePath(path: string, kind: FacetKind): boolean {
  if (kind === "judgment") return FRONT_MATTER.test(path);
  return PROSE_EXT.test(path) || FRONT_MATTER.test(path) || /(^|\/)docs?\//i.test(path);
}

/**
 * Verify the model's claims for one dimension against the snapshot. Pure. Never throws — a malformed
 * claim is a rejection with a reason, because the reason is what a reader (and the retro) needs.
 *
 * The verifier checks EXISTENCE, not interpretation: the path was sampled and the quote is in it.
 * See the header for what that does and does not prove.
 */
export interface VerifyClaimsOptions {
  /** When set, EVERY cited path must be a member (case-insensitively) or the claim is rejected
   *  `not-guidance-file`. The engine passes the guidance graph's own node paths for D1, so the model
   *  cannot present a random markdown file as this repo's agent guidance. */
  allowedPaths?: ReadonlySet<string>;
}

export function verifyClaims(
  claims: readonly Claim[],
  snap: RepoSnapshot,
  dimension: DimensionId,
  opts?: VerifyClaimsOptions,
): ClaimVerification {
  const verified: VerifiedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const seenCount = new Map<string, number>();
  const table = BY_DIMENSION.get(dimension) ?? new Map<string, FacetSpec>();
  const byPath = new Map(snap.files.map((f) => [f.path.toLowerCase(), f.content]));
  const commitText = snap.commits.map((c) => norm(c.message)).join("\n");
  const allowed = opts?.allowedPaths ? new Set([...opts.allowedPaths].map((p) => p.toLowerCase())) : null;

  for (const raw of claims) {
    // The provider coercion guarantees strings, but this verifier is pure and its contract is "never
    // throws" on its own: a null entry or a non-string field is skipped, not dereferenced.
    if (!raw || typeof raw !== "object") continue;
    const claim: Claim = {
      dimension: raw.dimension,
      facet: typeof raw.facet === "string" ? raw.facet : "",
      path: typeof raw.path === "string" ? raw.path : "",
      quote: typeof raw.quote === "string" ? raw.quote : "",
      ...(typeof raw.path2 === "string" ? { path2: raw.path2 } : {}),
      ...(typeof raw.quote2 === "string" ? { quote2: raw.quote2 } : {}),
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
    const reject = (reason: ClaimRejection) => rejected.push({ ...claim, reason });
    if (claim.dimension !== dimension) {
      reject("not-this-dimension");
      continue;
    }
    const spec = table.get(claim.facet);
    if (!spec) {
      reject("unknown-facet");
      continue;
    }
    if ((seenCount.get(spec.id) ?? 0) >= (spec.multi ?? 1)) {
      reject("duplicate-facet");
      continue;
    }

    /** Verify ONE citation. Returns the rejection reason, or null when it holds. */
    const checkCitation = (rawPath: string, rawQuote: string): ClaimRejection | null => {
      const quote = norm(rawQuote);
      if (quote.length < CLAIM_QUOTE_MIN) return "quote-too-short";
      if (spec.kind === "behavioral") {
        // A trail is cited from history, never from a file: a file can only say something ran.
        if (norm(rawPath) !== COMMITS_PATH) return "path-not-sampled";
        return commitText.includes(quote) ? null : "quote-not-found";
      }
      const path = rawPath.trim();
      const content = byPath.get(path.toLowerCase());
      if (content == null) return "path-not-sampled";
      // The allowlist runs BEFORE the prose rule: "that file is not this repo's agent guidance" is a
      // more useful sentence for a reader than "that file is prose", and it is the tighter bound.
      if (allowed && !allowed.has(path.toLowerCase())) return "not-guidance-file";
      if (isProsePath(path, spec.kind)) return "prose-evidence";
      return norm(content).includes(quote) ? null : "quote-not-found";
    };

    const first = checkCitation(claim.path, claim.quote);
    if (first) {
      reject(first);
      continue;
    }
    if (facetCitations(spec) === 2) {
      // Two citations must name two DIFFERENT files: quoting one document twice cannot evidence a
      // claim whose entire content is a relationship between two documents.
      if (!claim.path2 || !claim.quote2 || claim.path2.trim().toLowerCase() === claim.path.trim().toLowerCase()) {
        reject("missing-second-citation");
        continue;
      }
      const second = checkCitation(claim.path2, claim.quote2);
      if (second) {
        reject(second);
        continue;
      }
    }
    seenCount.set(spec.id, (seenCount.get(spec.id) ?? 0) + 1);
    verified.push({ ...claim, points: spec.points });
  }
  return { verified, rejected };
}
