// WHERE EVERY LLM LANE RUNS, for one org: a declared routing table and a pure projection over it.
//
// An owner who connects Bedrock "so inference stays in our AWS account" used to decide blind. Scans,
// Athena and the board narrative resolve through the ORG seam (getProviderForOrg / text-org.ts) and
// move to the org's provider; Shared Org Memory's passes and the loop's lane summaries resolve through
// the PLATFORM seam (resolveTextRunner) on purpose, and keep calling the platform vendor with that
// org's content. The app answered all five questions on every call and showed none of them.
//
// The table is DECLARED, not inferred, because the Settings card also answers "what would switching
// BYOM on move?" without switching anything on: a hypothetical only a declaration can answer. It is
// trustworthy because lane-routes.contract.test.ts drives each lane's REAL resolver under a mocked
// active BYOM and fails when a lane's call site stops matching its row. Change a lane's routing there
// first; this file only describes it.
//
// Pure and client-safe: type-only imports, no env, no I/O. The facts come from lane-routes-load.ts.

import type { LlmLegKind } from "@/lib/llm/leg";
import type { ProviderName } from "@/lib/types";
import type { OrgLlmConfigPublic } from "@/lib/db/org-llm";

/** The lanes, in the order the card lists them: the ones BYOM moves first. */
export const LANE_IDS = ["scans", "athena", "briefing", "memory", "laneSummary"] as const;
export type LaneId = (typeof LANE_IDS)[number];

export interface LaneRoute {
  /** The leg kind the lane's calls are tagged with (one of the seam's own vocabulary). */
  legKind: LlmLegKind;
  /** True when the lane resolves through the org seam, so an active BYOM answers it. */
  honorsByom: boolean;
  /** What the lane does when the org's BYOM is enabled but its credentials cannot be resolved:
   *  `blocked` fails closed (no platform fallback); `template` degrades to deterministic output.
   *  null for a lane that never consults the org's BYOM. */
  onUnresolvable: "blocked" | "template" | null;
}

export const LANE_ROUTING: Record<LaneId, LaneRoute> = {
  scans: { legKind: "scan", honorsByom: true, onUnresolvable: "blocked" },
  // Athena's interactive turns and her unattended cycle both go through the org seam (tool-loop.ts).
  athena: { legKind: "athena_turn", honorsByom: true, onUnresolvable: "blocked" },
  briefing: { legKind: "briefing", honorsByom: true, onUnresolvable: "template" },
  // Deliberately platform-only (consolidation-engine.ts / lane-summary.ts): which vendor sees memory
  // content is a provider decision nobody has made yet. The card shows it; it does not change it.
  memory: { legKind: "memory", honorsByom: false, onUnresolvable: null },
  laneSummary: { legKind: "lane_summary", honorsByom: false, onUnresolvable: null },
};

/** A secret-free projection of the org's BYOM resolution: what may cross to a client. */
export type ByomFact =
  | { state: "inactive" }
  | { state: "unresolvable" }
  | { state: "active"; kind: "openrouter" | "bedrock"; model: string; region?: string | null };

export interface EngineFact {
  engine: ProviderName;
  model: string;
}

export interface LaneFacts {
  byom: ByomFact;
  platform: {
    /** The deployment's scan provider (getProvider): always constructs, `mock` at the floor. */
    scan: EngineFact;
    /** The deployment's text engine (resolveLegRunner), or null when none is reachable here. */
    text: EngineFact | null;
  };
  /** BRIEFING_NARRATIVE: the board narrative is opt-in per deployment. */
  briefingEnabled: boolean;
}

/** Whose account answers: the org's own vendor, the Ascent platform, or no model at all. */
export type LaneAccount = "yours" | "platform" | "none";
export type LaneState = "runs" | "blocked" | "template" | "off" | "no-engine";

export interface LaneRow {
  lane: LaneId;
  engine: ProviderName | null;
  model: string | null;
  account: LaneAccount;
  state: LaneState;
  /** A BYOM is enabled for this org and this lane still does not use it. */
  bypassesByom: boolean;
}

function quiet(lane: LaneId, state: LaneState, bypassesByom: boolean): LaneRow {
  return { lane, engine: null, model: null, account: "none", state, bypassesByom };
}

/** One row per lane, in LANE_IDS order. */
export function routeLanes(facts: LaneFacts): LaneRow[] {
  const byom = facts.byom;
  return LANE_IDS.map((lane): LaneRow => {
    const route = LANE_ROUTING[lane];
    const bypassesByom = !route.honorsByom && byom.state !== "inactive";
    if (lane === "briefing" && !facts.briefingEnabled) return quiet(lane, "off", false);
    if (route.honorsByom && byom.state === "active") {
      // A BYOM kind IS its provider name (registry.ts byomDescriptor); the contract test pins that.
      return { lane, engine: byom.kind, model: byom.model, account: "yours", state: "runs", bypassesByom };
    }
    if (route.onUnresolvable && byom.state === "unresolvable") return quiet(lane, route.onUnresolvable, false);
    const fact = route.legKind === "scan" ? facts.platform.scan : facts.platform.text;
    if (!fact) return quiet(lane, "no-engine", bypassesByom);
    // The mock is deterministic and in-process: no vendor account answers it.
    const account: LaneAccount = fact.engine === "mock" ? "none" : "platform";
    return { lane, engine: fact.engine, model: fact.model, account, state: "runs", bypassesByom };
  });
}

/**
 * The BYOM a saved-but-not-switched-on provider WOULD resolve to, for the "If switched on" column; null
 * when there is nothing to preview (no saved config, no credential, or it is already on).
 */
export function previewByom(config: OrgLlmConfigPublic | null): ByomFact | null {
  if (!config || config.enabled || !config.hasCredentials) return null;
  if (config.provider !== "openrouter" && config.provider !== "bedrock") return null;
  return { state: "active", kind: config.provider, model: config.modelId, region: config.region };
}
