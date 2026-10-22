// The heavy-hitter /org capabilities featured on /about — the money-savers, in narrative order. Each
// is paired with a live animated diagram (by id) in AboutLanding, not a decorative image.
//
// NUMBERS ARE IMPORTED, NEVER TYPED. The dimension count read "nine" as a word in two of these
// strings, which is a count that survives a rubric change silently — the landing hero and
// DimensionMatrix have read `DIMENSIONS` from the model since they were written, and this file was
// the one place on the same deck that didn't.

import { DIMENSIONS } from "@/lib/maturity/model";
import type { AnchoredFeature, ClaimAnchor } from "./claimAnchors";

export type AboutFeatureId = "xray" | "roi" | "adoption" | "risk";

interface AboutFeatureData extends AnchoredFeature {
  id: AboutFeatureId;
  kicker: string;
  title: string;
  body: string;
  points: string[];
  /** The money line — the one-sentence cost/ROI takeaway. */
  value: string;
}

// Every claim names the capability it rests on (src/components/about/claimAnchors.ts); the claim gate
// fails the suite when one of them retires or becomes an alias. Shorthands for the anchors below:
const tab = (id: Extract<ClaimAnchor, { tab: unknown }>["tab"]): ClaimAnchor => ({ tab: id });
const DEMO: ClaimAnchor = { illustrative: true };

export const ABOUT_FEATURES: AboutFeatureData[] = [
  {
    id: "xray",
    kicker: "See the whole fleet",
    title: "Every repo's AI-readiness, on one index",
    body: `Ascent scores each repository 0–100 across ${DIMENSIONS.length} dimensions, then rolls your whole org into one picture: by segment, by team, by posture. Know exactly where you stand before you spend a dollar moving.`,
    points: [
      `${DIMENSIONS.length} scored dimensions distilled to one comparable index`,
      "Slice the fleet by segment (platform, mobile, legacy) and compare side by side",
      "A posture map that separates “fast & ungoverned” from “solid but manual”",
    ],
    value: "Stop guessing which teams are ready to accelerate and which are quietly compounding risk.",
    anchors: {
      body: [tab("repositories"), tab("segments"), tab("teams"), tab("executive")],
      points: [[tab("repositories")], [tab("segments")], [tab("executive")]],
    },
  },
  {
    id: "roi",
    kicker: "Model before you spend",
    title: "See the payoff before you commit the budget",
    // Copy contract with the paired RoiSimulator diagram: the bullets promise only what the demo
    // beside them substantiates (live promotions / avg gain / scope), and are anchored as illustrative.
    // The body's second sentence names what ships inside /org today. It used to sell the org what-if
    // simulator, leverage ranking and settable goals; all three retired with the Plan tab on
    // 2026-08-17 (src/lib/db/plan.ts, foot note), and the deck kept selling them until 2026-10-22.
    body: "The what-if demo recomputes the entire fleet under a hypothetical fix (raise testing, CI/CD, and conventions across these repos) and shows how many repos level up. Inside /org, the Proposals ledger marks the gaps open across much of the fleet so one practice fixes them in a batch, and the Briefing reads what each cycle delivered.",
    points: [
      "Drag a target and watch promotions, average gain, and scope recompute live",
      "In /org, the Proposals ledger surfaces the fix-once, apply-fleet-wide gaps",
      "Skip the low-impact fix that moves two repos, not twenty",
    ],
    // Money line names the demo tiles. A dated "6 of 8 repos to L3 by Q3" was a
    // count the sliders never compute (GOLDEN-TRIO: do not lead with ROI).
    value: "Turn a guess about a fix into live promotions, average gain, and repos in scope.",
    anchors: {
      body: [DEMO, tab("proposals"), tab("practices"), tab("executive")],
      points: [[DEMO], [tab("proposals"), tab("practices")], [DEMO]],
    },
  },
  {
    id: "adoption",
    kicker: "Spread what works",
    title: "Turn your AI champions into a force multiplier",
    body: "Ascent attributes AI-assisted work per contributor and surfaces your champions (the people already shipping at a high AI share) right next to the teams sitting at zero. Pair them, and adoption spreads by example, not by mandate.",
    points: [
      "Per-contributor AI attribution and an adoption distribution",
      "Find the champions who can lead peer enablement",
      "Read adoption against real delivery signals: merge rate, PR review",
    ],
    value: "Replace expensive top-down training with the champions you already employ.",
    anchors: {
      body: [tab("contributors"), tab("teams")],
      points: [[tab("contributors"), tab("adoption")], [tab("contributors")], [tab("delivery")]],
    },
  },
  {
    id: "risk",
    kicker: "Catch it early",
    title: "Spot ungoverned AI risk before it costs you",
    body: "A security gate bands every repo by its security score, flags “ungoverned” repos (high AI velocity, weak review gates) and aggregates supply-chain alerts across the fleet. Period-over-period detection raises the alarm the moment a repo regresses.",
    points: [
      "Security gate and supply-chain alerts in a single view",
      "A regression alarm on any repo that slips a level",
      "Governance evidence ready for audits and security reviews",
    ],
    value: "Avoid the failed audit, the breach, and the 2 a.m. incident before they happen.",
    anchors: {
      body: [tab("security"), tab("governance")],
      points: [[tab("security")], [tab("security"), tab("overview")], [tab("governance"), tab("audit")]],
    },
  },
];
