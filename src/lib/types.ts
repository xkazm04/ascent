// Shared domain types for Ascent — the AI-native maturity index.
// See docs/features/scanning/maturity-model.md for the conceptual model behind these types.

import type { PrRateBook } from "@/lib/analyze/pr-thresholds";

export type LevelId = "L1" | "L2" | "L3" | "L4" | "L5";
export type DimensionId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9";
export type Impact = "high" | "medium" | "low";
export type Effort = "high" | "medium" | "low";
export type ProviderName = "gemini" | "bedrock" | "openai" | "openrouter" | "local" | "mock" | "claude-cli";
/** Token usage reported by an LLM provider for one assess() call — the metered cost basis. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt-cache breakdown, when the provider surfaces it (e.g. Bedrock with a cachePoint — Tiger
   *  P0-1). `inputTokens` is the FRESH (non-cached) input only; cache reads bill at ~10% of the input
   *  rate and cache writes at ~125%, so they're metered separately and folded into the cost basis by
   *  billableInputTokens() (see src/lib/llm/config.ts). Absent for providers without explicit caching. */
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}
export type Axis = "adoption" | "rigor";
/** How the repo is run, which selects a weighting lens. */
export type RepoArchetype = "solo" | "team" | "org";
export type RecStatus = "open" | "in_progress" | "done" | "dismissed";

export const REC_STATUSES: RecStatus[] = ["open", "in_progress", "done", "dismissed"];

/** The full goal status vocabulary. `listGoals` owns the active<->achieved transition (current vs
 *  target); the PATCH route accepts an explicit override but only within this set. There is no
 *  "archived" state — nothing ever sets it, so no surface may filter on it (goals-initiatives #1). */
export type GoalStatus = "active" | "achieved";

export const GOAL_STATUSES: GoalStatus[] = ["active", "achieved"];

/** What a RecommendationEvent records: a status change, a (re)assignment, a due-date change, or a
 *  standalone note (a comment that arrived with a patch that changed no field — notes are never
 *  silently dropped; see roadmap-recommendation-tracking #1). */
export type RecEventKind = "status" | "assignee" | "target_date" | "note";

export const REC_EVENT_KINDS: RecEventKind[] = ["status", "assignee", "target_date", "note"];

/** Max length of a recommendation-patch note. Longer notes are REJECTED with a 400 (never silently
 *  truncated — a lost tail is data loss the caller can't see). */
export const REC_NOTE_MAX_LENGTH = 500;

/** A roadmap recommendation that has been persisted (has an id + trackable status). */
export interface PersistedRecommendation {
  id: string;
  title: string;
  dimension: DimensionId;
  impact: Impact;
  effort: Effort;
  rationale: string;
  /** Invitational questions to explore the gap — inputs, not directives. */
  explore: string[];
  levelUnlock?: string;
  status: RecStatus;
  /** GitHub login accountable for closing this gap (the backlog owner), or null when unassigned. */
  assigneeLogin: string | null;
  /** Due date the gap is paced against, as an ISO date (YYYY-MM-DD), or null when open-ended. */
  targetDate: string | null;
  /** Engine-true ROI: overall-score points gained if this dimension's gap is fully closed
   * (projectedGain over the scan's persisted dims + archetype). Absent for pre-dimension scans.
   * Display-only — never feeds back into scoring. */
  projectedPoints?: number | null;
  /** The maturity level closing this gap crosses into (e.g. "L3"), or null/absent when in band. */
  unlocks?: string | null;
}

/** One entry in a recommendation's activity timeline — who changed what, from → to, when. */
export interface RecEvent {
  id: string;
  /** GitHub login who made the change, or null for a system/anonymous change. */
  actor: string | null;
  kind: RecEventKind;
  /** Prior value (status id, login, or ISO date), or null when first set. */
  from: string | null;
  /** New value, or null when cleared. */
  to: string | null;
  /** Optional free-text note attached to the change. */
  note: string | null;
  /** When the change happened (ISO timestamp). */
  at: string;
}

export interface MaturityLevel {
  id: LevelId;
  name: string;
  /** Inclusive score band [min, max] on a 0..100 scale. */
  band: [number, number];
  tagline: string;
  description: string;
}

export interface DimensionDef {
  id: DimensionId;
  name: string;
  /** Default 0..1 weight (org lens); weights across all dimensions sum to 1. */
  weight: number;
  /** Which axis this dimension rolls up into (Adoption vs Rigor). */
  axis: Axis;
  description: string;
  /** Human-readable criteria used for the rubric and the LLM prompt. */
  criteria: string;
}

// ---------------------------------------------------------------------------
// Repo ingestion
// ---------------------------------------------------------------------------

export interface RepoMeta {
  owner: string;
  name: string;
  url: string;
  description?: string;
  stars: number;
  forks: number;
  openIssues?: number;
  primaryLanguage?: string;
  pushedAt?: string;
  defaultBranch: string;
  headSha?: string;
  sizeKb?: number;
  license?: string;
  topics?: string[];
  isPrivate?: boolean;
}

