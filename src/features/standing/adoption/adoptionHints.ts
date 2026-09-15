// Every sentence the Adoption tab demoted, in ONE place.
//
// The /org redesign (docs/ORG-UX-REDESIGN.md §2.1) says prose is demoted, never deleted: a removed
// sentence lands in a visual state (E), an on-demand affordance (D), an empty state (O) or a feature
// doc (F). This module is the (D) destination — the strings a `WhyChip` or a `<title>` carries — so
// the tab's caveats are auditable as a list instead of scattered across seven components, and so a
// caveat cannot silently drift from the picture it qualifies.
//
// Server-safe: strings only. Each constant names the sentence it replaced.

/** Was on the panel header, fused into a four-job paragraph: the definition half of it. */
export const ATTRIBUTION_HINT =
  "AI attribution reads co-authorship trailers and tool markers on commits and PRs — an observed marker, not a survey answer, so a tool that leaves no trace is invisible to it.";

/** Was the footer's "Team rollups use CODEOWNERS attribution" clause. */
export const CODEOWNERS_HINT =
  "Teams come from CODEOWNERS: a repo with no CODEOWNERS entry belongs to no team here, and a team whose repos carry no contributor attribution is hatched rather than shown at 0%.";

/** Was ChampionsCard's "Culture carriers: high AI adoption across real volume…" description. */
export const CHAMPION_HINT =
  "Culture carriers: high AI adoption across real commit volume, so a champion's approach is a pattern others can borrow rather than a one-off.";

/** Was AdoptionToolFootprint's trailing "detected via PR co-authorship / body markers". */
export const TOOLING_HINT =
  "Detected from PR co-authorship trailers and body markers, so this is what the fleet's pull requests reveal — not an inventory of what is installed.";

/** Was DeliveryStrip's "shown beside adoption, not a causal claim". */
export const DELIVERY_HINT =
  "Delivery health is shown beside adoption as context, never as its consequence: nothing here measures whether AI caused the movement.";

/** NEW disclosure. The spread is known at three thresholds only, which the old bar never admitted. */
export const CURVE_HINT =
  "The spread is measured at three thresholds only — none, any, and heavy. Between them the curve is bounded but not observed, so the band is hatched instead of interpolated.";

/** Was the panel's "commit-weighted" tile sub, expanded — a share with a withheld denominator. */
export const DENOMINATOR_HINT =
  "Below the naming floor the per-person rows are withheld, so the commit total behind this share is unavailable — the count is dropped rather than printed as a zero.";
