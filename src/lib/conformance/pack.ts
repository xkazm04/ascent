// The Conformance Pack (W2) — the artifact a SOC 2 Type II auditor actually asks for, assembled
// from evidence rows ascent already stores.
//
// The auditor position circulating since 2026 is devastatingly specific (see
// docs/AI-SDLC-STANDARDS-LANDSCAPE.md §2.1): sufficient evidence for change-management control
// CC8.1 over AI-generated code requires **a population of AI-generated changes over the audit
// period, a sample drawn from that population, and evidence for each sampled item that the control
// operated.** "We do code review" is no longer an accepted control statement, and a percentage is
// not evidence — which is exactly why `AiChange` stores rows rather than rates.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CLAIMS DISCIPLINE — non-negotiable, inherited verbatim from AI-SDLC-STANDARDS-LANDSCAPE.md §5.
// This is an assurance artifact; an over-claim here is not a marketing sin, it is a product-killing
// defect, and the buyer's own auditor is the one who will find it.
//
//   1. Say "EVIDENCE FOR" a control. NEVER "compliance with" a standard. We are not an auditor and
//      certify nothing. Every string in ATTESTATION below is written to that rule.
//   2. Anchor to SOC 2 CC8.1 first and ISO/IEC 42001 Annex A second. NEVER claim EU AI Act
//      conformity — its high-risk obligations were deferred (Annex III 2 Dec 2027, Annex I
//      2 Aug 2028) and Article 50 concerns AI outputs shown to people, not source code an assistant
//      helped write.
//   3. The population is a LOWER BOUND and says so in the pack itself. Rows exist only for PRs
//      inside each repo's scanned window; anything merged before the repo was first scanned has no
//      row. A pack that presented its count as "every AI change in the period" would be false.
//   4. Method and caps are published beside the numbers — the sampling algorithm, the seed, the
//      population cap, and every reason a row could be missing.
//   5. Identities are PSEUDONYMOUS by default. Real logins ship only when the caller explicitly asks
//      AND holds owner role.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
//
// Pure: `buildConformancePack` takes the population and returns the pack. No IO, no clock, no
// randomness beyond the seeded draw — so the whole artifact is reproducible and unit-testable.

import { createHash } from "node:crypto";

import type { AiChangePopulation, AiChangeRecord, AsOfEnvironment, RepoControlEnvironment } from "@/lib/db/ai-changes";
import { AS_OF_CAP, POPULATION_CAP } from "@/lib/db/ai-changes";
// MOONSHOT #1 — the LATEST-SCAN fallback is built with the SAME mapper the ledger's rows come from
// (governanceToSamples), so a fallback environment and a ledger environment are directly comparable
// instead of being two hand-written projections of the same settings that can drift apart.
import { governanceToSamples } from "@/lib/scan-probe-controls";
import { drawSample, sampleSeed, DEFAULT_SAMPLE_SIZE } from "@/lib/conformance/sample";

/** How a sampled item's review control is judged. Deterministic; no model involved. */
export type ControlVerdict =
  /** A human approving review is recorded before merge — the control operated. */
  | "operated"
  /** Merged with no approving review — the finding an auditor is looking for. */
  | "not-operated"
  /** Reviewed but never approved — distinct from "nobody looked", and an auditor will ask which. */
  | "reviewed-not-approved"
  /** Never merged, so the pre-merge control was never due to operate. Not a finding. */
  | "not-applicable";

