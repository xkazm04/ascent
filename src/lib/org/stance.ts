// AI stance (W3) — the PURE half of the Governance tab's stance module: the sanitizer that guards
// every stanceJson write (sibling of sanitizeGatePolicy in scoring/gate.ts), the repo-glob matcher,
// and the per-repo compliance evaluator. No IO/clock/random — the async fleet builder lives in
// stance-overview.ts so the db layer can import THIS module without a cycle.
//
// COMPLIANCE SEMANTICS: every verdict here is "declared vs OBSERVED attribution" — the stance says
// what is permitted, the scan data says what git attribution was observed (PR tool taxonomy, W2
// trailer rates, AiChange approval rows). Nothing here ENFORCES anything, and copy must never claim
// it does. Path-scoped no-AI zones are ADVISORY-ONLY (commit file paths aren't ingested yet), and
// every finding derived from one is labeled `advisory: true`.

import type { AiStance, AiStanceReviewTier, AiStanceZone, AutonomyTierId } from "@/lib/types";

// ---------------------------------------------------------------------------
// Sanitizer
// ---------------------------------------------------------------------------

const MAX_LIST = 50; // permitted tools/models per list
const MAX_ZONES = 20;
const MAX_GLOBS = 20; // globs per zone list
const MAX_TEXT = 200; // any single entry / review sentence / zone reason

const TIER_IDS: readonly AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

/** Trimmed, capped, deduped string list from untrusted input; non-strings/empties dropped. */
function cleanList(raw: unknown, maxItems: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const s = v.trim().slice(0, MAX_TEXT);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function cleanZone(raw: unknown): AiStanceZone | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const repoGlobs = cleanList(r.repoGlobs, MAX_GLOBS);
  const pathGlobs = cleanList(r.pathGlobs, MAX_GLOBS);
  if (repoGlobs.length === 0 && pathGlobs.length === 0) return null; // a zone that seals nothing
  const zone: AiStanceZone = { repoGlobs, pathGlobs };
  if (typeof r.reason === "string" && r.reason.trim()) zone.reason = r.reason.trim().slice(0, MAX_TEXT);
  return zone;
}

/**
 * Validate an untrusted stance object (editor form / DB row) into a clean AiStance, or null when
 * nothing usable is present — the exact contract sanitizeGatePolicy keeps for the gate. Applied on
 * WRITE (route) and again on READ (db layer): defense in depth, same as gatePolicy.
 */
export function sanitizeStance(raw: unknown): AiStance | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const permittedTools = cleanList(r.permittedTools, MAX_LIST);
  const permittedModels = cleanList(r.permittedModels, MAX_LIST);

  const noAiZones: AiStanceZone[] = [];
  if (Array.isArray(r.noAiZones)) {
    for (const z of r.noAiZones) {
      const zone = cleanZone(z);
      if (zone) noAiZones.push(zone);
      if (noAiZones.length >= MAX_ZONES) break;
    }
  }

  const reviewTiers: AiStanceReviewTier[] = [];
  if (Array.isArray(r.reviewTiers)) {
    const seen = new Set<string>();
    for (const t of r.reviewTiers) {
      if (!t || typeof t !== "object") continue;
      const { tier, review } = t as Record<string, unknown>;
      if (typeof tier !== "string" || !TIER_IDS.includes(tier as AutonomyTierId)) continue;
      if (typeof review !== "string" || !review.trim() || seen.has(tier)) continue;
      seen.add(tier);
      reviewTiers.push({ tier: tier as AutonomyTierId, review: review.trim().slice(0, MAX_TEXT) });
    }
    // Stable T0→T3 order regardless of input order, so renders and diffs are deterministic.
    reviewTiers.sort((a, b) => TIER_IDS.indexOf(a.tier) - TIER_IDS.indexOf(b.tier));
  }

  const prov = (r.provenance ?? {}) as Record<string, unknown>;
  const provenance = {
    requireTrailer: prov.requireTrailer === true,
    requireHumanApproval: prov.requireHumanApproval === true,
  };

  const stance: AiStance = { permittedTools, permittedModels, noAiZones, reviewTiers, provenance };
  const empty =
    permittedTools.length === 0 &&
    permittedModels.length === 0 &&
    noAiZones.length === 0 &&
    reviewTiers.length === 0 &&
    !provenance.requireTrailer &&
    !provenance.requireHumanApproval;
  return empty ? null : stance;
}

