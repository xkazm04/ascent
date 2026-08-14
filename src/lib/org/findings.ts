// Derived findings, promoted to decidable items.
//
// Four org modules surface work a human must judge but which owns no database row: a failing security
// check, a repo with no CODEOWNERS team, a passport blocker, a solo-maintained repo. Each is recomputed
// from scan data on every render. This module turns those signals into `Finding`s with a DETERMINISTIC
// `itemKey`, so a decision recorded against one (OrgDecision) survives the next scan and the finding
// stops re-appearing in the rail's badge.
//
// The whole design rests on key stability. A key built from wording ("Default branch is unprotected")
// changes the moment a rubric or an LLM reworded the sentence, silently orphaning the decision and
// resurrecting a finding the user already dismissed. So keys are built from the most stable identity
// available — the repo's fullName plus a stable check id — and fall back to hashing free text ONLY for
// passport blockers, which are LLM-authored prose with no id (see `blockerKey`). Adding a new module
// means adding a builder here, never inventing keys at the call site.
//
// Framework-free and pure: no Prisma, no React, no db imports. Inputs are narrow structural types so
// callers can pass the slices of getOrgRollup / getOrgTeamRollup / getContributorInsights /
// buildSecurityOverview they already hold. That keeps this unit-testable and keeps the key derivation
// in exactly one place.

/** The modules whose derived signals are decidable. Matches OrgDecision.module. */
export const FINDING_MODULES = ["security", "teams", "passports", "contributors"] as const;

export type FindingModule = (typeof FINDING_MODULES)[number];

export function isFindingModule(v: string | null | undefined): v is FindingModule {
  return typeof v === "string" && (FINDING_MODULES as readonly string[]).includes(v);
}

export interface Finding {
  module: FindingModule;
  /** Deterministic identity within (org, module). Stable across re-scans. */
  itemKey: string;
  /** Repo this finding belongs to (fullName), for grouping and display. */
  repo: string;
  /** One-line human title. Persisted onto the decision so it survives the finding disappearing. */
  title: string;
  /** The "what to do about it" text. */
  detail: string;
}

/**
 * FNV-1a, 32-bit, hex. Used only where a finding has no stable id of its own (passport blockers are
 * LLM prose). Not a security hash — it needs to be fast, dependency-free and identical on every run.
 * Collisions are scoped to one repo's blocker list, where a handful of strings makes them negligible.
 */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Normalize free text before hashing so whitespace/case churn doesn't rotate a key. */
function stableText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Security ──────────────────────────────────────────────────────────────────────────────────────

/** A repo's D9 check battery, as parsed onto SecurityRegisterRow.checks. */
export interface SecurityFindingInput {
  fullName: string;
  checks: { id: string; name: string; score: number | null; risk: string; detail: string }[];
}

/**
 * A check scoring below 7 is what `buildSecurityChecks` already treats as "what to fix"; a null score
 * means not-applicable, never a finding. The key rides the check's own stable id, so re-wording the
 * risk copy never orphans a decision.
 */
const SECURITY_FAIL_BELOW = 7;

export function securityFindings(rows: SecurityFindingInput[]): Finding[] {
  const out: Finding[] = [];
  for (const row of rows) {
    for (const c of row.checks) {
      if (c.score == null || c.score >= SECURITY_FAIL_BELOW) continue;
      out.push({
        module: "security",
        itemKey: `${row.fullName}::${c.id}`,
        repo: row.fullName,
        title: `${c.name} (${row.fullName})`,
        detail: c.detail || c.risk,
      });
    }
  }
  return out;
}

// ── Teams ─────────────────────────────────────────────────────────────────────────────────────────

export interface TeamsFindingInput {
  fullName: string;
  overall: number;
}

/** One finding per scanned repo with no CODEOWNERS team. The repo IS the identity. */
export function teamsFindings(unowned: TeamsFindingInput[]): Finding[] {
  return unowned.map((r) => ({
    module: "teams",
    itemKey: r.fullName,
    repo: r.fullName,
    title: `${r.fullName} has no owning team`,
    detail: "No CODEOWNERS team maps to this repo. Assign an owner, or record why it stays unowned.",
  }));
}

// ── Passports ─────────────────────────────────────────────────────────────────────────────────────

export interface PassportFindingInput {
  fullName: string;
  /** Automation + production readiness blockers, already merged by the caller. */
  blockers: string[];
}

/**
 * Blockers are LLM-authored prose with no id, so the key hashes the normalized text. A materially
 * reworded blocker is a NEW finding — correct: the decision was made about the old wording, and a
 * changed blocker deserves a fresh look.
 */
export function blockerKey(fullName: string, blocker: string): string {
  return `${fullName}::${fnv1a(stableText(blocker))}`;
}

export function passportFindings(repos: PassportFindingInput[]): Finding[] {
  const out: Finding[] = [];
  for (const r of repos) {
    // A repo can list the same blocker on both readiness axes; one finding is enough.
    const seen = new Set<string>();
    for (const b of r.blockers) {
      const text = stableText(b);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({
        module: "passports",
        itemKey: blockerKey(r.fullName, b),
        repo: r.fullName,
        title: b.trim(),
        detail: `Readiness blocker on ${r.fullName}.`,
      });
    }
  }
  return out;
}

// ── Contributors ──────────────────────────────────────────────────────────────────────────────────

export interface ContributorFindingInput {
  fullName: string;
  soloMaintainer: boolean;
  contributors: number;
  /** Top contributor's share of commits, 0..100. */
  topShare: number;
}

/** One finding per solo-maintained repo — a bus-factor risk to accept, or to act on by pairing. */
export function contributorFindings(repos: ContributorFindingInput[]): Finding[] {
  return repos
    .filter((r) => r.soloMaintainer)
    .map((r) => ({
      module: "contributors",
      itemKey: r.fullName,
      repo: r.fullName,
      title: `${r.fullName} is solo-maintained`,
      detail:
        r.contributors === 1
          ? "A single contributor. Accept the bus-factor risk, or schedule pairing."
          : `Top contributor owns ${Math.round(r.topShare)}% of commits. Accept the risk, or spread ownership.`,
    }));
}