export interface SampledItem {
  repoFullName: string;
  prNumber: number;
  /** Pseudonym or real login, per the pack's identity mode. */
  author: string;
  authorIsBot: boolean;
  aiSignal: string;
  aiTools: string;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  verdict: ControlVerdict;
  approver: string | null;
  approvedAt: string | null;
  reviewCount: number;
  /** The branch-protection bar in force on this repo, or null when it was never readable. */
  environment: {
    requiredApprovals: number;
    requiresCodeOwnerReview: boolean;
    requiresStatusChecks: boolean;
    protectedBranch: boolean;
  } | null;
  /**
   * MOONSHOT #1 — the control environment AS OF the moment this change merged, and where it came
   * from.
   *
   * `source: "ledger"` is the strong claim: the control ledger held an observation at or before the
   * merge instant, so these are the settings that change actually merged under.
   * `source: "latest-scan"` is the weaker one this pack used to make everywhere without saying so:
   * the ledger did not cover the instant, so the most recent scan's settings are substituted. The
   * label is PER ROW because that is the granularity at which the claim differs — a global footnote
   * would let a reader treat every row as as-of when only some are.
   */
  environmentAsOf: AsOfEnvironment;
  /** MOONSHOT #1 — how the approval evidence reached us, and when it was observed live. */
  evidenceSource: string;
  approvalObservedAt: string | null;
  /** One sentence stating what this row does and does not evidence. */
  note: string;
}

export interface PopulationSummary {
  total: number;
  merged: number;
  /** Merged WITH an approving human review — the control operated. */
  governed: number;
  /** Merged WITHOUT one. The findings. */
  ungoverned: number;
  /** Merged with reviews but no approval — a subset of `ungoverned`, called out separately. */
  reviewedNotApproved: number;
  /** Agent-authored vs human-with-a-tool: very different governance weight, so never merged. */
  agentAuthored: number;
  markedByHuman: number;
  repos: number;
  /** True when the population hit POPULATION_CAP and is therefore truncated. Stated in the pack. */
  truncated: boolean;
}

export interface ConformancePack {
  org: string;
  /** The requested period. */
  period: { from: string; to: string; label: string };
  /** The window the rows actually span — may be narrower than the request. */
  observed: { from: string | null; to: string | null };
  population: PopulationSummary;
  sample: {
    size: number;
    requested: number;
    seed: string;
    algorithm: string;
    /** True when the population was small enough to inspect whole. */
    exhaustive: boolean;
    items: SampledItem[];
  };
  /** Every merged-without-approval row in the FULL population, not just the sample. */
  findings: SampledItem[];
  environments: RepoControlEnvironment[];
  /**
   * MOONSHOT #1 — the pack's own statement of how much of it is as-of-merge evidence.
   *
   * Published as a structure, not only as prose, so the export and the UI print the SAME numbers the
   * limitation sentence does. `mergedRows` is the denominator every claim here is made against — the
   * rule this feature is built on is that a coverage figure is never stated without its N.
   */
  environmentCoverage: {
    mergedRows: number;
    /** Rows whose environment came from the ledger, i.e. genuinely as-of-merge. */
    fromLedger: number;
    /** Rows that fell back to the repository's latest scanned settings. */
    fromLatestScan: number;
    /** How many rows an as-of lookup was even attempted for (the AS_OF_CAP ceiling). */
    attempted: number;
    cap: number;
  };
  provenance: {
    /** Distinct scan engines that produced the underlying data, with counts. */
    engines: { provider: string; model: string; repos: number }[];
    generatedAt: string;
    identityMode: "pseudonymous" | "named";
    populationCap: number;
  };
  /** The claims-disciplined prose that ships with the artifact. */
  attestation: typeof ATTESTATION;
  /** Every reason a row could be absent or a number could be narrower than it looks. */
  limitations: string[];
}

/**
 * The pack's own words about what it is. Written to the claims rules above — read this before
 * changing a single sentence, and never let a marketing pass near it.
 */
