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
// available — the repo's fullName plus a stable id — and fall back to hashing free text only where no
// id exists. Adding a new module means adding a builder here, never inventing keys at the call site.
//
// PASSPORT BLOCKERS (Direction 8). These were the one text-hashed key left, on the grounds that they
// are "LLM-authored prose with no id". Passport 0.4.0 made that false: every blocker is minted with a
// `findings[].id` (`auto.self-verify-gaps`), which the decline join and the fleet Pareto already key
// on. Text-hashing was actively wrong for at least one of them — `auto.self-verify-gaps` embeds the
// missing-script list in its sentence, so a repo that adds a `lint` script rotated its key and
// ORPHANED the decision its owner had recorded. `blockerKeys` therefore returns the id key as the
// write key and the old prose key as a read-only legacy alias.
//
// Framework-free and pure: no Prisma, no React, no db imports. Inputs are narrow structural types so
// callers can pass the slices of getOrgRollup / getOrgTeamRollup / getContributorInsights /
// buildSecurityOverview they already hold. That keeps this unit-testable and keeps the key derivation
// in exactly one place.

import { passportJudgmentKeys, stableBlockerText } from "@/lib/org/passport-judgments";

/** The modules whose derived signals are decidable. Matches OrgDecision.module. */
export const FINDING_MODULES = ["security", "teams", "passports", "contributors", "practices"] as const;

export type FindingModule = (typeof FINDING_MODULES)[number];

export function isFindingModule(v: string | null | undefined): v is FindingModule {
  return typeof v === "string" && (FINDING_MODULES as readonly string[]).includes(v);
}

export interface Finding {
  module: FindingModule;
  /** Deterministic identity within (org, module). Stable across re-scans. */
  itemKey: string;
  /**
   * READ-ONLY keys a decision on this finding may have been stored under before its key moved (a
   * passport blocker decided under its prose hash before minted ids). Compared by
   * `isFindingResolved`; never written. Absent for every module whose key never moved.
   */
  aliases?: string[];
  /** Repo this finding belongs to (fullName), for grouping and display. */
  repo: string;
  /** One-line human title. Persisted onto the decision so it survives the finding disappearing. */
  title: string;
  /** The "what to do about it" text. */
  detail: string;
  /**
   * The finding's own name WITHOUT the repo context `title` carries — e.g. "Branch protection" where
   * the title is "Branch protection (acme/api)". For a surface that already has a repo column, so it
   * doesn't print the repo twice per row. Optional: a builder whose title IS the repo (teams,
   * contributors) has nothing to strip and omits it. Never use this as an identity — `itemKey` is the
   * identity, and `title` is what gets persisted onto the decision.
   */
  subject?: string;
}

// The passport key primitives (fnv1a, blockerKey, findingItemKey, passportJudgmentKey) live in
// passport-judgments.ts — the one module that owns a passport finding's key AND its judgment state —
// and are re-exported here so every existing import path keeps resolving to the same functions.
export { fnv1a, blockerKey, findingItemKey } from "@/lib/org/passport-judgments";

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
        subject: c.name,
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
  /**
   * Passport 0.4.0's minted findings behind those blockers (same sentences, plus a stable `id`).
   * OPTIONAL and matched by text: a caller that has not plumbed them through yet keeps producing the
   * legacy text-hashed key exactly as before, so nothing moves for it. Supplying them switches this
   * repo's findings onto the id key — the identity a decision should have been keyed on all along.
   */
  findings?: { id: string; text: string }[];
}

/**
 * Every key a decision for this blocker may be stored under, newest first: `[0]` is the WRITE key, the
 * rest are READ-ONLY legacy aliases. A thin adapter over `passportJudgmentKeys` (passport-judgments.ts),
 * which owns the rule — including that a positional `*.unclassified.<i>` back-fill id is not durable
 * and keys on the prose instead.
 */
export function blockerKeys(fullName: string, blocker: string, findingId?: string | null): string[] {
  return passportJudgmentKeys(fullName, { id: findingId, text: blocker });
}

