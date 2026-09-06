// FORGE-NEUTRAL INGESTION (moonshot #4) — the contract.
//
// Ascent's scanner has always had exactly one seam between "where the code lives" and "what we score
// it on": `RepoSource.fetchSnapshot`. Everything downstream of a `RepoSnapshot` — the deterministic
// signal extraction, the rubric, the scorer, the report — is forge-agnostic by construction and stays
// that way. What was NOT behind a seam were the eight enrichment reads (`fetchPrStats`,
// `fetchBranchGovernance`, …), each hard-wired to `src/lib/github/*` inside `scan-ingest.ts`.
//
// This module promotes that seam into a `Forge` record: a parser, a source, an OPTIONAL enrichment
// set, and a capability manifest. Three properties are load-bearing and are asserted by tests, not
// merely intended:
//
//  1. **The GitHub member is wired BY REFERENCE.** Nothing moved out of `src/lib/github/**`. The
//     GitHub adapter (`./github.ts`) is a record of pointers to the SAME functions `scan-ingest.ts`
//     called before, and `github-parity.test.ts` asserts reference-equality field by field. A
//     re-implementation "for tidiness" fails that test — which is the only way to keep an extraction
//     from becoming a rewrite.
//
//  2. **Every enrichment member is OPTIONAL, and absence is a NULL, never a zero.** A forge that
//     cannot be asked about deployments reaches the report through the paths a token-less GitHub scan
//     already uses (`governance: null`, `deployments: []`, `prStats: null`) — the same construction
//     that makes an anonymous scan a FLOOR rather than a different rubric. No score is "compensated"
//     for a missing observable; that would fabricate exactly the number G4 forbids.
//
//  3. **No new score-bearing type.** Every enrichment returns an EXISTING shape from
//     `src/lib/types.ts` (or the module that already owned it). A forge adapter can therefore never
//     move the rubric — the contract gate for this lane.
//
// The signatures below are the signatures the GitHub functions ALREADY HAVE (`owner, repo, …`), not
// a prettier `(ParsedRepo, …)` restatement. That is deliberate and is the direct consequence of
// property 1: a signature the existing exports cannot satisfy would force a wrapper at every member,
// and a wrapper is exactly the drift the parity test exists to forbid. (Documented deviation from the
// spec's illustrative shapes, which predate the by-reference ruling W4-#6.)

import type {
  Governance,
  GuidanceFreshness,
  PrStats,
  RepoSnapshot,
  ScanProgress,
  SecurityExposure,
  SecurityPosture,
} from "@/lib/types";
import type { AiChangeRecord } from "@/lib/analyze/pulls";
import type { DeploymentRecord } from "@/lib/github/deployments";
import type { AppInventory } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";

/** The forges this build knows about. `local` is the self-hosted working-copy ingestion path, which
 *  has always been a `RepoSource` and is registered here so `resolveForge` has one answer for every
 *  value `Repository.forge` can hold. */
export type ForgeId = "github" | "gitlab" | "local";

const FORGE_IDS: readonly ForgeId[] = ["github", "gitlab", "local"];

/** Narrow an untrusted string (a query param, a DB column written by an older build) to a `ForgeId`.
 *  Anything unrecognized is NOT a forge — callers default to `github`, never guess. */
export function isForgeId(v: unknown): v is ForgeId {
  return typeof v === "string" && (FORGE_IDS as readonly string[]).includes(v);
}

/**
 * A self-hosted deployment of a forge (GHES, self-managed GitLab). Unset ⇒ the forge's public host,
 * resolved exactly as it is today — for GitHub that means the `GITHUB_API_URL` / `GITHUB_GRAPHQL_URL`
 * / `GITHUB_RAW_URL` env resolution in `src/lib/github/host.ts`, which is untouched and still wins.
 */
export interface ForgeHost {
  apiBase: string;
  webBase: string;
  rawBase?: string;
  graphqlUrl?: string;
}

/**
 * What a forge CAN be asked — the honest-nulls manifest. Read by the report warnings and rendered as
 * the per-forge observability table in `docs/features/github/forges.md`.
 *
 * `false` means "this forge cannot be observed for this signal HERE", which the report says out loud.
 * It never means "the answer is zero", and it is never used to adjust a score.
 */
export interface ForgeCapabilities {
  pullRequests: boolean;
  branchGovernance: boolean;
  deployments: boolean;
  ciHealth: boolean;
  securityPosture: boolean;
  /** Committed-lockfile vulnerability exposure (OSV). Reads repo CONTENT through the forge's API. */
  securityExposure: boolean;
  appInventory: boolean;
  codeowners: boolean;
  /** Write paths (PR gate comments, check runs, ruleset writes) stay GitHub-only — see `forges.md`. */
  write: boolean;
  /** Whether a keyless (unauthenticated) scan of a public repo is honest on this forge. */
  anonymous: boolean;
}

/**
 * The optional enrichment reads. EVERY member is optional; a missing member is "not observable on
 * this forge" and `scan-ingest.ts` falls through to the same value the token-less branch produces.
 *
 * Signatures mirror the existing `src/lib/github/*` exports exactly so the GitHub adapter binds them
 * by reference (see the module header, property 1).
 */