export const ATTESTATION = {
  purpose:
    "This pack is EVIDENCE FOR an internal change-management control over AI-assisted code changes. " +
    "It is not a certification, an audit opinion, or a statement of compliance with any standard. " +
    "Ascent is not an auditor and certifies nothing.",
  control:
    "The control evidenced: an AI-attributed change receives an approving human review before it is " +
    "merged. This maps to the change-management criterion a SOC 2 Type II examination tests " +
    "(TSC CC8.1), and may be offered as input to an ISO/IEC 42001 Statement of Applicability. " +
    "Mapping a control is not the same as satisfying it; the examiner decides that.",
  method:
    "The population is every AI-attributed pull request Ascent recorded for this organization in the " +
    "period, identified either by an AI agent authoring the PR or by AI markers in its title, body or " +
    "labels. The sample is drawn by a seeded Fisher-Yates shuffle (mulberry32, seeded with sha256 of " +
    "the published seed string) over the population in stable created-at order, so the same period " +
    "always yields the same sample and any third party can reproduce it.",
  notAiAct:
    "This artifact makes NO claim under the EU AI Act. That regulation governs AI systems placed on " +
    "the market, not the use of AI assistants to author source code, and its high-risk obligations " +
    "were deferred to 2 December 2027 (Annex III) and 2 August 2028 (Annex I).",
} as const;

const PSEUDONYM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — they read as 1/0 in a printed pack

/**
 * Stable pseudonyms WITHIN a pack and unlinkable ACROSS packs: the seed is folded into the hash, so
 * "Author F" is the same person throughout one filed artifact but cannot be correlated with a
 * different period's pack to re-identify someone.
 */
function pseudonymizer(seed: string): (login: string | null) => string {
  const cache = new Map<string, string>();
  return (login) => {
    if (!login) return "(deleted account)";
    const hit = cache.get(login);
    if (hit) return hit;
    const h = createHash("sha256").update(`${seed}:${login}`).digest();
    const a = PSEUDONYM_ALPHABET[h[0]! % PSEUDONYM_ALPHABET.length]!;
    const b = PSEUDONYM_ALPHABET[h[1]! % PSEUDONYM_ALPHABET.length]!;
    const name = `Person ${a}${b}`;
    cache.set(login, name);
    return name;
  };
}

/** The deterministic verdict for one row. No model, no heuristics — four exhaustive cases. */
export function verdictFor(c: AiChangeRecord): ControlVerdict {
  if (c.state !== "MERGED") return "not-applicable";
  if (c.approved) return "operated";
  return c.reviewCount > 0 ? "reviewed-not-approved" : "not-operated";
}

const NOTE: Record<ControlVerdict, string> = {
  operated: "An approving human review is recorded against this merged AI-attributed change.",
  "not-operated":
    "This AI-attributed change merged with NO review recorded. Evidence that the control did not operate on this item.",
  "reviewed-not-approved":
    "This AI-attributed change merged after review activity but with no APPROVING review recorded: reviewed is not approved.",
  "not-applicable":
    "This change did not merge in the period, so the pre-merge review control was never due to operate on it.",
};

/**
 * The latest-scan fallback, expressed in the ledger's own vocabulary.
 *
 * Built from `governanceToSamples` — the same mapper that produced every scan- and probe-sourced
 * ledger row — so `environmentAsOf.controls` carries identical keys and states whichever branch a
 * row took. A reader comparing two rows in the pack is then comparing like with like; two separate
 * hand-written projections of the same settings would drift the moment either side changed.
 *
 * An unreadable/absent governance blob yields the full control set as `unmeasurable`, never as
 * `fail` — the same contract everywhere else in this feature.
 */
function fallbackEnvironment(env: RepoControlEnvironment | undefined): AsOfEnvironment {
  const controls: Record<string, { state: string; value: string | null }> = {};
  for (const s of governanceToSamples(env?.governance ?? null)) controls[s.controlId] = { state: s.state, value: s.value };
  return { source: "latest-scan", observedAt: null, controls };
}