export function passportFindings(repos: PassportFindingInput[]): Finding[] {
  const out: Finding[] = [];
  for (const r of repos) {
    // A repo can list the same blocker on both readiness axes; one finding is enough. De-duping on
    // the KEY rather than the text also collapses two differently-worded sentences that the passport
    // minted under one cause id — which is the same thing the fleet Pareto's bucketing does.
    const seen = new Set<string>();
    const idFor = (text: string): string | undefined =>
      r.findings?.find((f) => stableBlockerText(f.text) === stableBlockerText(text))?.id;
    for (const b of r.blockers) {
      if (!stableBlockerText(b)) continue;
      const [key, ...aliases] = passportJudgmentKeys(r.fullName, { id: idFor(b), text: b });
      if (seen.has(key!)) continue;
      seen.add(key!);
      out.push({
        module: "passports",
        itemKey: key!,
        ...(aliases.length ? { aliases } : {}),
        repo: r.fullName,
        title: b.trim(),
        detail: `Readiness blocker on ${r.fullName}.`,
      });
    }
  }
  return out;
}

/**
 * Has a human already resolved this finding? THE comparison every badge and worklist makes against
 * `resolvedKeys`: the current key, or any read-only alias it used to be decided under. Without the
 * alias half, moving a blocker onto its id key would itself be the regression — a decision recorded
 * under the old prose key would stop suppressing the badge, curable only by deciding it twice.
 */
export function isFindingResolved(f: Pick<Finding, "module" | "itemKey" | "aliases">, resolved: Map<string, Set<string>>): boolean {
  const set = resolved.get(f.module);
  if (!set) return false;
  return set.has(f.itemKey) || (f.aliases ?? []).some((k) => set.has(k));
}

// ── Practices (MOONSHOT #33) ──────────────────────────────────────────────────────────────────────

export interface PracticeAdoptionFindingInput {
  repoFullName: string;
  /** Catalog id, `registry:<slug>` or `playbook:<uuid>`. */
  practiceId: string;
  artifactPath: string;
  /** The ledger row's state. Only `drifted` and `removed` are findings. */
  state: string;
  /** Human label for the practice, when the caller knows one. Falls back to the id. */
  label?: string;
}

/**
 * The identity of a drifted adoption: repo + practice + the file it landed at. Nothing derived from
 * WORDING, so a reworded detail line never orphans the decision recorded against it — the same rule
 * the security keys follow, and the reason the Follow-ups badge stops re-counting a decided finding
 * after the next scan.
 */
export function practiceAdoptionKey(repoFullName: string, practiceId: string, artifactPath: string): string {
  return `${repoFullName}:${practiceId}:${artifactPath}`;
}

/**
 * One finding per drifted or removed adoption.
 *
 * DRIFT IS A FINDING TO DECIDE, NEVER A TRIGGER. Nothing downstream of this re-applies the practice;
 * the row lands in the Follow-ups worklist and waits for a human, because "we changed it on purpose"
 * is the most likely explanation for a diverged artifact and re-opening a PR over that judgment would
 * be the product arguing with its user. The rollout that DOES re-apply is a separate, explicitly
 * confirmed action.
 */
export function practiceFindings(rows: PracticeAdoptionFindingInput[]): Finding[] {
  const out: Finding[] = [];
  for (const r of rows) {
    if (r.state !== "drifted" && r.state !== "removed") continue;
    const name = r.label?.trim() || r.practiceId;
    out.push({
      module: "practices",
      itemKey: practiceAdoptionKey(r.repoFullName, r.practiceId, r.artifactPath),
      repo: r.repoFullName,
      title: `${name} ${r.state === "removed" ? "was removed from" : "has drifted in"} ${r.repoFullName}`,
      subject: name,
      detail:
        r.state === "removed"
          ? `\`${r.artifactPath}\` is no longer in the default branch. Re-adopt the practice, or record that this repo no longer needs it.`
          : `\`${r.artifactPath}\` no longer matches the structure that landed. Accept the divergence, or roll the current pattern back out to this repo.`,
    });
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
