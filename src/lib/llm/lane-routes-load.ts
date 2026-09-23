// SERVER half of the lane-routing card: gathers the facts routeLanes() projects (the pure module +
// `-load.ts` sibling pattern that keeps the client boundary clean).
//
// Every fact comes from the resolver that actually answers the lane, never a hand list: the org's BYOM
// from resolveByomState, the kind -> provider mapping from the registry's byomDescriptor, the platform
// scan provider from getProvider, the platform text engine from resolveLegRunner, the narrative switch
// from briefingNarrativeEnabled. All of them are CONSTRUCTION ONLY: nothing here calls a model.
//
// What leaves this module is secret-free by construction: the BYOM projection keeps state, provider,
// model and region, and drops the decrypted API key and AWS credentials on the floor.

import { resolveByomState, type ByomResolution, type OrgLlmConfigPublic } from "@/lib/db/org-llm";
import { getProvider } from "@/lib/llm";
import { byomDescriptor } from "@/lib/llm/registry";
import { resolveLegRunner } from "@/lib/llm/text";
import { briefingNarrativeEnabled } from "@/lib/org/briefing-narrative";
import { LANE_ROUTING, previewByom, routeLanes, type ByomFact, type LaneFacts, type LaneRow } from "@/lib/llm/lane-routes";

export interface LaneRouting {
  /** Where each lane runs for this org now. */
  current: LaneRow[];
  /** Where each lane would run if the saved-but-not-enabled provider were switched on; else null. */
  preview: LaneRow[] | null;
}

/** ByomResolution -> ByomFact: the provider name comes from the registry's own mapping. */
export function projectByom(resolution: ByomResolution): ByomFact {
  if (resolution.state !== "active") return { state: resolution.state };
  const { params } = resolution;
  const descriptor = byomDescriptor(params);
  return {
    state: "active",
    kind: descriptor.name,
    model: descriptor.model,
    region: params.kind === "bedrock" ? (params.region ?? null) : null,
  };
}

async function loadLaneFacts(slug: string): Promise<LaneFacts> {
  // Un-caught on purpose, like getProviderForOrg: "couldn't tell" must not read as "no BYOM".
  const byom = projectByom(await resolveByomState(slug));
  const scan = getProvider();
  const text = await resolveLegRunner({ legKind: LANE_ROUTING.memory.legKind });
  return {
    byom,
    platform: {
      scan: { engine: scan.name, model: scan.model },
      text: text ? { engine: text.engine, model: text.model } : null,
    },
    briefingEnabled: briefingNarrativeEnabled(),
  };
}

/**
 * The card's data, or null when the org's routing cannot be determined (the BYOM state is unreadable,
 * or LLM_PROVIDER is misconfigured). Null is rendered as "could not be read", never as a platform guess.
 */
export async function loadLaneRouting(slug: string, config: OrgLlmConfigPublic | null): Promise<LaneRouting | null> {
  try {
    const facts = await loadLaneFacts(slug);
    const hypothetical = previewByom(config);
    return {
      current: routeLanes(facts),
      preview: hypothetical ? routeLanes({ ...facts, byom: hypothetical }) : null,
    };
  } catch {
    return null;
  }
}