function toItem(
  c: AiChangeRecord,
  envByRepo: Map<string, RepoControlEnvironment>,
  name: (login: string | null) => string,
  asOfByPr: Record<string, AsOfEnvironment>,
): SampledItem {
  const verdict = verdictFor(c);
  const env = envByRepo.get(c.repoFullName)?.governance ?? null;
  const asOf = asOfByPr[`${c.repoFullName}#${c.prNumber}`] ?? fallbackEnvironment(envByRepo.get(c.repoFullName));
  return {
    repoFullName: c.repoFullName,
    prNumber: c.prNumber,
    author: name(c.authorLogin),
    authorIsBot: c.authorIsBot,
    aiSignal: c.aiSignal,
    aiTools: c.aiTools,
    state: c.state,
    createdAt: c.createdAt,
    mergedAt: c.mergedAt,
    verdict,
    approver: c.approverLogin ? name(c.approverLogin) : null,
    approvedAt: c.approvedAt,
    reviewCount: c.reviewCount,
    environment: env
      ? {
          requiredApprovals: env.requiredApprovals,
          requiresCodeOwnerReview: env.requiresCodeOwnerReview,
          requiresStatusChecks: env.requiresStatusChecks,
          protectedBranch: env.protected,
        }
      : null,
    environmentAsOf: asOf,
    evidenceSource: c.source,
    approvalObservedAt: c.approvalObservedAt,
    note: NOTE[verdict],
  };
}

export interface PackOptions {
  org: string;
  period: { from: string; to: string; label: string };
  sampleSize?: number;
  identityMode?: "pseudonymous" | "named";
  /** Injected so the pack is pure and its tests need no clock. */
  generatedAt: string;
}

