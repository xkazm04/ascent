// Shared aggregation for the Top blockers panel (P3) and its prototype variants: passport blockers
// counted across the repos in view, ranked by how many repos each one affects.
//
// TWO defects fixed in passport 0.4.0, both about what a bucket is keyed on and what it counts:
//
// 1. IDENTITY. Buckets used to be keyed on the blocker's rendered STRING, with one hand-written
//    normalization (SELF_VERIFY_BUCKET) papering over the single blocker whose wording varies by
//    repo. Any copy edit to a builder-authored sentence silently split one fleet bucket into two,
//    and the Pareto under-reported the org's most common problem with nothing to notice it. The
//    passport now mints a cause `code` per finding, so the bucket keys on that; the sentence is
//    payload. The string path stays as a fallback for pre-0.4.0 rows that carry no findings.
//
// 2. DECLINES ARE COUNTED, NOT SUBTRACTED. The rows this reads are POST-OVERLAY: the decline overlay
//    has already retired every accepted gap from `blockers`. So each deliberately accepted gap used
//    to shrink the fleet count for that blocker, in exact proportion to how many teams had decided
//    to live with it — the one blocker everybody has accepted looked like the one nobody has. A
//    shared problem must keep its true size, so declines are now carried as their own population
//    beside the open one. Ranking uses the TOTAL (open + declined); the two lists stay separate so a
//    surface can show "12 blocked, 4 accepted" and never present a team's own decision back to them
//    as an open finding.
//
// 3. A COVERAGE HOLE IS NOT A SCORED BLOCKER (G4). `prod.*-unassessable` and the tokenless
//    `enforcement-not-observable` caveat name a limit of THIS scan, not a gap in the app. Ranking
//    them would make "we could not look" look like the org's most common problem. They stay on
//    `findings[]` so a rung can still be classified unassessable; they are dropped here.
//
// 4. A MEMBER'S DECISION IS A DECISION TOO (card ai-native-passports#A). Only the owner's overlay
//    decline used to move a repo out of `repos`; a blocker a member DISMISSED from the drawer (an
//    OrgDecision) was still counted open, and the issue draft filed against it. Every open blocker is
//    now judged by `judgeFinding` (src/lib/org/passport-judgments.ts), the same model the drawer and
//    the rail badge read, and a decided repo lands in `dismissedRepos` — counted beside, never
//    subtracted, exactly like a decline.

import { isCoverageHoleFinding, isCoverageHoleText } from "@/lib/analyze/passport";
import type { DecisionMap } from "@/lib/org/decision-map";
import { judgeFinding } from "@/lib/org/passport-judgments";
import type { DeclinedByChoice, PassportFinding } from "@/lib/types";

export interface BlockedRepo {
  name: string;
  fullName: string;
}

/** The row shape this aggregation needs. Structural on purpose: `PassportRow` from PassportTable
 *  satisfies it, and the two 0.4.0 fields are optional so a caller that has not yet plumbed them
 *  through simply contributes no declines rather than failing to compile. */
export interface BlockerAggRow {
  name: string;
  fullName: string;
  /** The repo's latest scan came from the deterministic MOCK engine, so its blockers are a
   *  placeholder floor rather than a model's finding. Counted, never excluded — see `scopeCounts`. */
  placeholder?: boolean;
  detail: {
    autoBlockers: string[];
    prodBlockers: string[];
    /** 0.4.0: the minted findings behind `autoBlockers` / `prodBlockers`, when the caller has them. */
    autoFindings?: PassportFinding[];
    prodFindings?: PassportFinding[];
    /** 0.4.0: the owner's accepted gaps for this repo — what the overlay removed from the lists above. */
    declined?: DeclinedByChoice[];
  };
}

export interface Agg {
  /** Stable bucket key: the finding's cause code (`zero-observability`), or the normalized string on
   *  a pre-0.4.0 row. Rewording the blocker does not move a repo out of its bucket. */
  code: string;
  /** The sentence to show — the first text seen for this bucket. Payload, never the key. */
  label: string;
  axis: "automation" | "production";
  /** Repos where this blocker is OPEN. */
  repos: BlockedRepo[];
  /** Repos whose owner has deliberately ACCEPTED this gap. Counted BESIDE `repos`, never subtracted
   *  from it, and kept separate so a chart can render the decision as a decision. */
  declinedRepos: BlockedRepo[];
  /** Repos where a member has resolved this blocker with an OrgDecision (accepted / dismissed / an
   *  unexpired snooze). Counted beside `repos`, never targeted by the issue draft. */
  dismissedRepos: BlockedRepo[];
}

export const SELF_VERIFY_BUCKET = "Agent can't self-verify (missing build/test/lint/typecheck scripts).";

