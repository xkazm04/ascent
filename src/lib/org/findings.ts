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
// available — the repo's fullName plus a stable check id — and fall back to hashing free text ONLY
// where no such id exists (see `blockerKey`). Adding a new module means adding a builder here, never
// inventing keys at the call site.
//
// Passport blockers were the one module still keyed by prose. They are not any more: passport 0.4.0
// mints `findings[].id` per CAUSE, and `passportFindingKey` joins on it, so an LLM rewording a blocker
// no longer resets the owner's snooze. The prose hash survives as the documented fallback for rows
// with no durable id — which includes the `unclassified` back-fill `upgradePassport` mints for an
// unrecognized stored blocker, an id that is positional and must never carry a decision.
//
// Framework-free and pure: no Prisma, no React, no db imports. Inputs are narrow structural types so
// callers can pass the slices of getOrgRollup / getOrgTeamRollup / getContributorInsights /
// buildSecurityOverview they already hold. That keeps this unit-testable and keeps the key derivation
// in exactly one place.

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

/** The half of a passport `PassportFinding` an identity is derived from: the minted id (0.4.0) plus
 *  the rendered sentence that is all a pre-0.4.0 row has. Structural, so a caller can pass a passport
 *  finding, a nav-count row or a hand-built `{ text }` without importing the passport types. */
export interface PassportFindingRef {
  /** Minted, axis-scoped cause id — e.g. `prod.zero-observability`. Null/absent on a row with none. */
  id?: string | null;
  /** The cause code without its axis prefix. Only read to spot the non-durable `unclassified` bucket. */
  code?: string | null;
  /** The rendered sentence AS OF this generation. The fallback identity, never the preferred one. */
  text: string;
}

export interface PassportFindingInput {
  fullName: string;
  /** Automation + production readiness blockers, already merged by the caller. */
  blockers: string[];
  /** 0.4.0: the same blockers WITH their minted ids, merged across both axes. Preferred over
   *  `blockers` when present — see `passportFindingKey`. */
  findings?: PassportFindingRef[];
}

/**
 * Blockers are LLM-authored prose, so the LEGACY key hashes the normalized text. A materially
 * reworded blocker is a NEW finding under this key — which is exactly the orphaning that passport
 * 0.4.0's minted ids exist to end. Kept as the fallback identity (and as the key every decision
 * recorded before 0.4.0 is stored under), never as the first choice.
 */
export function blockerKey(fullName: string, blocker: string): string {
  return `${fullName}::${fnv1a(stableText(blocker))}`;
}

/** The back-fill bucket `upgradePassport` mints for a stored blocker it cannot classify. */
const UNCLASSIFIED = "unclassified";

/**
 * Is this finding's id safe to persist a judgment against?
 *
 * `upgradePassport` back-fills a pre-0.4.0 row's blockers with ids, but an unmatched line gets
 * `auto.unclassified.<index>` — an id that MOVES when the list changes and which passport-migrate.ts
 * documents as "INTENTIONALLY not durable, so nothing downstream may persist a judgment against it".
 * Keying a decision on it would be strictly worse than the prose hash: a reworded blocker at least
 * rotates the hash honestly, whereas a positional id silently re-points an old decision at a
 * different finding. So an unclassified id reads here as NO id.
 */
function durableId(f: PassportFindingRef): string | null {
  if (!f.id || f.code === UNCLASSIFIED) return null;
  return f.id.split(".").includes(UNCLASSIFIED) ? null : f.id;
}

/**
 * The ONE identity for a passport blocker — used by the nav badge's derivation and by the drawer's
 * per-blocker decision control alike. Never derive a second one at a call site: two derivations of a
 * decision key is the same bug as no key at all, discovered later.
 *
 * Prefers the minted finding id, so rewording a blocker no longer orphans the decision recorded
 * against it (the property `src/lib/analyze/passport-overlay.ts` already relies on for declines).
 * Falls back to the prose hash when there is no durable id, which keeps pre-0.4.0 rows resolving the
 * decisions they already have.
 */
export function passportFindingKey(fullName: string, finding: PassportFindingRef): string {
  const id = durableId(finding);
  return id ? `${fullName}::${id}` : blockerKey(fullName, finding.text);
}

/**
 * Every key a decision on this finding may be STORED under, most-preferred first: the id key, then
 * the legacy prose key it would have been written under before the id existed. A reader dual-reads
 * this list so an owner's existing snooze/accept survives the switch; a WRITER always uses
 * `passportFindingKey` (element 0), which migrates the decision forward the next time it is touched.
 */
export function passportFindingKeys(fullName: string, finding: PassportFindingRef): string[] {
  const primary = passportFindingKey(fullName, finding);
  const legacy = blockerKey(fullName, finding.text);
  return primary === legacy ? [primary] : [primary, legacy];
}

export function passportFindings(repos: PassportFindingInput[]): Finding[] {
  const out: Finding[] = [];
  for (const r of repos) {
    // 0.4.0 rows carry ids; a caller that only has prose (or a passport whose axes have no `findings`)
    // still gets the legacy behaviour, one line at a time.
    const refs: PassportFindingRef[] = r.findings?.length ? r.findings : r.blockers.map((text) => ({ text }));
    // A repo can list the same blocker on both readiness axes; one finding is enough. De-duping on the
    // KEY rather than the text also collapses one cause listed twice under one id.
    const seen = new Set<string>();
    for (const f of refs) {
      if (!stableText(f.text)) continue;
      const itemKey = passportFindingKey(r.fullName, f);
      if (seen.has(itemKey)) continue;
      seen.add(itemKey);
      out.push({
        module: "passports",
        itemKey,
        repo: r.fullName,
        title: f.text.trim(),
        detail: `Readiness blocker on ${r.fullName}.`,
      });
    }
  }
  return out;
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
