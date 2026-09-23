// FLEET POINTING, derived from the header rows the conformance sweep already writes (one per swept
// repo). PURE: no I/O, no clock of its own, so the loader and its tests read the same arithmetic.
//
// A repo POINTS here when its manifest's `registry.remote` names this registry (case-insensitive:
// GitHub names are). Every swept repo that does not is named with its reason, because "27/34
// pointing" is not a to-do list and "acme/api points at other/registry" is:
//   elsewhere   - the manifest names a DIFFERENT registry (a real, different state from none)
//   no-pointer  - the manifest was read and has no `registry.remote`
//   no-manifest - the sweep found no `.ai/manifest.yaml` at all
//
// Measurement honesty (the rules this file exists to keep):
//   - no rows at all is NEVER-SWEPT: the result carries no pointing / synced keys, never a 0;
//   - a row with a manifest but a NULL pointer was swept before the pointer was read, so it is
//     counted with the unswept, never as "no pointer";
//   - "synced 30d" is a pointing repo whose `.ai/registry-map.json` was regenerated inside the
//     window. A map-less repo's `generatedAt` is the sweep time, so `mapSha` must be present too.
// Adoption by hash (in_sync / stale / diverged / local_only) is NOT derived here: nothing reads each
// repo's `.claude/skills` against the catalog, and this file does not pretend to.

import type { ConformanceMapRow } from "@/lib/db/org-registry-conformance";

export const SYNC_WINDOW_DAYS = 30;

export type PointingState = "pointing" | "elsewhere" | "no-pointer" | "no-manifest";

export type FleetRosterEntry =
  | { repoFullName: string; state: "pointing" | "no-pointer" | "no-manifest" }
  | { repoFullName: string; state: "elsewhere"; remote: string };

/** The header fields this derivation reads. */
export type FleetMapRow = Pick<ConformanceMapRow, "repoFullName" | "mapSha" | "generatedAt" | "hasManifest" | "registryRemote">;

export interface FleetPointing {
  reposPointing: number;
  reposSynced30d: number;
  /** Repos in the fleet whose pointer has not been read: never swept, or swept before it was kept. */
  unswept: number;
  /** One entry per swept repo whose pointer was read: the ones needing work first, then by name. */
  roster: FleetRosterEntry[];
}

const ORDER: Record<PointingState, number> = { elsewhere: 0, "no-pointer": 1, "no-manifest": 2, pointing: 3 };

function stateOf(m: FleetMapRow, registry: string): FleetRosterEntry | null {
  const name = m.repoFullName;
  // The registry repo cannot carry a pointer to itself; it is the thing pointed at.
  if (name.toLowerCase() === registry) return { repoFullName: name, state: "pointing" };
  if (!m.hasManifest) return { repoFullName: name, state: "no-manifest" };
  const remote = m.registryRemote ?? null;
  if (remote === null) return null; // swept before the pointer was kept: unmeasured
  if (remote === "") return { repoFullName: name, state: "no-pointer" };
  if (remote.toLowerCase() === registry) return { repoFullName: name, state: "pointing" };
  return { repoFullName: name, state: "elsewhere", remote };
}

/**
 * `{}` when nothing was read (never swept, or every row predates the pointer column), so the
 * caller's "unmeasured" shape survives a spread. Otherwise the counts and the roster.
 */
export function fleetPointing(input: {
  maps: FleetMapRow[];
  registryFullName: string;
  reposTotal: number;
  now: Date | number;
}): Partial<FleetPointing> {
  const registry = input.registryFullName.toLowerCase();
  const now = typeof input.now === "number" ? input.now : input.now.getTime();
  const cutoff = now - SYNC_WINDOW_DAYS * 86_400_000;
  const roster: FleetRosterEntry[] = [];
  let synced = 0;
  for (const m of input.maps) {
    const entry = stateOf(m, registry);
    if (!entry) continue;
    roster.push(entry);
    if (entry.state === "pointing" && m.mapSha !== null && Date.parse(m.generatedAt) >= cutoff) synced += 1;
  }
  if (!roster.length) return {};
  roster.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.repoFullName.localeCompare(b.repoFullName));
  return {
    reposPointing: roster.filter((e) => e.state === "pointing").length,
    reposSynced30d: synced,
    unswept: Math.max(0, input.reposTotal - roster.length),
    roster,
  };
}