/** Pre-0.4.0 fallback key: the blocker string itself, with the one variable message folded into a
 *  single bucket by hand. Kept only for rows whose passport predates minted ids. */
const legacyKey = (text: string): string => (text.startsWith("Agent can't self-verify") ? SELF_VERIFY_BUCKET : text);

/** `prod.zero-observability` -> `zero-observability`. A decline records the full minted id; a bucket
 *  keys on the code, which is the same value the finding carries. */
const codeOf = (findingId: string): string => findingId.slice(findingId.indexOf(".") + 1);

/** `decisions` is the `decisionMap(slug, "passports")` view (an expired snooze already reads open).
 *  Omitted, every listed blocker is open — exactly the pre-decision behaviour. */
export function aggregateBlockers(rows: BlockerAggRow[], decisions: DecisionMap = {}): Agg[] {
  const byCode = new Map<string, Agg>();
  const bucket = (code: string, label: string, axis: Agg["axis"]): Agg => {
    const agg = byCode.get(code) ?? { code, label, axis, repos: [], declinedRepos: [], dismissedRepos: [] };
    byCode.set(code, agg);
    return agg;
  };

  for (const r of rows) {
    const repo: BlockedRepo = { name: r.name, fullName: r.fullName };
    const axes = [
      { axis: "automation" as const, texts: r.detail.autoBlockers, findings: r.detail.autoFindings },
      { axis: "production" as const, texts: r.detail.prodBlockers, findings: r.detail.prodFindings },
    ];
    // One judgment per listed blocker: open (incl. a re-surfaced decline) -> `repos`; a member's
    // resolution -> `dismissedRepos`. A standing overlay decline is counted by the loop below.
    const place = (agg: Agg, finding: { id?: string; code?: string; text: string }) => {
      const j = judgeFinding({ fullName: r.fullName, finding, declined: r.detail.declined, decisions });
      if (!j || j.state === "declined") return;
      (j.open ? agg.repos : agg.dismissedRepos).push(repo);
    };
    for (const { axis, texts, findings } of axes) {
      if (findings) {
        for (const f of findings) {
          if (isCoverageHoleFinding(f)) continue;
          place(bucket(f.code, f.text, axis), f);
        }
      } else {
        for (const t of texts) {
          if (isCoverageHoleText(t)) continue;
          place(bucket(legacyKey(t), legacyKey(t), axis), { text: t });
        }
      }
    }

    // The declines the overlay already removed from the lists above. A decline with no `findingId` is
    // pre-0.4.0 and has no bucket to join — it is skipped rather than guessed into the wrong one; the
    // alternative (matching its `blocker` prose) is the exact join this change removed.
    for (const d of r.detail.declined ?? []) {
      if (!d.findingId) continue;
      if (isCoverageHoleFinding({ id: d.findingId, code: codeOf(d.findingId) })) continue;
      const axis: Agg["axis"] = d.findingId.startsWith("auto.") ? "automation" : "production";
      const agg = bucket(codeOf(d.findingId), d.blocker ?? d.label, axis);
      // A re-surfaced decline is ALSO an open blocker (the overlay left it in the list), so it is
      // already counted in `repos` above; recording it here too would double-count the repo.
      if (!d.needsReconfirm) agg.declinedRepos.push(repo);
    }
  }

  // Rank by the problem's TRUE size — open plus accepted plus member-decided. Ties break toward the
  // more open one, since that is the more actionable row.
  const size = (a: Agg) => a.repos.length + a.declinedRepos.length + a.dismissedRepos.length;
  return [...byCode.values()].sort((a, b) => size(b) - size(a) || b.repos.length - a.repos.length);
}

/** Axis palette — mirrors the scatter's vocabulary: automation = the accent, production = the
 *  "automatable, not prod-ready" amber. */
export const AXIS_TONE: Record<Agg["axis"], { label: string; color: string }> = {
  automation: { label: "auto", color: "#3b9eff" },
  production: { label: "prod", color: "#d97706" },
};

/** What the docket's counts are actually OVER — the predicate a Pareto has to state out loud.
 *
 * The buckets deliberately do not exclude a placeholder-scanned repo (excluding it would silently
 * shrink a fleet problem, the same defect declines already caused above), so the honest disclosure is
 * arithmetic beside the ranking: N repos in view, of which M were never graded by a model. A reader
 * who knows M can discount the ranking; a reader who does not, cannot.
 */
export interface ScopeCounts {
  /** Repos the docket ranked over. */
  repos: number;
  /** How many of those carry a deterministic placeholder scan. Always <= `repos`. */
  placeholderRepos: number;
}

export function scopeCounts(rows: BlockerAggRow[]): ScopeCounts {
  return { repos: rows.length, placeholderRepos: rows.filter((r) => r.placeholder === true).length };
}
