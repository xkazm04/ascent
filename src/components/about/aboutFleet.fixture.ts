// Test-only fixture for the /about live-fleet tests (aboutFleetModel, FleetGrid, RoiSimulator). Each card's
// overall is computed by the engine from its own dimensions + archetype, as a real gallery card's is.

import type { PublicRepoCard, PublicScanGallery } from "@/lib/db";
import { levelForScore, overallScoreFor } from "@/lib/maturity/model";
import type { DimensionId, RepoArchetype } from "@/lib/types";

const POSTURES = ["ai-native", "ungoverned", "manual"] as const;
const ARCHETYPES: RepoArchetype[] = ["solo", "team", "org"];

export function liveCard(i: number, over: Partial<PublicRepoCard> = {}): PublicRepoCard {
  const dimensions: Partial<Record<DimensionId, number>> = {
    D1: 20 + ((i * 13) % 60),
    D2: 10 + ((i * 7) % 50),
    D3: 30 + ((i * 11) % 40),
    D4: 15 + ((i * 5) % 30),
    D5: 40,
    D6: 35 + ((i * 3) % 30),
    D7: 50,
    D8: 25,
    D9: 45,
  };
  const archetype = ARCHETYPES[i % ARCHETYPES.length]!;
  const scored = Object.entries(dimensions).map(([id, score]) => ({ id: id as DimensionId, score: score! }));
  const overall = overallScoreFor(scored, archetype);
  const lvl = levelForScore(overall);
  return {
    owner: "acme",
    name: `repo-${i}`,
    fullName: `acme/repo-${i}`,
    level: lvl.id,
    levelName: lvl.name,
    overall,
    adoption: 50,
    rigor: 50,
    dimensions,
    posture: POSTURES[i % POSTURES.length]!,
    primaryLanguage: "TypeScript",
    stars: i,
    scannedAt: `2026-10-${String(10 + i).padStart(2, "0")}T08:00:00.000Z`,
    href: `/report/acme/repo-${i}`,
    rubricVersion: "current",
    currentRubric: true,
    verified: true,
    archetype,
    ...over,
  };
}

export const galleryOf = (recent: PublicRepoCard[]): PublicScanGallery => ({
  recent,
  topAiNative: [],
  totalRepos: recent.length,
  dbMode: "static" as PublicScanGallery["dbMode"],
});

export const liveGallery = (n: number): PublicScanGallery =>
  galleryOf(Array.from({ length: n }, (_, i) => liveCard(i)));