export interface RepoFile {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface FetchedFile {
  path: string;
  content: string;
  bytes: number;
}

/**
 * Freshness of one detected agent-guidance file (CLAUDE.md / AGENTS.md / …), from a single cheap
 * `GET /repos/{o}/{r}/commits?path=<file>&per_page=1` at ingest time (W4 — Context Health). The
 * lookup works keylessly within rate limits, and it MUST degrade instead of failing the scan
 * (token-honesty doctrine): an entry with only `path` means "freshness unknown", never "never edited".
 */
export interface GuidanceFreshness {
  path: string;
  /** ISO timestamp of the last commit touching this file (committer date). Absent = unknown. */
  lastModifiedAt?: string;
  /** SHA of that last commit — the head the file's guidance was written against. Absent = unknown. */
  lastCommitSha?: string;
}

export interface CommitInfo {
  message: string;
  authorName?: string;
  authorLogin?: string;
  committedAt?: string;
}

/**
 * One AI-attributed pull request, as a durable evidence ROW rather than a contribution to a rate.
 *
 * `PrStats` answers "what share of AI changes were approved"; this answers "which changes, and by
 * whom" — the population an auditor samples. Shapes the AiChange table without importing Prisma, so
 * the analyzer and the persistence layer agree on one definition.
 */
import type { RepoPracticeShape } from "@/lib/analyze/practice-shape";

/** One deployment as the scan observed it (W4). Mirrors src/lib/github/deployments.ts's record. */
export interface DeploymentSnapshot {
  externalId: string;
  environment: string;
  /** Lower-cased — the join key to a merged PR's merge-commit sha. */
  sha: string;
  ref: string | null;
  /** GitHub's latest deployment status; "pending" when none was reported (never assumed success). */
  state: string;
  createdAt: string;
  statusAt: string | null;
}

export interface AiChangeRecord {
  prNumber: number;
  title: string;
  authorLogin: string | null;
  authorIsBot: boolean;
  /** How it was identified: an AI agent opened it, a human marked AI assistance in title/body/labels,
   * or (W2) its merge-commit / PR-commit messages carry an AI attribution trailer. Precedence when
   * several apply: authored > marked > trailer. */
  aiSignal: "authored" | "marked" | "trailer";
  aiTools: string[];
  state: string;
  mergedAt: string | null;
  approved: boolean;
  /** The human who approved it. Null when unapproved, or when the reviewer's account was deleted. */
  approverLogin: string | null;
  approvedAt: string | null;
  reviewCount: number;
  createdAt: string;
  /** PR number of the merged revert that rolled this change back (W5 revert linkage), or null when
   * no revert was matched IN THE SCANNED WINDOW — a lower bound, not proof it was never reverted. */
  revertedByPr: number | null;
  /** When that revert merged (ISO), or null. Separate from `revertedByPr` only in being the revert's
   * own timestamp — the pair is stamped (or absent) together. */
  revertedAt: string | null;
  /** W4 — the PR's merge-commit SHA (lower-cased), or null when unmerged. Already on the wire for the
   * revert linkage; persisted so a GitHub deployment can be attributed to the change it shipped by
   * SHA EQUALITY rather than by "whichever PR merged closest before the deploy". */
  mergeCommitSha: string | null;
}

/** A contributor's recent activity, incl. how much of it is AI-attributed. */
export interface Contributor {
  login: string;
  name?: string;
  commits: number;
  aiCommits: number;
  lastActiveAt?: string;
}

/**
 * A team that owns part of a repo, parsed from its CODEOWNERS file at scan time. The unit behind
 * the org's team-level rollups (Adoption×Rigor, gaps, movers, AI-knowledge per team). `slug` is the
 * normalized `@org/team` code-owner mention (lowercased); individual `@user` owners and email
 * owners are not teams and are excluded.
 */
export interface TeamOwnership {
  slug: string; // normalized "@org/team" (lowercased)
  ownedPaths: number; // number of CODEOWNERS rules that name this team
  isDefaultOwner: boolean; // the team owns the "*" catch-all rule (the repo's primary owner)
}

/** A repo's role in the fleet (Feature 3). MULTI-valued — a fullstack repo is both frontend AND
 *  backend; an app repo with Terraform is also infra. `unknown` is the empty/undetectable fallback. */
export type StackRole = "frontend" | "backend" | "mobile" | "data_ml" | "infra" | "library" | "unknown";

/** Detected tech stack for a repo (Feature 3a) — derived deterministically from the snapshot's
 *  manifests + tree + primary language by extractTechStack(). Persisted per scan and cached on the repo;
 *  surfaced for display (badges) and tech-based grouping. Does NOT feed scoring (Option A, display-only)
 *  so scans stay byte-identical. */
export interface TechStack {
  /** Languages, most-prominent first (e.g. ["TypeScript", "Python"]). */
  languages: string[];
  /** App frameworks / notable tools (e.g. ["React", "Next.js", "FastAPI"]). */
  frameworks: string[];
  /** Roles this repo fills (multi). */
  roles: StackRole[];
  /** Primary backend language for "Backend·<lang>" grouping (e.g. "Node", "Python"); absent if not a
   *  backend repo. */
  backendLanguage?: string;
  /** 0..1 — confidence in the detection, from coverage + how many manifests were found. */
  confidence: number;
}

// ── App Readiness Passport (see APP_READINESS_PASSPORT.md + app-passport.schema.json) ──────────────
// The descriptive, tool-NAMING portfolio scorecard derived from a scan (sibling to the agent-facing
// .ai/manifest). Built by src/lib/analyze/passport.ts — display/persist-only, never scored.
export type AutomationLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type ProductionBand = "prototype" | "internal" | "beta" | "production" | "hardened";
// Non-observable identity fields — a scan can't infer these, so an org owner sets them (P4 overrides).
export type Criticality = "experimental" | "internal" | "business" | "mission-critical";
export type Lifecycle = "prototype" | "alpha" | "beta" | "ga" | "maintenance" | "deprecated";
/** Graded ladder for the agent-facing artifacts that used to be a bare boolean (passport 0.2.0):
 *  none = absent · adhoc = present but unstructured · curated = structured/maintained library ·
 *  governed = curated PLUS observable process (supersede links, a registry, or a CI check). */
export type ArtifactGrade = "none" | "adhoc" | "curated" | "governed";

/** 0.4.0 — how strongly a single passport field is evidenced. Four FIXED rungs (never a free-form
 *  number), because a scale without a stated meaning is decorative and consumers threshold on it
 *  inconsistently:
 *    observed   1.0  the artifact itself was read (file CONTENT fetched, command present)
 *    declared   0.8  a dependency/config declaration names it; nothing shows it running
 *    inferred   0.5  derived from a path/name heuristic over the tree index
 *    unobserved 0    the evidence needed was not in the snapshot — the field reads `unknown`
 *  See UNKNOWN_CAPABILITY and FIELD_EVIDENCE in src/lib/analyze/passport.ts. */
export type EvidenceBasis = "observed" | "declared" | "inferred" | "unobserved";

export interface FieldEvidence {
  /** 0..1 detection strength for THIS field alone (the rung's fixed value, not a judgement call). */
  confidence: number;
  /** Which rung, so a reader sees the REASON the number is what it is, not just the number. */
  basis: EvidenceBasis;
}

/** 0.4.0 — ordinal severity of a passport finding. `critical` is not emitted by the builder: it is
 *  the ESCALATED reading of a `block` finding once an owner marks the repo business/mission-critical
 *  or GA, which is exactly the change of circumstance that must re-open an old decline. */
export type FindingSeverity = "info" | "warn" | "block" | "critical";

/** 0.4.0 — a blocker with a MINTED IDENTITY. `automationReadiness.blockers` / `productionReadiness.
 *  blockers` remain the rendered sentences (unchanged, for 0.3.0-era readers); `findings[]` is the
 *  machine list those sentences are projected from. Everything that must survive a rewording — the
 *  decline join, the fleet rollup bucket — keys on `id`, never on `text`. */
export interface PassportFinding {
  /** Stable minted id: axis-scoped CAUSE code, e.g. "prod.zero-observability". Never the wording. */
  id: string;
  /** The cause code without its axis prefix, e.g. "zero-observability" — the rollup bucket key. */
  code: string;
  /** The rendered sentence AS OF this generation. Payload, never a join key. */
  text: string;
  severity: FindingSeverity;
}

/** An owner's "I've seen this gap and I'm opting out" annotation, projected onto the passport by the
 *  read-time override overlay. Never a scan output — always owner intent. */
export interface DeclinedByChoice {
  /** Dotted passport field path (one of DECLINABLE_PATHS). */
  path: string;
  /** Human label for the declined field. */
  label: string;
  /** Optional owner rationale ("edge service, alerting lives in the platform"). */
  reason?: string;
  /** The blocker line this decline retired, preserved so the choice stays auditable. */
  blocker?: string;
  /** 0.4.0: the minted id of the finding this decline stands against — the join key that survives a
   *  rewording of `blocker`. Absent on declines recorded before 0.4.0. */
  findingId?: string;
  /** 0.4.0: YYYY-MM-DD the choice was made, carried through so the reader can age it. */
  at?: string;
  /** 0.4.0: set when the accepted gap has CHANGED since it was accepted (the finding hardened, its
   *  kind changed, or the decision aged past the re-confirmation window). The blocker then STAYS in
   *  the blocker list — an accepted risk about a different repo is not an accepted risk. */
  needsReconfirm?: boolean;
  /** The sentence telling the owner what changed and why they are being asked again. */
  reconfirmReason?: string;
}

export interface AppPassport {
  passport: "app-passport";
  passportVersion: string;
  generatedAt: string;
  generatedBy: string;
  /** Set by upgradePassport when this object was LIFTED from an older stored shape rather than freshly
   *  assessed — so a reader never mistakes a migrated grade for observed evidence. */
  migratedFrom?: string;
  /** Owner "declined by choice" annotations (read-time overlay from PassportOverrides). */
  declined?: DeclinedByChoice[];
  identity: {
    name: string;
    slug: string;
    purpose: string;
    repo?: string;
    owner?: string;
    version?: string;
    archetype: "solo" | "team" | "org";
    visibility: "public" | "private" | "internal";
    license: string | null;
    /** Owner-set (P4): how much a failure costs, and where it is in its life — frame how to read the
     *  readiness scores. Absent until an owner sets them (a scan can't observe them). */
    criticality?: Criticality;
    lifecycle?: Lifecycle;
  };
  stack: {
    languages: { name: string; primary?: boolean }[];
    runtime?: string;
    frameworks: string[];
    packageManager?: string;
    persistence: { kind: string; engine?: string; orm?: string | null; migrations?: string; required?: boolean }[];
    /** NAMED capability fields. Three-valued since 0.4.0, because `null` used to carry two different
     *  facts and a portfolio query could not tell them apart: a vendor NAME = observed; `null` = the
     *  scan looked and found nothing; UNKNOWN_CAPABILITY ("unknown") = the scan could not look at all
     *  (e.g. package.json was outside the snapshot), which is a scan-coverage problem and must never
     *  be reported as a real gap in the customer's stack. `evidence.fields` carries the rung. */
    monitoring: { errorTracking: string | null; logs: string | null; metrics: string | null; tracing: string | null; uptime: string | null };
    /** Named + three-valued, same rule as `monitoring` above. */
    hosting: string | null;
    integrations: { name: string; kind: string; direction?: string }[];
    secretsFrom?: string;
  };
  automationReadiness: {
    level: AutomationLevel;
    score: number;
    artifacts: {
      agentInstructions: string[];
      contextGraph: "none" | "partial" | "full";
      /** 0.2.0: graded ladder (was boolean in 0.1.0 — see upgradePassport). */
      memory: ArtifactGrade;
      manifest: boolean;
      evals: "none" | "partial" | "full";
      /** 0.2.0: graded ladder (was boolean in 0.1.0 — see upgradePassport). */
      skills: ArtifactGrade;
      /** 0.3.0: a reproducible environment definition is committed (devcontainer / Dockerfile /
       *  nix / .tool-versions). ABSENT (undefined) on passports lifted from pre-0.3.0 scans — the
       *  old scan never looked, so the migration must not fabricate a false. */
      sandbox?: boolean;
      /** 0.3.0: guardrail hooks are configured (.husky / lefthook / .pre-commit-config, or a
       *  `hooks` block in .claude/settings.json). ABSENT (undefined) on pre-0.3.0 lifts. */
      hooks?: boolean;
    };
    selfVerify: { build: boolean; test: boolean; lint: boolean; typecheck: boolean };
    aiInWorkflow: boolean;
    /** Rendered sentences (kept verbatim for pre-0.4.0 readers). Projected from `findings`. */
    blockers: string[];
    /** 0.4.0: the same blockers WITH minted ids. Optional so a stored pre-0.4.0 blob still parses;
     *  upgradePassport back-fills it read-time from `blockers`. */
    findings?: PassportFinding[];
  };
  productionReadiness: {
    band: ProductionBand;
    score: number;
    ci: { level: "none" | "build" | "checks" | "gated" | "delivery" | "progressive"; provider: string | null; gates: string[] };
    tests: { level: "none" | "smoke" | "partial" | "substantial" | "comprehensive"; coveragePct: number | null; frameworks: string[]; criticalPathCovered: boolean };
    security: { level: "none" | "policy" | "scanning" | "gated" | "supply-chain"; tools: string[] };
    observability: { level: "none" | "logs" | "errors" | "metrics" | "tracing" };
    delivery: { migrations: "none" | "scripted" | "versioned"; iac: boolean; rollback: boolean };
    /** Rendered sentences (kept verbatim for pre-0.4.0 readers). Projected from `findings`. */
    blockers: string[];
    /** 0.4.0: the same blockers WITH minted ids — see PassportFinding. */
    findings?: PassportFinding[];
  };
  links: { report?: string; contextMap?: string; manifest?: string };
  /** `confidence` is the WHOLE-ARTIFACT figure (how much of the app could be inspected at all).
   *  0.4.0 adds `fields`: per-field detection strength keyed by dotted passport path, so a vendor
   *  guessed from a dependency list and one read off a fetched command stop looking equally
   *  authoritative. A reader filtering on strength MUST prefer `fields[path]` and fall back to
   *  `confidence` only when the path is absent (pre-0.4.0 rows, or fields the builder does not
   *  rate). Deliberately NOT exhaustive: only the named/heuristic fields are rated, which keeps the
   *  artifact one screen long instead of doubling it. */
  evidence: { confidence: number; source: string; files: string[]; notes?: string[]; fields?: Record<string, FieldEvidence> };
  /** 0.3.0: per-repo autonomy tier — "what can you safely hand an agent in this repo?" Derived
   *  (never authored) by passport-autonomy.ts from the fields above + scan governance. Optional so
   *  a pre-0.3.0 blob parses; upgradePassport fills it read-time. */
  autonomy?: AutonomyBlock;
}

/** Autonomy tier ladder: T0 observe-only → T1 tests/docs/refactors → T2 features with review →
 *  T3 scheduled autonomous. See src/lib/analyze/passport-autonomy.ts for the exact predicates. */
export type AutonomyTierId = "T0" | "T1" | "T2" | "T3";

export interface AutonomyBlock {
  tier: AutonomyTierId;
  /** For every tier above the granted one: the human-readable checklist of what unblocks it.
   *  Each entry's `missing` is cumulative (includes still-unmet lower-tier predicates). */
  unlocks: { tier: AutonomyTierId; missing: string[] }[];
  /** The raw predicate inputs the verdict rests on — so a reader can audit the grant.
   *  `sandbox`/`hooks` are null when the stored scan predates 0.3.0 (unknown, not false). */
  inputs: {
    agentInstructions: boolean;
    selfVerifyTest: boolean;
    testsLevel: string;
    ciLevel: string;
    sandbox: boolean | null;
    hooks: boolean | null;
    aiInWorkflow: boolean;
    evals: string;
    migrations: string;
    /** Branch-protection enforcement was observable (token scan). False caps the grant at T1. */
    enforcementVisible: boolean;
  };
}

// ---------------------------------------------------------------------------
// Org AI stance (W3) — the published "what may AI do here" policy artifact
// ---------------------------------------------------------------------------

/** A declared no-AI zone: repos (matched by fullName glob) and/or paths closed to AI authorship.
 *  Repo globs are CHECKABLE against scan attribution today; path globs are ADVISORY-ONLY (commit
 *  file paths aren't ingested), and every surface must label them so. */
export interface AiStanceZone {
  /** Globs over "owner/name" (e.g. "acme/billing-*"); `*` doesn't cross the "/", `**` does. */
  repoGlobs: string[];
  /** Globs over in-repo paths (e.g. "prisma/migrations/**") — advisory until file paths are ingested. */
  pathGlobs: string[];
  /** Why the zone is sealed — the sentence a dev needs. */
  reason?: string;
}

/** The review requirement the stance attaches to one autonomy tier band (T0..T3). */
export interface AiStanceReviewTier {
  tier: AutonomyTierId;
  /** e.g. "Two approvals, one from the module owner. Agent pre-review required." */
  review: string;
}

/**
 * The org's AI stance — serialized as JSON-in-TEXT on OrgAiStance.stanceJson (no-jsonb DSQL
 * contract) and sanitized at the edge by sanitizeStance (src/lib/org/stance.ts). Compliance against
 * it is always "declared vs OBSERVED attribution" from existing scan data — never "enforced".
 */
export interface AiStance {
  /** Permitted AI tools/agents (display names, e.g. "Claude Code", "Copilot"). */
  permittedTools: string[];
  /** Permitted model families/ids (e.g. "claude-opus", "gpt-5"). */
  permittedModels: string[];
  noAiZones: AiStanceZone[];
  /** Review requirements per autonomy tier band (sparse — an absent tier has no stance text). */
  reviewTiers: AiStanceReviewTier[];
  provenance: {
    /** Every AI-assisted change must carry an attribution trailer (checked via aiTrailerRate). */
    requireTrailer: boolean;
    /** Every AI-attributed PR must have a human approval before merge (checked via AiChange rows). */
    requireHumanApproval: boolean;
  };
}

export interface RepoSnapshot {
  meta: RepoMeta;
  /** Full recursive tree of file/dir paths (may be truncated by GitHub). */
  tree: RepoFile[];
  /** Selected file contents fetched within a byte budget. */
  files: FetchedFile[];
  /** Recent commit metadata (for AI-attribution / cadence signals). */
  commits: CommitInfo[];
  /** GitHub flagged the tree as truncated (very large repo). */
  truncated: boolean;
  /** 0..1 estimate of how much of the repo we could inspect. */
  coverage: number;
}

// ---------------------------------------------------------------------------
// Deterministic signal extraction
// ---------------------------------------------------------------------------

export interface Signal {
  /** Short, human-readable evidence string, e.g. "Found CLAUDE.md". */
  label: string;
  /** Optional extra detail (path, count, etc.). */
  detail?: string;
}

/** Render a signal as `label (detail)` (or just `label` when no detail) — the single source for the
 * shape shared by the report-evidence list (engine) and the LLM signal block (prompt). */
export function formatSignal(x: Signal): string {
  return x.detail ? `${x.label} (${x.detail})` : x.label;
}

export interface DimensionSignals {
  id: DimensionId;
  /** Deterministic rubric score 0..100. */
  signalScore: number;
  signals: Signal[];
  /** Set when the detector THREW and this is a placeholder (signalScore is NOT a real measurement).
   *  The engine excludes a failed dimension from the overall instead of folding a fake 0 that would
   *  deflate the score as if the repo genuinely scored zero on it. */
  failed?: boolean;
  /** When true, the FINAL dimension score IS `signalScore` — the LLM does not move it (no ±guardband
   *  blend). Used by D9, whose score comes from the deterministic security check battery; the LLM's
   *  role there is narrative (summary/gaps), not the number. The LLM's raw score is still recorded on
   *  `llmScore` for transparency. */
  deterministic?: boolean;
  /** Deterministic gaps that OVERRIDE the LLM's gaps for this dimension (D9's check-battery
   *  remediation). When set, the engine uses these as the dimension's `gaps` instead of `llm.gaps`. */
  gaps?: string[];
}

// ---------------------------------------------------------------------------
// LLM scoring contract (structured output)
// ---------------------------------------------------------------------------

export interface LlmDimensionScore {
  id: DimensionId;
  score: number; // 0..100
  summary: string;
  strengths: string[];
  gaps: string[];
}

export interface LlmRoadmapItem {
  title: string;
  dimension: DimensionId;
  impact: Impact;
  effort: Effort;
  rationale: string;
  /** Invitational questions to explore the gap — inputs, not directives. */
  explore?: string[];
  /** e.g. "L3->L4" — the level transition this unlocks. */
  levelUnlock?: string;
}

/** The LLM acting as auditor: a signal it believes the deterministic detector got wrong. */
export interface Discrepancy {
  dimension: DimensionId;
  claim: string;
}

export interface LlmAssessment {
  dimensions: LlmDimensionScore[];
  headline: string;
  strengths: string[];
  risks: string[];
  roadmap: LlmRoadmapItem[];
  discrepancies: Discrepancy[];
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------

export interface DimensionResult {
  id: DimensionId;
  name: string;
  weight: number;
  /** Blended final score 0..100. */
  score: number;
  signalScore: number;
  llmScore: number;
  summary: string;
  evidence: string[];
  strengths: string[];
  gaps: string[];
}

/** Evidence that AI is in the workflow — surfaced as an indicator, separate from the
 * maturity score, so "AI is used here" isn't conflated with "AI-native maturity". */
export interface AiUsage {
  detected: boolean;
  /** Fraction of recent commits with AI co-author/bot attribution (0..1). */
  commitFraction: number;
  signals: string[];
}

/** Pull-request signals (ingested via GraphQL) — measures *how systematic* the engineering
 * process around AI is: review coverage, PR size, velocity, agent authorship, AI involvement.
 * Null when no token is available (GraphQL requires auth). All rates are 0..100. */
export interface PrStats {
  analyzed: number; // PRs summarized in this window
  totalCount: number; // total PRs the repo has ever had
  open: number;
  merged: number;
  closedUnmerged: number;
  mergeRate: number; // merged / (merged + closed-unmerged)
  /** Of human-authored merged PRs, the share with an approving review. Null when NO human-authored
   * PR merged in the window (all-bot fleets): no sample is not "0% reviewed". */
  reviewedRate: number | null;
  avgReviews: number;
  avgComments: number;
  medianHoursToMerge: number | null;
  medianHoursToFirstReview: number | null;
  avgLineChanges: number; // additions + deletions
  avgChangedFiles: number;
  smallPrRate: number; // PRs ≤ 200 line changes (healthy)
  botAuthoredRate: number; // any bot/automation authored
  aiInvolvedRate: number; // AI agent authored OR AI markers in title/body/labels
  /** Of the AI-involved PRs, the share that got an approving review — "is AI work governed?".
   * Null when too few AI PRs to be meaningful (sample < 5). The systematic-AI signal. */
  aiGovernedRate: number | null;
  revertRate: number; // titles starting with "Revert"
  draftRate: number;
  tools: { name: string; count: number }[]; // detected AI-tool taxonomy
  /** Per-channel counts of the AI-involved population (W2), by detection precedence
   * authored > marked > trailer — they sum to the AI-involved PR count exactly. */
  aiAuthoredPrs: number; // an AI agent bot opened the PR
  aiMarkedPrs: number; // AI markers in title / body / labels (and not bot-authored)
  aiTrailerPrs: number; // ONLY the commit-message trailers said so (and no marker/bot author)
  /** Of MERGED PRs, the share whose merge-commit or PR-commit messages carry an AI attribution
   * trailer (W2) — trailer-GROUNDED attribution, independent of the channel precedence above (a
   * marked PR that also carries a trailer counts here). Null under the ≥5 merged-PR sample floor. */
  aiTrailerRate: number | null;
  /** Of MERGED PRs, the share that received an AI/bot review BEFORE the first human review — or
   * with no human review at all (W2). The "AI pre-review" adoption signal. Null under the ≥5
   * merged-PR floor. */
  aiPreReviewedRate: number | null;
  /** Of MERGED PRs, the share later REVERTED by another merged PR in the same window (W5) — matched
   * via `Revert "<original title>"` titles and `This reverts commit <sha>` messages. A LOWER BOUND:
   * a renamed revert, or a revert merged after the window, escapes the matcher. Null under the ≥5
   * merged-PR floor, never a fabricated 0. */
  reworkRate: number | null;
  /** The same reverted-share, over AI-INVOLVED merged PRs only (W5) — "does AI-assisted work get
   * rolled back more?". Same lower-bound semantics; null unless BOTH floors hold (≥5 merged AND
   * ≥5 AI-involved merged PRs). */
  aiReworkRate: number | null;
  /**
   * W4 — the MERGE-SHA INDEX: one entry per MERGED pull request in the scanned window, flagging
   * whether the AI detector matched it. `s` is the lower-cased merge-commit SHA, `a` is 1 for
   * AI-attributed.
   *
   * It exists so a GitHub deployment (which names the sha it shipped) can be attributed to the
   * change it carried by SHA EQUALITY, and — crucially — so the HUMAN-authored bucket can be built
   * at all. `AiChange` stores only AI-attributed PRs by construction (the evidence pack depends on
   * that), so without this index a deployment that failed to match an AI sha was indistinguishable
   * between "a human wrote it" and "we could not attribute it" — which makes an AI-vs-human failure
   * comparison impossible to state honestly.
   *
   * Deliberately terse keys: this rides inside the existing `Scan.prStats` blob rather than taking a
   * new column, so its size is a real cost (~45 bytes per merged PR). Absent on pre-W4 scans, which
   * the outcome model reports as attribution coverage rather than silently narrowing a denominator.
   */
  mergedShas?: { s: string; a: 0 | 1 }[];
  /**
   * The same rates as the scalars above, in the qualified form that carries its own denominator,
   * exclusions, sample floor and (for `aiInvolved`) per-channel precision — see
   * `src/lib/analyze/pr-thresholds.ts`. A reader-facing surface must take its number from here
   * through `rateReading`, never from the bare scalar beside it.
   *
   * It lives ON `PrStats` rather than on an analyzer-only return-type extension because the blob is
   * persisted wholesale: a consumer typed as plain `PrStats` (every DB read — `org-signals.ts`, the
   * rollups, the report page) could not SEE the field otherwise, so the qualified form existed in
   * the database and nowhere in the type system that reads it. Declaring it here is behaviourally
   * identical; what changes is who can reach it.
   *
   * OPTIONAL on purpose: a scan written before the contract genuinely has no rate book, and an
   * absent population must be rendered as unknown, never fabricated into an empty one (`{}` would
   * read as "eight rates, all with a zero denominator", which is a different and false claim).
   */
  rates?: PrRateBook;
}

/** Default-branch governance — from the branch `protected` flag + the (read-only) rulesets API.
 * Measures the guardrails around merging: required reviews, status checks, signatures, history.
 * Null when no token. `readable` distinguishes "no rules" from "couldn't read". */
export interface Governance {
  defaultBranch: string;
  protected: boolean;
  requiresPullRequest: boolean;
  requiredApprovals: number;
  requiresCodeOwnerReview: boolean;
  requiresStatusChecks: boolean;
  requiresSignatures: boolean;
  linearHistory: boolean;
  ruleCount: number;
  readable: boolean;
}

/**
 * GitHub-native security posture — the security a repo runs through GitHub's platform rather than as
 * committed CI-as-code files, which the file-based D9 detector is structurally blind to. Fetched from
 * public endpoints (no admin scope): the repo's own published advisories and the org-level SECURITY.md
 * fallback. Folds into D9 additively (presence lifts; absence is neutral) so a repo like next.js — a
 * mature coordinated-disclosure program with GitHub-managed scanning — isn't scored near zero for
 * lacking a committed CodeQL workflow. Null when scanned without a token.
 */
export interface SecurityPosture {
  /** Count of the repo's OWN published GitHub Security Advisories (GHSA). A positive maturity signal:
   *  it evidences a triage + coordinated-disclosure + patched-release process, NOT raw "insecurity"
   *  (mirrors how OpenSSF Scorecard credits an active vulnerability-handling program). */
  advisoryCount: number;
  /** True when advisoryCount hit the API page cap (so it's a floor, rendered "N+"). */
  advisoryCapped: boolean;
  /** An org-level SECURITY.md (owner/.github fallback) exists. Repo-local SECURITY.md is already scored
   *  from the tree by the D9 file detector; this is the documented reporting path the tree can't see. */
  orgSecurityPolicy: boolean;
}

/**
 * Current supply-chain EXPOSURE — open known vulnerabilities in the repo's dependencies, kept
 * SEPARATE from posture (do you have controls?) because a mature repo can still carry a fresh CVE and
 * vice-versa. Sourced from OSV.dev (public, no auth — parsed from a committed lockfile) or Dependabot
 * alerts when the token allows. `known:false` = we couldn't inspect dependencies (no lockfile / no
 * alert access), which must read as "unknown", never "clean". */
export interface SecurityExposure {
  known: boolean;
  source: "osv" | "dependabot" | "none";
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** How many dependencies we actually checked (0 when unknown). */
  scanned: number;
}

/** One deterministic, Scorecard-style security control check — graded 0..10 by how effectively the
 *  control is in place (not merely present), with the evidence and the fix. Auditable: every check
 *  states what it looked at and what it found. */
export interface SecurityCheck {
  id: string;
  name: string;
  group: "posture" | "exposure";
  /** 0..10, or null when the control is not applicable / couldn't be evaluated (excluded from the mean). */
  score: number | null;
  /** Relative weight within its group (risk-weighted, à la OpenSSF Scorecard). */
  weight: number;
  risk: "critical" | "high" | "medium" | "low";
  evidence: string;
  remediation?: string;
}

/** The deterministic Security (D9) assessment — the auditable check battery + its aggregate scores.
 *  `d9` is the final dimension score; `posture` and `exposure` are the two axes it combines. */
export interface SecurityAssessment {
  d9: number; // 0..100 — the deterministic D9 dimension score
  posture: number; // 0..100 — control coverage (maturity)
  exposure: number | null; // 0..100 — inverse of current known vuln exposure; null when unknown
  checks: SecurityCheck[];
  evidence: string[];
  gaps: string[];
}

/** The two-axis posture (Adoption × Rigor) quadrant. */
export interface Posture {
  id: "ai-native" | "ungoverned" | "manual" | "early";
  label: string;
  blurb: string;
}

/**
 * Which structural score levers fired on this run — the auditable record of the two places where a
 * score can take a STEP change without the repository changing at all.
 *
 * Both triggers are LLM prose: whether the model happened to word a D9 discrepancy so it matched the
 * visibility-blind-spot regex, and whether it happened to emit a `discrepancies` entry for a dimension
 * (which DOUBLES that dimension's guardband, from ±25 to ±50). Neither is a defect — both exist for
 * good reasons documented in scoring/engine.ts — but before this field they were recorded only as a
 * prose `warnings` string, so a consumer holding two scans of the same commit could see the headline
 * move and have no machine-readable way to attribute it. An assurance or benchmarking surface must be
 * able to say "D9 was renormalized out on this run" rather than "the score changed."
 */
export interface ScoreIntegrity {
  /** D9 (Security) was treated as UNMEASURABLE and renormalized out of the overall + rigor axis,
   *  because the model asserted the repo's security runs where a file scan can't see it. At D9's ~9%
   *  weight this alone is a multi-point headline step on an identical commit. */
  d9Unmeasurable: boolean;
  /** Dimensions whose LLM guardband was DOUBLED because the model flagged the detector as suspect.
   *  A dimension listed here could move up to twice as far from its deterministic signal as one that
   *  is not — so a run-over-run delta on these dims carries materially less confidence. */
  widenedDims: DimensionId[];
  /** The model flagged MORE dimensions than the per-scan discrepancy budget allows
   *  (MAX_FLAGGED_DIMENSIONS, scoring/discrepancy-policy.ts), so NO dimension was widened and the D9
   *  visibility hatch was suppressed — the run is pinned to the deterministic signals. Absent on a
   *  normal run; `widenedDims` is empty whenever this is true. */
  widenCapped?: true;
  /** The REALIZED blend weight actually applied (SCORE_BLEND × coverage), not the configured constant.
   *  A truncated or rate-limited ingest lowers this and shifts the score toward the deterministic
   *  signal with zero repo change — the third way an unchanged commit can score differently. */
  effectiveBlend: number;
}

// ---------------------------------------------------------------------------
// Context Health (W4) — quality-over-presence read of the agent-guidance layer
// ---------------------------------------------------------------------------

/** One detected guidance file's persisted context-health facts. */
export interface ContextHealthFile {
  path: string;
  /** ISO timestamp of the file's last commit. Absent = freshness lookup skipped/failed (unknown). */
  lastModifiedAt?: string;
  /** SHA of that last commit. Absent when unknown. */
  lastCommitSha?: string;
  /** File size in bytes, from the already-fetched tree (no extra call). Absent when the tree entry carried none. */
  bytes?: number;
  /** 0..100 — the file's guidance-quality grade (normalized `guidanceQuality` points; 0 when the
   *  file's content wasn't in the ingest sample). */
  sectionsScore: number;
}

/**
 * Context Health — how healthy a repo's agent-context layer (CLAUDE.md / AGENTS.md / rules files)
 * is, beyond mere presence: freshness against the repo's own change rate, guidance quality, and
 * reference drift. DISPLAY/PERSIST-ONLY, like `techStack` and `passport` — it never feeds the scan
 * score or the LLM prompt (no rubric bump; pinned by a test in context-health.test.ts).
 * See src/lib/analyze/context-health.ts.
 */
export interface ContextHealth {
  /** Shape version for read-time tolerance ("1"). */
  version: string;
  /** At least one guidance file was detected in the tree. */
  present: boolean;
  files: ContextHealthFile[];
  /**
   * Staleness of the primary (best) guidance file. `commitsSinceEdit` is APPROXIMATE by design —
   * it is read off the scan's weekly `commitActivity` buckets since `lastModifiedAt`, not a
   * per-commit walk — and it is a LOWER BOUND when the edit predates the ~12-week window
   * (`windowCapped`). All-null (score included) = freshness unknown: the per-file history lookup
   * was skipped or failed, which must never fail the scan.
   */
  freshness: {
    /** 0..100 remaining potency under churn (decayPotency), or null when unknown. */
    score: number | null;
    ageDays: number | null;
    commitsSinceEdit: number | null;
    /** Always true — the staleness count is bucket-derived, never an exact rev-list. */
    approximate: boolean;
    /** The edit predates the commit-activity window, so commitsSinceEdit undercounts. */
    windowCapped?: boolean;
  };
  /** Guidance quality of the primary file — normalized `guidanceQuality` (the D1 grader) output. */
  quality: { score: number; signals: string[] };
  /**
   * Reference drift: `@file`-style path references in the guidance vs the ACTUAL tree index (zero
   * extra fetches). A dead ref is guidance confidently pointing at a file that no longer exists —
   * the most defensible drift signal. score = 100 when every ref resolves (or there are none).
   */
  drift: { score: number; refsTotal: number; deadRefs: string[] };
  /** 0..100 composite (quality/freshness/drift blend; renormalized when freshness is unknown). */
  score: number;
}

export interface ScanReport {
  repo: RepoMeta;
  overallScore: number;
  level: MaturityLevel;
  /** Inferred run-style; selects the weighting lens. */
  archetype: RepoArchetype;
  /** Axis roll-ups (0..100): are they adopting AI, and do they have the rigor for it? */
  adoptionScore: number;
  rigorScore: number;
  posture: Posture;
  aiUsage: AiUsage;
  /** Recent contributors with AI-attribution (from the sampled commit history). */
  contributors: Contributor[];
  /** Teams that own part of this repo, parsed from CODEOWNERS at scan time. Empty when the repo
   *  has no CODEOWNERS file (or it names no `@org/team` owners). Drives the org team rollups.
   *  Undefined only on reconstructed snapshots that never ran ingestion (so persistence leaves any
   *  existing team attribution untouched rather than wiping it). */
  teams?: TeamOwnership[];
  /** Pull-request process signals (GraphQL). Null/absent when no token was available. */
  prStats?: PrStats | null;
  /** The AI-attributed pull requests behind `prStats`' AI rates, as durable evidence rows rather than
   *  percentages — the population an auditor samples from ("show me the AI-assisted changes and who
   *  approved each one"), which a rate structurally cannot answer. Persisted, never scored. Empty on a
   *  tokenless scan, where PRs aren't observable; undefined on reconstructed snapshots that never ran
   *  ingestion, so persistence leaves any stored population untouched rather than wiping it. */
  aiChanges?: AiChangeRecord[];
  /** W6 — the repo's PRACTICE SHAPE: heading outlines + path layouts of its guidance, PR template,
   *  ADRs and harness. Structure only, never a body. Display/reuse-only — never scored, never on a
   *  public surface (see src/lib/analyze/practice-shape.ts). */
  practiceShape?: RepoPracticeShape;
  /** W4 — deployments observed for this repo, with their latest status. Empty on an anonymous scan or
   *  a repo that doesn't use GitHub Deployments; undefined on a reconstructed snapshot, so
   *  persistence leaves stored rows untouched rather than wiping them (same contract as aiChanges). */
  deployments?: DeploymentSnapshot[];
  /** Default-branch governance (branch protection / rulesets). Null when no token. */
  governance?: Governance | null;
  /** Commit volume for the last ~12 weeks (oldest→newest), from /stats/commit_activity. */
  commitActivity?: number[] | null;
  dimensions: DimensionResult[];
  headline: string;
  strengths: string[];
  risks: string[];
  roadmap: LlmRoadmapItem[];
  /** LLM-flagged suspected detector misses (feeds the detector backlog). */
  discrepancies: Discrepancy[];
  /** 0..1 — how much of the repo we could inspect. */
  confidence: number;
  /** Detected tech stack (languages / frameworks / roles), for display + tech grouping (Feature 3a).
   *  Display-only — never feeds scoring. Undefined on reconstructed snapshots that predate extraction. */
  techStack?: TechStack;
  /** App Readiness Passport — the descriptive, tool-naming portfolio scorecard derived from this scan.
   *  Display/persist-only (never scored); undefined on reconstructed snapshots. See lib/analyze/passport. */
  passport?: AppPassport;
  /** Context Health (W4) — guidance-file freshness/quality/drift. Display/persist-only (never scored,
   *  never in the LLM prompt); undefined on reconstructed snapshots that never ran ingestion. */
  contextHealth?: ContextHealth | null;
  /** Non-fatal caveats about this scan's reliability (low coverage, LLM fallback, …). */
  warnings?: string[];
  /** NOTHING could be scored: every detector failed or returned no data, so `dimensions` is empty and
   *  `overallScore`/`level` are the renormalized floor (0 / L1) — NOT a genuine "Manual" verdict.
   *  Numeric consumers (badge, CI gate, fleet rollup) read the numbers, not `warnings`, so they must
   *  read this flag and refuse to present or enforce the result. Absent on a normal scan; a
   *  reconstructed report may predate it, so consumers should treat an empty `dimensions` array as
   *  incomplete too (see `isIncompleteReport` in scoring/gate.ts). */
  incomplete?: true;
  /** The structural step-changes that fired while scoring this report. See ScoreIntegrity — these are
   *  the levers that can move a headline on an UNCHANGED commit, so anything that anchors a number
   *  (a briefing, a percentile, a signed export, a diligence verdict) must be able to read them.
   *  Undefined on reconstructed snapshots that predate the field. */
  scoreIntegrity?: ScoreIntegrity;
  /** Follow-up ids named by `Ascent-Resolves:` trailers in the scanned commit sample (src/lib/org/
   *  followups.ts). Evidence, not score: persistence uses it to close in-progress follow-ups the
   *  fix commits declared resolved. Empty/absent when no commit carries a trailer. */
  resolvedFollowUpIds?: string[];
  /** The PR slice this report's D6/D7/D8 signals were derived from was INCOMPLETE — GraphQL returned a
   *  truncated page (null nodes / an `errors` array on a 200). The scores understate reality, so the
   *  report must not be cached or persisted as authoritative. `graphql.ts` computes this and `pulls.ts`
   *  propagates it; before this existed the flag was computed, documented, and read by nobody. */
  prPartial?: boolean;
  scannedAt: string;
  /** The scoring identity that produced this report. `rubricVersion` (SCORING_RUBRIC_VERSION) is
   *  populated on a DB-reconstructed report so the cross-instance cache tier can detect a rubric bump
   *  per-row; a live/fresh scan may omit it (the in-memory cache key already folds in the rubric).
   *  `byom` records WHOSE account the inference ran in: true = the org's OWN connected provider
   *  (BYOM), false = Ascent's platform account. Optional and additive — undefined on a legacy
   *  persisted row (scored before the flag existed), which must read as "not proven to be the
   *  customer's own account", never as true. The report header's privacy chip is the consumer:
   *  "in-account" is only an honest claim when this is true. */
  engine: { provider: ProviderName; model: string; rubricVersion?: string; byom?: boolean };
  /** LLM token usage + wall-clock latency for THIS scan's model call — the cost/usage metering basis.
   *  Absent on a mock/keyless scan, or when the provider didn't report usage. */
  usage?: { inputTokens?: number; outputTokens?: number; latencyMs?: number };
}

// ---------------------------------------------------------------------------
// Score simulator ("what-if" projections)
// ---------------------------------------------------------------------------

/** The result of re-running the weighted blend under hypothetical per-dimension changes. */
export interface ScoreProjection {
  overallScore: number;
  level: LevelId;
  levelName: string;
  /** Overall-score delta vs the report's current score (can be negative). */
  deltaScore: number;
  /** The report's current level, for rendering a `L2→L3` transition. */
  fromLevel: LevelId;
  /** True when the projected level is higher than the current one. */
  levelUp: boolean;
}

/**
 * A full client-side what-if recompute of a report under hypothetical per-dimension scores —
 * the data behind the interactive Roadmap Sandbox. With no overrides it reproduces the report's
 * own headline numbers exactly (same archetype-weighted blend), so dragging a slider only ever
 * moves what the change actually moves.
 */
export interface SandboxProjection {
  /** report.dimensions with the overrides applied (clamped/rounded), original order preserved. */
  dimensions: DimensionResult[];
  /** Overall score + level transition, via the same blend that produced the headline. */
  overall: ScoreProjection;
  /** Re-rolled AI-adoption axis (0..100). */
  adoptionScore: number;
  /** Re-rolled engineering-rigor axis (0..100). */
  rigorScore: number;
  /** The Adoption × Rigor quadrant the projected axes fall into. */
  posture: Posture;
}

/** One gap to close on the path to the next level, with its contribution to the overall. */
export interface LevelPathStep {
  dimension: DimensionId;
  targetScore: number;
  /** Overall points this step adds, on top of the steps before it. */
  gain: number;
}

/** The cheapest combination of gaps to close to reach the next maturity band. */
export interface LevelPath {
  /** Whether closing the listed gaps actually reaches the next band. */
  reachable: boolean;
  /** The next level band being targeted (null at the top of the ladder). */
  target: { level: LevelId; name: string; score: number } | null;
  steps: LevelPathStep[];
  projected: ScoreProjection;
}

// ---------------------------------------------------------------------------
// Glass-box score attribution — decompose the headline into per-dimension parts
// ---------------------------------------------------------------------------

/** One dimension's marginal contribution to the overall headline score. */
export interface DimensionContribution {
  dimension: DimensionId;
  name: string;
  /** The dimension's blended 0..100 score. */
  score: number;
  /** The dimension's lens-adjusted weight as stored on the report (may not sum to 1 across dims). */
  weight: number;
  /** Weight renormalized over the dimensions present (0..1; sums to 1 across the breakdown). */
  normalizedWeight: number;
  /**
   * Marginal points this dimension adds to the headline: `normalizedWeight * score`. Summed
   * across all dimensions, these reconstruct the overall score — so a waterfall stacking them
   * lands exactly on the headline.
   */
  points: number;
  /**
   * Signed deviation from the headline: `normalizedWeight * (score - overall)`. Positive means
   * the dimension lifts the overall above its weighted mean; negative means it drags it down.
   * Sums to ~0 across the breakdown.
   */
  signed: number;
}

/** The full decomposition of a report's overall score into per-dimension contributions. */
export interface ContributionBreakdown {
  /** The report's rounded overall headline score. */
  overallScore: number;
  /** Exact (unrounded) sum of `points` — rounds to `overallScore` for an internally consistent report. */
  total: number;
  /** Per-dimension contributions, in the report's dimension order. */
  dimensions: DimensionContribution[];
}

export interface ScanError {
  error: string;
  detail?: string;
}

/** Streamed progress event for a live scan (SSE). */
export interface ScanProgress {
  stage: "fetch" | "tree" | "files" | "analyze" | "score" | "compose" | "done";
  message: string;
  pct: number; // 0..100
  /** Intended LLM provider for this scan — drives provider-aware progress copy in the UI. */
  provider?: ProviderName;
  /** Bedrock inference region (e.g. "us-east-1"), for "Querying Bedrock in us-east-1…" copy. */
  region?: string;
  /** Set when the LLM call failed/timed out and the scan fell back to deterministic scores,
   *  so the UI can fade in a calm note instead of leaving the "Asking …" copy hanging. */
  fallback?: boolean;
}