// ---------------------------------------------------------------------------
// Repo-glob matching
// ---------------------------------------------------------------------------

/**
 * Match a repo fullName ("owner/name") against a stance glob. `*` matches within a path segment,
 * `**` crosses segments; a bare pattern with no "/" is matched against the repo NAME as well as the
 * fullName so "billing-service" (the natural way to name one repo) works without "owner/" noise.
 * Case-insensitive (GitHub slugs are case-preserving but case-insensitive in practice).
 */
export function repoGlobMatches(glob: string, fullName: string): boolean {
  const pattern = glob.trim();
  if (!pattern) return false;
  const rx = new RegExp(`^${globToRegExpSource(pattern)}$`, "i");
  if (rx.test(fullName)) return true;
  const name = fullName.split("/").pop() ?? fullName;
  return !pattern.includes("/") && rx.test(name);
}

/** Escape regex metacharacters, then translate `**` → `.*` and `*` → `[^/]*`. */
function globToRegExpSource(glob: string): string {
  return glob
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
}

// ---------------------------------------------------------------------------
// Per-repo compliance
// ---------------------------------------------------------------------------

export type StanceAckState = "current" | "stale" | "unacked";

/** What the fleet read supplies per repo — existing scan data only, nothing newly ingested. */
export interface StanceRepoFacts {
  name: string;
  fullName: string;
  level: string;
  overall: number;
  /** Real autonomy tier from the shared resolver (passport-autonomy via the stored passport);
   *  null = no passport on the latest scan (tier not assessed — never fabricated). */
  autonomyTier: AutonomyTierId | null;
  /** AI tools OBSERVED in PR attribution (prStats.tools display names, e.g. "Claude"). */
  observedTools: string[];
  /** % of analyzed PRs that are AI-involved (prStats.aiInvolvedRate); null = no PR data. */
  aiInvolvedRate: number | null;
  /** % of merged PRs carrying an AI attribution trailer (W2); null = no sample / pre-W2 blob. */
  aiTrailerRate: number | null;
  /** AiChange rows MERGED without a human approval — the auditor's finding, already persisted. */
  unapprovedAiChanges: number;
  /** The stance version this repo acknowledged (OrgArtifactAck), or null = never acknowledged. */
  ackedVersion: number | null;
}

export interface StanceFinding {
  code: "undeclared-tool" | "provenance-trailer" | "unapproved-ai-change" | "no-ai-zone-repo";
  message: string;
  /** True when the stance clause CANNOT be checked against observed data (path-scoped zones) —
   *  the finding is a reminder of the declared rule, not an observed breach. */
  advisory: boolean;
}

/** One repo's readout against a specific stance version — always "declared vs observed". */
export interface RepoStanceCompliance {
  name: string;
  fullName: string;
  level: string;
  overall: number;
  tier: AutonomyTierId | null;
  ack: StanceAckState;
  ackedVersion: number | null;
  /** Observed trailer coverage (aiTrailerRate) when the stance requires trailers; null = not
   *  required or no measurable sample. */
  provenancePct: number | null;
  /** The repo matches a no-AI-zone repo glob (sealed to AI authorship by declaration). */
  sealed: boolean;
  findings: StanceFinding[];
  /** No NON-advisory finding — observed attribution is consistent with the declared stance. */
  compliant: boolean;
}

/** Ack freshness against the evaluated stance version. */
export function ackState(ackedVersion: number | null, stanceVersion: number): StanceAckState {
  if (ackedVersion == null) return "unacked";
  return ackedVersion >= stanceVersion ? "current" : "stale";
}

