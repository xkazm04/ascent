// The /about-org module map's content, DERIVED from the org dashboard's real nav catalog.
//
// The point of this file is that it cannot describe a product that doesn't exist. Group names, group
// order, tab names and tab order all come from `ORG_NAV_GROUPS` (src/lib/org/orgTabs.ts) — the same
// constant the shipping rail renders — and the hrefs come from `orgTabHref`, the same builder every
// in-app link uses. All this module adds is one marketing sentence per view, keyed by `OrgTabId`.
//
// A marketing page that hand-copies a feature list is a page that is wrong within two sprints: rename
// a tab, add a module, merge two views, and the copy quietly keeps selling last quarter's product.
// Here a rename flows through automatically, and an ADDED tab fails `orgModules.test.ts` (which pins
// that every nav tab has a blurb) rather than silently going unmentioned.

import { ORG_NAV_GROUPS, orgTabHref, type OrgTabId } from "@/lib/org/orgTabs";
import { DEMO_ORG_SLUG } from "@/lib/site";

/**
 * One line per view: what a reader gets from opening it. Keyed by the canonical tab id, so this is a
 * *description* of the nav rather than a second copy of it.
 *
 * Settings is deliberately covered too — an "everything in the box" map that quietly omits the boring
 * rows reads as a highlight reel, and a buyer comparing products notices the gap, not the polish.
 */
const BLURBS: Record<OrgTabId, string> = {
  overview: "The fleet's headline read: maturity, adoption vs rigor, trajectory, gap analysis and the highest-leverage moves.",
  followups: "Every open gap across the fleet in one ledger: filter, pick a batch, get one fix prompt for your local agent, and let the next scan close what landed.",
  executive: "The briefing built for the meeting you have to walk into: what moved, what it cost, what to decide.",
  repositories: "Every repo ranked by level, adoption, rigor and posture, plus a repo × dimension heatmap, and your own fleet segments.",
  segments: "Slice the fleet your way (platform, mobile, legacy) with per-segment rollups and side-by-side comparison.",
  "tech-stacks": "Per-stack maturity profiles, A-vs-B stack comparison, and a dimension board that says where stacks diverge.",
  passports: "A one-page passport per repository: what it is, how it scores, and what it needs next.",
  live: "The war-room wall: scores landing in real time as the fleet is scanned.",
  security: "Security posture across the fleet, banded by score, with supply-chain alerts aggregated in one place.",
  adoption: "Where AI tooling, agents and shared conventions have actually taken hold, and where they haven't.",
  delivery: "PR signals, branch governance, and day-by-day delivery trends: review coverage, merge rate, time to merge.",
  contributors: "AI champions, involvement, key-person exposure and per-repo bus factor.",
  teams: "Per-team (CODEOWNERS) adoption × rigor, dimension shape, movers, and a suggested cross-team pairing.",
  practices: "The practice library: turn a gap into a starter artifact and open it as a draft PR, one repo or many.",
  registry:
    "Put your skills, practices and org memory in a git repo you own; ascent onboards it, indexes it, and shows which repos are in sync.",
  skills: "A versioned SKILL.md library your org authors, adopts against repos, and syncs with CLI and CI.",
  knowledge: "The Reference Knowledge Bundles your registry publishes, counted by domain across the three layers that ship — golden paths, techniques and applications — so you can see where the org's written knowledge is concentrated.",
  memory: "Durable org knowledge (decisions, incidents and conventions) recalled by value, corrected by supersede. Your agents can read it too, over scoped API tokens.",
  developer: "Your own page, not the org's view of you: your commits and AI-attributed share, the open gaps of the repos you touch, and the care loop you keep — private by default, and only ever aggregated above a floor.",
  members: "Who is in the org and what they can do.",
  governance: "Branch protection, review gates and rulesets, audited across every repository.",
  integrations: "Connect your AI coding providers so measured usage lands beside the git-side signals.",
  pairing:
    "Self-hosted only: pair each repo with its working copy on your machine, so scans read from disk and your local agent's commits close follow-ups before they are even pushed.",
  audit: "A searchable, paginated trail of every consequential action taken in the org.",
  settings: "Org-level configuration: alert thresholds, gate policy, retention, LLM provider.",
};

export interface AboutOrgView {
  id: OrgTabId;
  label: string;
  blurb: string;
  /** Deep link into the curated demo org's real view — not a screenshot, the actual page. */
  href: string;
}

export interface AboutOrgModule {
  key: string;
  label: string;
  views: AboutOrgView[];
}

/** The modules, in the rail's own order, each carrying its real views. */
export const ABOUT_ORG_MODULES: AboutOrgModule[] = ORG_NAV_GROUPS.map((group) => ({
  key: group.key,
  label: group.label,
  views: group.items.map((item) => ({
    id: item.id,
    label: item.label,
    blurb: BLURBS[item.id],
    href: orgTabHref(DEMO_ORG_SLUG, item.id),
  })),
}));

/** Headline counts for the masthead ledger — derived, so they can never contradict the map below. */
export const MODULE_COUNT = ABOUT_ORG_MODULES.length;
export const VIEW_COUNT = ABOUT_ORG_MODULES.reduce((n, m) => n + m.views.length, 0);

/** Every id this page claims to describe. Exported for the drift test. */
export const DESCRIBED_TAB_IDS: OrgTabId[] = Object.keys(BLURBS) as OrgTabId[];
