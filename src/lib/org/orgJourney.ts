// The Org path of use, declared once. Operator-chosen journey B (docs/adr/2026-09-14-org-path-of-use.md,
// "Decision outcome 2026-10-05"): a first-run path Connect -> Scan, walked once, then a returning loop
// Read -> Decide -> Apply -> Measure -> back to Read.
//
// No JSX, no client hooks: pure data plus one pure function, importable from the rail, the tour, the
// /about-org loop page and any tab that writes a next-move link. Only types and constants are taken
// from ./orgTabs, so this module can never become part of an import cycle with the tab catalog.
//
// Always `proposals`, never the `followups` alias: the alias redirects, and a link written against it
// is invisible to the link-graph pins.

import type { OrgTabId } from "./orgTabs";

export const ORG_STAGE_IDS = ["connect", "scan", "read", "decide", "apply", "measure"] as const;

export type OrgStageId = (typeof ORG_STAGE_IDS)[number];

export interface OrgStage {
  id: OrgStageId;
  label: string;
  /** The tab a user arriving from the previous stage lands on — and the target of its next-move link. */
  entryTab: OrgTabId;
  /** True for the stages walked once on the way in; false for the returning loop. */
  firstRun: boolean;
}

/** The six stages, in walking order. After Measure the loop returns to Read, never to Connect. */
export const ORG_STAGES: readonly OrgStage[] = [
  { id: "connect", label: "Connect", entryTab: "registry", firstRun: true },
  { id: "scan", label: "Scan", entryTab: "repositories", firstRun: true },
  { id: "read", label: "Read", entryTab: "overview", firstRun: false },
  { id: "decide", label: "Decide", entryTab: "proposals", firstRun: false },
  { id: "apply", label: "Apply", entryTab: "live", firstRun: false },
  { id: "measure", label: "Measure", entryTab: "executive", firstRun: false },
];

/** Every on-rail tab id, assigned to exactly one stage. Aliases and sub-views (`followups`,
 *  `segments`, `developer`) are deliberately absent: they are not rail items. */
export const ORG_TAB_STAGE: Readonly<Partial<Record<OrgTabId, OrgStageId>>> = {
  registry: "connect",
  members: "connect",
  integrations: "connect",
  pairing: "connect",
  settings: "connect",
  repositories: "scan",
  passports: "scan",
  overview: "read",
  "tech-stacks": "read",
  security: "read",
  governance: "read",
  proposals: "decide",
  lessons: "decide",
  practices: "decide",
  skills: "decide",
  live: "apply",
  memory: "apply",
  knowledge: "apply",
  surfaces: "apply",
  audit: "apply",
  executive: "measure",
  digest: "measure",
  adoption: "measure",
  delivery: "measure",
  contributors: "measure",
  teams: "measure",
};

const STAGE_BY_ID: ReadonlyMap<OrgStageId, OrgStage> = new Map(ORG_STAGES.map((s) => [s.id, s]));

/** Where a stage leads. Scan enters the loop at Read, and Measure wraps back to Read (not to Connect). */
const NEXT_STAGE: Readonly<Record<OrgStageId, OrgStageId>> = {
  connect: "scan",
  scan: "read",
  read: "decide",
  decide: "apply",
  apply: "measure",
  measure: "read",
};

export function stageOf(tabId: OrgTabId): OrgStage | undefined {
  const id = ORG_TAB_STAGE[tabId];
  return id ? STAGE_BY_ID.get(id) : undefined;
}

/**
 * The next-move rule, stated once: a tab's next move is the entry tab of the NEXT stage. Returns
 * `undefined` for an id with no stage (an alias or sub-view), which has no move of its own.
 */
export function nextMoveFor(tabId: OrgTabId): OrgTabId | undefined {
  const stage = ORG_TAB_STAGE[tabId];
  return stage ? STAGE_BY_ID.get(NEXT_STAGE[stage])?.entryTab : undefined;
}