/** True when any observed signal says AI touched this repo's changes. */
function aiObserved(r: StanceRepoFacts): boolean {
  return (r.aiInvolvedRate ?? 0) > 0 || r.unapprovedAiChanges > 0 || r.observedTools.length > 0;
}

/**
 * Evaluate ONE repo's latest-scan facts against a published stance. Pure; the caller stamps which
 * `stanceVersion` was evaluated (so a readout can never silently mix versions).
 */
export function evaluateStanceCompliance(
  stance: AiStance,
  repo: StanceRepoFacts,
  stanceVersion: number,
): RepoStanceCompliance {
  const findings: StanceFinding[] = [];

  // Declared vs observed tooling: a tool showing up in PR attribution that the stance never
  // permitted. Only meaningful when the stance DECLARES an allowlist — an empty list means "no
  // tool stance taken", not "everything is forbidden".
  if (stance.permittedTools.length > 0) {
    const permitted = stance.permittedTools.map((t) => t.toLowerCase());
    for (const tool of repo.observedTools) {
      const lc = tool.toLowerCase();
      const declared = permitted.some((p) => p.includes(lc) || lc.includes(p));
      if (!declared) {
        findings.push({
          code: "undeclared-tool",
          message: `${tool} observed in PR attribution but not on the stance's permitted-tool list.`,
          advisory: false,
        });
      }
    }
  }

  // Provenance: trailer coverage. The check is observed ATTRIBUTION (aiTrailerRate vs
  // aiInvolvedRate) — a gap says trailers are missing from AI-involved work, not that a rule fired.
  let provenancePct: number | null = null;
  if (stance.provenance.requireTrailer) {
    provenancePct = repo.aiTrailerRate;
    const involved = repo.aiInvolvedRate ?? 0;
    if (repo.aiTrailerRate != null && involved > 0 && repo.aiTrailerRate < involved) {
      findings.push({
        code: "provenance-trailer",
        message: `${involved}% of merged PRs are AI-involved but only ${repo.aiTrailerRate}% carry the required attribution trailer.`,
        advisory: false,
      });
    }
  }

  // Provenance: human approval. AiChange rows already record "merged AI-attributed change with no
  // approving review" — the exact population an auditor samples.
  if (stance.provenance.requireHumanApproval && repo.unapprovedAiChanges > 0) {
    findings.push({
      code: "unapproved-ai-change",
      message: `${repo.unapprovedAiChanges} AI-attributed PR${repo.unapprovedAiChanges === 1 ? "" : "s"} merged without a recorded human approval.`,
      advisory: false,
    });
  }

  // No-AI zones, repo scope: checkable — the repo either matches a declared repo glob or not, and
  // observed AI attribution inside a sealed repo is a declared-vs-observed contradiction.
  const sealed = stance.noAiZones.some((z) => z.repoGlobs.some((g) => repoGlobMatches(g, repo.fullName)));
  if (sealed && aiObserved(repo)) {
    findings.push({
      code: "no-ai-zone-repo",
      message: "AI attribution observed in a repo the stance declares a no-AI zone.",
      advisory: false,
    });
  }

  return {
    name: repo.name,
    fullName: repo.fullName,
    level: repo.level,
    overall: repo.overall,
    tier: repo.autonomyTier,
    ack: ackState(repo.ackedVersion, stanceVersion),
    ackedVersion: repo.ackedVersion,
    provenancePct,
    sealed,
    findings,
    compliant: findings.every((f) => f.advisory),
  };
}

/**
 * The label every surface must attach to a path-scoped zone: commit file paths aren't ingested,
 * so path globs cannot be checked against observed data. Single-sourced so the UI and the
 * AI_POLICY.md artifact can't drift into claiming enforcement.
 */
export const PATH_ZONE_ADVISORY_LABEL =
  "Advisory — path-level activity is not observable from scan data yet, so this clause is declared, not checked.";