/** Assemble the pack. Pure over `pop` + `opts`. */
export function buildConformancePack(pop: AiChangePopulation, opts: PackOptions): ConformancePack {
  const requested = opts.sampleSize ?? DEFAULT_SAMPLE_SIZE;
  const seed = sampleSeed(opts.org, opts.period.from, opts.period.to);
  const identityMode = opts.identityMode ?? "pseudonymous";
  const name = identityMode === "named" ? (l: string | null) => l ?? "(deleted account)" : pseudonymizer(seed);

  const envByRepo = new Map(pop.environments.map((e) => [e.repoFullName, e]));
  const merged = pop.changes.filter((c) => c.state === "MERGED");
  const ungoverned = merged.filter((c) => !c.approved);

  const summary: PopulationSummary = {
    total: pop.changes.length,
    merged: merged.length,
    governed: merged.filter((c) => c.approved).length,
    ungoverned: ungoverned.length,
    reviewedNotApproved: ungoverned.filter((c) => c.reviewCount > 0).length,
    agentAuthored: pop.changes.filter((c) => c.aiSignal === "authored").length,
    markedByHuman: pop.changes.filter((c) => c.aiSignal !== "authored").length,
    repos: new Set(pop.changes.map((c) => c.repoFullName)).size,
    truncated: pop.changes.length >= POPULATION_CAP,
  };

  const drawn = drawSample(pop.changes, requested, seed);

  // Engine provenance, deduped across the repos that contributed rows — an auditor asks which
  // system produced the evidence, and "some of these were scored by a deterministic mock" is a
  // material answer, not a footnote.
  const engineMap = new Map<string, { provider: string; model: string; repos: number }>();
  for (const e of pop.environments) {
    if (!e.engineProvider) continue;
    const key = `${e.engineProvider}::${e.engineModel ?? ""}`;
    const hit = engineMap.get(key);
    if (hit) hit.repos += 1;
    else engineMap.set(key, { provider: e.engineProvider, model: e.engineModel ?? "", repos: 1 });
  }

  const limitations: string[] = [
    "The population is a LOWER BOUND. Ascent records an AI-attributed change only when it falls inside " +
      "a repository's scanned pull-request window, so changes that merged before a repository was first " +
      "scanned, or outside the window a scan paged, have no row here and are not counted.",
    "AI attribution is derived from the pull request itself: an AI agent as author, or AI markers in " +
      "the title, body or labels. A change made with AI assistance and left unmarked is not detected, so " +
      "the true population is at least this large and may be larger.",
    "Review evidence is what the GitHub API reported at scan time. A review recorded after the most " +
      "recent scan of a repository is not reflected until that repository is re-scanned.",
  ];

  // MOONSHOT #1 — the as-of-merge disclosure. The line this REPLACES was an omission rather than a
  // statement: the pack described `environment` as the repository's control settings without saying
  // they were read at the LATEST SCAN, which for a change that merged three months earlier is a
  // different repository than the one being evidenced. Now every row carries its own source label and
  // the pack counts them.
  const ledgerRows = Object.keys(pop.asOfByPr).length;
  const fallbackRows = summary.merged - ledgerRows;
  limitations.push(
    ledgerRows > 0
      ? `Control environment: ${ledgerRows} of ${summary.merged} merged rows carry the settings observed AT OR ` +
          "BEFORE the moment they merged, read from the control-observation ledger and labelled " +
          `environmentAsOf.source = "ledger". The remaining ${Math.max(0, fallbackRows)} carry the ` +
          'repository\'s LATEST scanned settings instead, labelled "latest-scan" — the ledger held no ' +
          "observation at or before those merge instants (typically because the change predates the " +
          "ledger for that repository). The two are not equivalent evidence and the label is per row."
      : "Control environment: NO row in this pack carries an as-of-merge control observation. Every " +
          'environment shown is the repository\'s LATEST scanned settings ("latest-scan"), which may ' +
          "differ from the settings in force when a change merged. The control-observation ledger has " +
          "no coverage for this organization and period.",
  );
  if (summary.merged > AS_OF_CAP) {
    limitations.push(
      `As-of-merge resolution stops after ${AS_OF_CAP} merged rows (${pop.asOfAttempted} attempted of ` +
        `${summary.merged}). Rows beyond that ceiling fall back to latest-scan settings for reasons of ` +
        "export size, not of evidence — narrow the period to obtain as-of evidence for all of it.",
    );
  }
  if (summary.truncated) {
    limitations.push(
      `The population hit the ${POPULATION_CAP}-row export ceiling and is TRUNCATED. Narrow the period to ` +
        "obtain a complete population for the range you intend to file.",
    );
  }
  if (identityMode === "pseudonymous") {
    limitations.push(
      "Identities are pseudonymous. Pseudonyms are stable within this pack and are not correlatable " +
        "with any other pack. Request named evidence to obtain the real logins for re-verification.",
    );
  }
  const mockRepos = [...engineMap.values()].filter((e) => e.provider === "mock").reduce((n, e) => n + e.repos, 0);
  if (mockRepos > 0) {
    limitations.push(
      `${mockRepos} of ${pop.environments.length} repositories were last scored by the deterministic mock ` +
        "engine rather than a live model. The review evidence in this pack is read from the GitHub API and " +
        "is unaffected, but any maturity figure derived from those repositories is not a model grade.",
    );
  }

  return {
    org: opts.org,
    period: opts.period,
    observed: { from: pop.observedFrom, to: pop.observedTo },
    population: summary,
    sample: {
      size: drawn.length,
      requested,
      seed,
      algorithm: "seeded Fisher-Yates (mulberry32, sha256(seed) → uint32) over created-at ascending order",
      exhaustive: pop.changes.length <= requested,
      items: drawn.map((c) => toItem(c, envByRepo, name, pop.asOfByPr)),
    },
    // The findings are drawn from the FULL population, never only the sample: a sample bounds the
    // work an auditor does, it must not bound what the vendor discloses.
    findings: ungoverned.map((c) => toItem(c, envByRepo, name, pop.asOfByPr)),
    environments: pop.environments,
    environmentCoverage: {
      mergedRows: summary.merged,
      fromLedger: ledgerRows,
      fromLatestScan: Math.max(0, fallbackRows),
      attempted: pop.asOfAttempted,
      cap: AS_OF_CAP,
    },
    provenance: {
      engines: [...engineMap.values()].sort((a, b) => b.repos - a.repos),
      generatedAt: opts.generatedAt,
      identityMode,
      populationCap: POPULATION_CAP,
    },
    attestation: ATTESTATION,
    limitations,
  };
}
