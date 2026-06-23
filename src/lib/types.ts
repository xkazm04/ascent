// Shared domain types for Ascent — the AI-native maturity index.
// See docs/MATURITY_MODEL.md for the conceptual model behind these types.

export type LevelId = "L1" | "L2" | "L3" | "L4" | "L5";
export type DimensionId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9";
export type Impact = "high" | "medium" | "low";
export type Effort = "high" | "medium" | "low";
export type ProviderName = "gemini" | "bedrock" | "openai" | "mock" | "claude-cli";
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

/** What a RecommendationEvent records: a status change, a (re)assignment, or a due-date change. */
export type RecEventKind = "status" | "assignee" | "target_date";

export const REC_EVENT_KINDS: RecEventKind[] = ["status", "assignee", "target_date"];

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

export interface CommitInfo {
  message: string;
  authorName?: string;
  authorLogin?: string;
  committedAt?: string;
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

export interface AppPassport {
  passport: "app-passport";
  passportVersion: string;
  generatedAt: string;
  generatedBy: string;
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
    monitoring: { errorTracking: string | null; logs: string | null; metrics: string | null; tracing: string | null; uptime: string | null };
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
      memory: boolean;
      manifest: boolean;
      evals: "none" | "partial" | "full";
      skills: boolean;
    };
    selfVerify: { build: boolean; test: boolean; lint: boolean; typecheck: boolean };
    aiInWorkflow: boolean;
    blockers: string[];
  };
  productionReadiness: {
    band: ProductionBand;
    score: number;
    ci: { level: "none" | "build" | "checks" | "gated" | "delivery" | "progressive"; provider: string | null; gates: string[] };
    tests: { level: "none" | "smoke" | "partial" | "substantial" | "comprehensive"; coveragePct: number | null; frameworks: string[]; criticalPathCovered: boolean };
    security: { level: "none" | "policy" | "scanning" | "gated" | "supply-chain"; tools: string[] };
    observability: { level: "none" | "logs" | "errors" | "metrics" | "tracing" };
    delivery: { migrations: "none" | "scripted" | "versioned"; iac: boolean; rollback: boolean };
    blockers: string[];
  };
  links: { report?: string; contextMap?: string; manifest?: string };
  evidence: { confidence: number; source: string; files: string[] };
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
  /** Optional notes passed to the LLM as extra context. */
  notes?: string;
  /** Set when the detector THREW and this is a placeholder (signalScore is NOT a real measurement).
   *  The engine excludes a failed dimension from the overall instead of folding a fake 0 that would
   *  deflate the score as if the repo genuinely scored zero on it. */
  failed?: boolean;
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
   * Null when too few AI PRs to be meaningful (sample < 3). The systematic-AI signal. */
  aiGovernedRate: number | null;
  revertRate: number; // titles starting with "Revert"
  draftRate: number;
  tools: { name: string; count: number }[]; // detected AI-tool taxonomy
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

/** The two-axis posture (Adoption × Rigor) quadrant. */
export interface Posture {
  id: "ai-native" | "ungoverned" | "manual" | "early";
  label: string;
  blurb: string;
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
  /** Non-fatal caveats about this scan's reliability (low coverage, LLM fallback, …). */
  warnings?: string[];
  scannedAt: string;
  engine: { provider: ProviderName; model: string };
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
