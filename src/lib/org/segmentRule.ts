// A segment's DECLARED membership — the rule, not the snapshot.
//
// Until this module existed, "auto-add every Python repo to this segment" was a one-shot: the browser
// filtered its own props, POSTed the matching fullNames, and the server stored a membership list that
// had no idea it was ever meant to be "all Python repos". From that second on the segment was a frozen
// photograph of a predicate — a repo onboarded tomorrow never joined, a repo whose language flipped
// never left, and nothing on screen said so, while that stale set went on scoping segment-scoped scans
// and cadence writes.
//
// So a segment may carry a rule, and convergence toward it is an explicit, audited act (the posture
// reconcileListedRepos established in src/lib/db/org-watch.ts: mark the drift, let the user judge the
// remedy). Everything here is PURE — no DB, no Prisma, no fetch — so the Segments view can compute and
// render drift out of the taggable repos it already holds, at zero query cost, and so the two rules
// that actually matter are testable without a database:
//
//   1. ROW OWNERSHIP. Once two writers touch one join table (a human tagging by hand, a rule
//      converging), last-write-wins is the absence of a policy. A membership row carries its owner,
//      and a rule may only ever reap a row it OWNS. A hand-tag is permanent against the rule.
//   2. "NO RULE" IS NOT "NOTHING TO DO". segmentDrift returns null for an undeclared segment and an
//      empty drift for a declared one that is in sync, because a screen that cannot tell them apart
//      either claims a segment is converged when it has no declaration, or hides the declaration.

/** The predicates a segment can declare. Both read fields listTaggableRepos already selects. */
export type SegmentRuleKind = "language" | "team";

/** A segment's declared membership: every taggable repo whose `kind` field is ANY of `values`. */
export interface SegmentRule {
  kind: SegmentRuleKind;
  values: string[];
}

/** Who wrote a membership row. Only a `rule`-owned row may be reaped by a convergence. */
export type SegmentMemberSource = "manual" | "rule";

/** The repo fields a rule can read — the subset of TaggableRepo / OrgRepoRow a predicate needs. */
export interface RuleRepo {
  fullName: string;
  language?: string | null;
  teams?: string[];
}

/** One current membership row, with its owner. */
export interface SegmentMember {
  fullName: string;
  source: SegmentMemberSource;
}

/** What an apply WOULD do: fullNames to tag, fullNames to untag. Counts are `.length`. */
export interface SegmentDrift {
  /** Matches the rule, not tagged. */
  toAdd: string[];
  /** Tagged AND rule-owned AND no longer matching. Never contains a `manual` row. */
  toRemove: string[];
}

const KINDS: SegmentRuleKind[] = ["language", "team"];
/** Bound the declaration so a stored rule can never grow unbounded through the API. */
export const SEGMENT_RULE_MAX_VALUES = 50;

/**
 * Validate an API-supplied rule, returning a human-readable error or null — the same reject-with-400
 * contract `segmentInputError` (src/lib/db/segments.ts) established for name and colour, for the same
 * reason: silently sanitizing a caller's declaration into something else is worse than refusing it,
 * because the caller is told their value was applied.
 */
export function segmentRuleInputError(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Provide a rule { kind, values }.";
  const { kind, values } = input as { kind?: unknown; values?: unknown };
  if (typeof kind !== "string" || !KINDS.includes(kind as SegmentRuleKind)) {
    return "Rule kind must be language or team.";
  }
  if (!Array.isArray(values)) return "Rule values must be a list.";
  const cleaned = (values as unknown[]).filter((v) => typeof v === "string" && v.trim() !== "");
  if (cleaned.length === 0) return "A rule needs at least one value.";
  return null;
}

/** Trim, de-duplicate (case-insensitively) and bound a rule's values; null when the input is invalid. */
export function normalizeSegmentRule(input: unknown): SegmentRule | null {
  if (segmentRuleInputError(input) !== null) return null;
  const { kind, values } = input as { kind: SegmentRuleKind; values: unknown[] };
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= SEGMENT_RULE_MAX_VALUES) break;
  }
  return out.length === 0 ? null : { kind, values: out };
}

/** Read the stored `Segment.ruleJson` column. A null, empty or malformed column is NO rule, never a
 *  throw: a segment created before this feature, or one whose column was hand-edited, must still load. */
export function parseSegmentRule(raw: string | null | undefined): SegmentRule | null {
  if (!raw) return null;
  try {
    return normalizeSegmentRule(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Serialize for the `ruleJson` column; null clears the declaration. */
export function serializeSegmentRule(rule: SegmentRule | null): string | null {
  return rule ? JSON.stringify(rule) : null;
}

/** Does this repo satisfy the declaration? Case-insensitive; a repo with no language / no teams
 *  matches nothing, because an absent field is not a match for any declared value. */
export function matchesRule(repo: RuleRepo, rule: SegmentRule): boolean {
  const wanted = new Set(rule.values.map((v) => v.toLowerCase()));
  if (rule.kind === "language") {
    const lang = repo.language;
    return typeof lang === "string" && wanted.has(lang.toLowerCase());
  }
  return (repo.teams ?? []).some((t) => wanted.has(t.toLowerCase()));
}

/**
 * What a convergence would change, computed from the repo universe and the current membership rows.
 *
 * `null` for an unruled segment — see rule 2 at the top of this file.
 *
 * A rule-owned row whose repo is absent from `repos` is KEPT, not reaped: the taggable universe is
 * "watched OR has-scans", so a repo can leave it without ceasing to match the rule, and absence is not
 * evidence of a mismatch. Same reasoning as reconcileListedRepos refusing to mark anything from an
 * incomplete listing.
 */
export function segmentDrift(input: {
  rule: SegmentRule | null;
  repos: RuleRepo[];
  membership: SegmentMember[];
}): SegmentDrift | null {
  const { rule, repos, membership } = input;
  if (!rule) return null;
  const tagged = new Set(membership.map((m) => m.fullName));
  const byFullName = new Map(repos.map((r) => [r.fullName, r]));
  const toAdd = repos.filter((r) => matchesRule(r, rule) && !tagged.has(r.fullName)).map((r) => r.fullName);
  const toRemove = membership
    .filter((m) => {
      if (m.source !== "rule") return false; // a human put it there; the rule has no say
      const repo = byFullName.get(m.fullName);
      if (!repo) return false; // outside the universe: never judged
      return !matchesRule(repo, rule);
    })
    .map((m) => m.fullName);
  return { toAdd, toRemove };
}

/** A short phrase for the segment card ("language is Python", "team is @a or @b"); null for no rule. */
export function describeSegmentRule(rule: SegmentRule | null): string | null {
  if (!rule) return null;
  return `${rule.kind} is ${rule.values.join(" or ")}`;
}