export interface EnrichmentSource {
  pullRequests?(
    owner: string,
    repo: string,
    token: string,
    signal?: AbortSignal,
    limit?: number,
  ): Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] } | null>;
  branchGovernance?(
    owner: string,
    repo: string,
    branch: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<Governance | null>;
  deployments?(
    owner: string,
    repo: string,
    token: string,
    signal?: AbortSignal,
    limit?: number,
  ): Promise<DeploymentRecord[]>;
  ciHealth?(
    owner: string,
    repo: string,
    branch: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<CiHealth | null>;
  securityPosture?(
    owner: string,
    repo: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<SecurityPosture | null>;
  /** Signature note: the GitHub export's `token` is optional (the OSV read works keylessly). */
  securityExposure?(
    owner: string,
    repo: string,
    ref: string,
    token?: string,
    signal?: AbortSignal,
  ): Promise<SecurityExposure | null>;
  appInventory?(
    owner: string,
    repo: string,
    sha: string,
    token: string,
    signal?: AbortSignal,
  ): Promise<AppInventory | null>;
  commitActivity?(
    owner: string,
    repo: string,
    token: string,
    signal?: AbortSignal,
    weeks?: number,
  ): Promise<number[] | null>;
  guidanceFreshness?(
    repo: ParsedRepo,
    ref: string,
    paths: string[],
    opts?: { token?: string; signal?: AbortSignal },
  ): Promise<GuidanceFreshness[]>;
}

/** One forge, as the pipeline sees it. */
export interface Forge {
  id: ForgeId;
  label: string;
  capabilities: ForgeCapabilities;
  /** Parse a pasted URL / coordinate. Returns null when the input is not this forge's. */
  parseUrl(input: string, host?: ForgeHost): ParsedRepo | null;
  /** The snapshot reader. */
  source(host?: ForgeHost): RepoSource;
  /** The enrichment set, or undefined when this forge has none (`local`). */
  enrich?(host?: ForgeHost): EnrichmentSource;
  /** A human-facing web link to the repo (optionally pinned to a commit). */
  permalink(repo: ParsedRepo, sha?: string): string;
}

// ── The declarations lifted out of `src/lib/github/source.ts` ────────────────────────────────────
// They are re-exported from their original module, so all ~16 `parseRepoUrl` call sites and
// `src/lib/local/source.ts` compile untouched. Only the DECLARATION moved; not a character of the
// text changed.

export type ProgressFn = (p: ScanProgress) => void;

export interface FetchOptions {
  token?: string;
  onProgress?: ProgressFn;
  /** Aborts all in-flight ingestion fetches when the client disconnects. */
  signal?: AbortSignal;
  /**
   * Git ref to ingest — a branch name, tag, or commit SHA. Defaults to the repo's default
   * branch. Set this to a PR's head SHA to score what a pull request *changes* (its tree, files,
   * and commits) rather than the default branch. `meta.defaultBranch` still reports the true
   * default; only the tree/content/commit reads are pinned to this ref.
   */
  ref?: string;
  /**
   * Monorepo sub-tree to aim the CONTENT budget at (e.g. `packages/api`), normalized and validated
   * upstream by `normalizeSubPath` (src/lib/scan-scope.ts). The file TREE is still read whole — repo
   * structure is a repo-wide fact — but `pickFilesToFetch` spends its per-file slots on this
   * sub-tree's manifests/source/tests instead of sampling the whole monorepo, while repo-wide
   * governance files (root README/manifests, CODEOWNERS, SECURITY.md, CI workflows) are still read so
   * the deterministic batteries that depend on them (notably D9's workflow battery) don't go blind.
   *
   * Unset ⇒ ingestion is byte-for-byte what it was before sub-path support existed.
   */
  subPath?: string;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
  /** Deep-link ref extracted from a pasted `/tree/<ref>` or `/commit/<sha>` URL (github-repo-data-access
   *  07-16 #4). parseRepoUrl historically DISCARDED everything past owner/repo, so a pasted branch/commit
   *  link silently scanned the default branch. The intent is now surfaced here so callers can pin
   *  `FetchOptions.ref`; callers that ignore it keep the lenient owner/repo-only behavior. Unset when the
   *  URL carried no ref or the ref is ambiguous (multi-segment `/tree/a/b` — a branch containing `/` is
   *  indistinguishable from a subdirectory — and `/blob/<ref>/<path>` for the same reason). */
  ref?: string;
  /** PR number from a pasted `/pull/<n>` URL — same rationale as `ref`: a user pasting a PR link is NOT
   *  asking for a default-branch scan, so the intent is preserved for callers to honor or surface. */
  prNumber?: number;
  /**
   * The forge-native stable id of the project, when the adapter resolved one BEFORE ingestion (GitLab
   * accepts a numeric project id anywhere a path works, so the parser can carry one through). Absent
   * for GitHub, where the `owner/repo` coordinate IS the identity. Never read as "no id exists".
   */
  externalId?: string;
}

export class GitHubError extends Error {
  constructor(
    public readonly code:
      | "INVALID_URL"
      | "NOT_FOUND"
      | "RATE_LIMITED"
      | "UPSTREAM"
      | "EMPTY",
    message: string,
    public readonly status?: number,
    /** Seconds to wait before retrying — set from a GitHub Retry-After on a (secondary) rate limit so
     *  callers can back off instead of hammering. Undefined when the response carried no Retry-After. */
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export interface RepoSource {
  fetchSnapshot(repo: ParsedRepo, opts?: FetchOptions): Promise<RepoSnapshot>;
}
