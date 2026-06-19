// The heavy-hitter /org capabilities featured on /about — the money-savers, in narrative order. Each
// is paired with a live animated diagram (by id) in AboutLanding, not a decorative image.

export type AboutFeatureId = "xray" | "roi" | "adoption" | "risk";

export interface AboutFeatureData {
  id: AboutFeatureId;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  /** The money line — the one-sentence cost/ROI takeaway. */
  value: string;
}

export const ABOUT_FEATURES: AboutFeatureData[] = [
  {
    id: "xray",
    kicker: "See the whole fleet",
    title: "Every repo's AI-readiness, on one index",
    body: "Ascent scores each repository 0–100 across nine dimensions, then rolls your whole org into one picture — by segment, by team, by posture. Know exactly where you stand before you spend a dollar moving.",
    points: [
      "Nine scored dimensions distilled to one comparable index",
      "Slice the fleet by segment — platform, mobile, legacy — and compare side by side",
      "A posture map that separates “fast & ungoverned” from “solid but manual”",
    ],
    value: "Stop guessing which teams are ready to accelerate — and which are quietly compounding risk.",
  },
  {
    id: "roi",
    kicker: "Model before you spend",
    title: "See the payoff before you commit the budget",
    body: "The what-if simulator recomputes the entire fleet under a hypothetical fix — raise testing, CI/CD, and conventions across these repos — and shows how many repos level up, which goals it unlocks, and when. The highest-leverage moves are ranked by how many repos they touch.",
    points: [
      "Project promotions and goal ETAs before the work starts",
      "Leverage ranking surfaces fix-once, apply-fleet-wide moves",
      "Skip the low-impact initiative that moves two repos, not twenty",
    ],
    value: "Turn “we think this will help” into “this moves 6 of 8 repos to L3 by Q3.”",
  },
  {
    id: "adoption",
    kicker: "Spread what works",
    title: "Turn your AI champions into a force multiplier",
    body: "Ascent attributes AI-assisted work per contributor and surfaces your champions — the people already shipping at a high AI share — right next to the teams sitting at zero. Pair them, and adoption spreads by example, not by mandate.",
    points: [
      "Per-contributor AI attribution and an adoption distribution",
      "Find the champions who can lead peer enablement",
      "Read adoption against real delivery signals — merge rate, PR review",
    ],
    value: "Replace expensive top-down training with the champions you already employ.",
  },
  {
    id: "risk",
    kicker: "Catch it early",
    title: "Spot ungoverned AI risk before it costs you",
    body: "A security gate bands every repo by its security score, flags “ungoverned” repos — high AI velocity, weak review gates — and aggregates supply-chain alerts across the fleet. Period-over-period detection raises the alarm the moment a repo regresses.",
    points: [
      "Security gate and supply-chain alerts in a single view",
      "A regression alarm on any repo that slips a level",
      "Governance evidence ready for audits and security reviews",
    ],
    value: "Avoid the failed audit, the breach, and the 2 a.m. incident — before they happen.",
  },
];
