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
  /** Points awarded when the facet is evidenced, by the detector OR by a verified claim. */
  points: number;
  kind: FacetKind;
  /** Shipped to the model verbatim as the facet's definition — written as a shape, never a vendor. */
  doc: string;
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
    doc:
      "evidence the automation actually RAN: a bot or agent review on a merged change, a commit that " +
      "responds to automated findings, an agent-authored fix. Cite a commit subject from the sample " +
      "with path \"commits\".",
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

export const D4_FACET_IDS: readonly string[] = D4_FACETS.map((f) => f.id);
const BY_ID = new Map(D4_FACETS.map((f) => [f.id, f]));

/** Points for a facet id — the detector and the engine both read the table through this. */
export function facetPoints(id: string): number {
  return BY_ID.get(id)?.points ?? 0;
}

export function facetSpec(id: string): FacetSpec | null {
  return BY_ID.get(id) ?? null;
}

/** Which dimensions are scored from claims. A dimension not listed here ignores `claims` entirely. */
export const CLAIM_SCORED_DIMENSIONS: readonly DimensionId[] = ["D4"];

/** Quote bounds. Shorter than MIN is too generic to be evidence of anything; longer than MAX is a
 *  paragraph, and a paragraph is what a model produces when it is paraphrasing rather than quoting. */
export const CLAIM_QUOTE_MIN = 12;
export const CLAIM_QUOTE_MAX = 200;
/** At most this many claims survive coercion — one per facet, with room for the model to repeat. */
export const CLAIM_MAX = 16;

/** The literal path a behavioral claim must carry: it cites the commit sample, not a file. */
export const COMMITS_PATH = "commits";

// ---- the prompt contract (derived) -------------------------------------------------------------

/** The paragraph that teaches the model what it may claim. Built from the table, never hand-written. */
export function facetContract(): string {
  const facets = D4_FACETS.map((f) => `  - ${f.id} (${f.points} pts): ${f.doc}`).join("\n");
  return (
    `CLAIMS — D4 (Agentic Workflows) is scored from VERIFIED CITATIONS. Your D4 "score" field is ` +
    `recorded but does not move the number; only a claim whose quote is found verbatim in the file ` +
    `it names awards points. For each facet the evidence genuinely supports, emit ONE entry in ` +
    `"claims": {"dimension":"D4","facet":"<id>","path":"<a sampled file path exactly as shown>",` +
    `"quote":"<${CLAIM_QUOTE_MIN}-${CLAIM_QUOTE_MAX} chars copied EXACTLY from that file>","note":"<one sentence: what this shows>"}.\n` +
    `Facets:\n${facets}\n` +
    `Rules: judge the PRACTICE, not the vendor — a bespoke CI step calling any model is an automated ` +
    `review; a hosted app is one instance of the same facet. Cite configuration or code for ` +
    `operational facets, never README or docs prose, and never a file that merely mentions a tool. ` +
    `A configuration file that is empty or contains no trigger, invocation or gate is not evidence ` +
    `of operation. For "${"observed"}" the path is "${COMMITS_PATH}" and the quote is a commit subject ` +
    `from the sample. One claim per facet. A facet you cannot quote is not a claim: a paraphrased or ` +
    `invented quote is dropped and counted against the assessment's reliability.`
  );
}

// ---- the verifier (deterministic) --------------------------------------------------------------

export interface Claim {
  dimension: DimensionId;
  facet: string;
  path: string;
  quote: string;
  note?: string;
}

export type ClaimRejection =
  | "not-this-dimension"
  | "unknown-facet"
  | "duplicate-facet"
  | "quote-too-short"
  | "path-not-sampled"
  | "prose-evidence"
  | "quote-not-found";

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
export function verifyClaims(claims: readonly Claim[], snap: RepoSnapshot, dimension: DimensionId): ClaimVerification {
  const verified: VerifiedClaim[] = [];
  const rejected: RejectedClaim[] = [];
  const seen = new Set<string>();
  const byPath = new Map(snap.files.map((f) => [f.path.toLowerCase(), f.content]));
  const commitText = snap.commits.map((c) => norm(c.message)).join("\n");

  for (const raw of claims) {
    // The provider coercion guarantees strings, but this verifier is pure and its contract is "never
    // throws" on its own: a null entry or a non-string field is skipped, not dereferenced.
    if (!raw || typeof raw !== "object") continue;
    const claim: Claim = {
      dimension: raw.dimension,
      facet: typeof raw.facet === "string" ? raw.facet : "",
      path: typeof raw.path === "string" ? raw.path : "",
      quote: typeof raw.quote === "string" ? raw.quote : "",
      ...(typeof raw.note === "string" ? { note: raw.note } : {}),
    };
    const reject = (reason: ClaimRejection) => rejected.push({ ...claim, reason });
    if (claim.dimension !== dimension) {
      reject("not-this-dimension");
      continue;
    }
    const spec = BY_ID.get(claim.facet);
    if (!spec) {
      reject("unknown-facet");
      continue;
    }
    if (seen.has(spec.id)) {
      reject("duplicate-facet");
      continue;
    }
    const quote = norm(claim.quote);
    if (quote.length < CLAIM_QUOTE_MIN) {
      reject("quote-too-short");
      continue;
    }

    if (spec.kind === "behavioral") {
      // A trail is cited from history, never from a file: a file can only say something ran.
      if (norm(claim.path) !== COMMITS_PATH || !commitText.includes(quote)) {
        reject(norm(claim.path) === COMMITS_PATH ? "quote-not-found" : "path-not-sampled");
        continue;
      }
    } else {
      const path = claim.path.trim();
      const content = byPath.get(path.toLowerCase());
      if (content == null) {
        reject("path-not-sampled");
        continue;
      }
      if (isProsePath(path, spec.kind)) {
        reject("prose-evidence");
        continue;
      }
      if (!norm(content).includes(quote)) {
        reject("quote-not-found");
        continue;
      }
    }
    seen.add(spec.id);
    verified.push({ ...claim, points: spec.points });
  }
  return { verified, rejected };
}
