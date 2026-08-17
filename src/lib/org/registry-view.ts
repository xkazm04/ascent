// The Registry tab's read model — ONE shape every variant renders (docs/REGISTRY-AND-CARE-IMPL.md §4).
//
// The registry is a CUSTOMER-OWNED repo (`<org>/ai-registry`); ascent onboards it, indexes it and
// tracks how the fleet syncs against it. Until R2 lands there is no `OrgRegistry` table, so the real
// loader here is deliberately HONEST: it reports `unmapped` with the counts we can already read
// cheaply (hosted Skills / Memory rows, the fleet repo count) and zeroes everything that would
// require the indexer. No fabricated numbers reach the UI on the real path — the rich states come
// from `registry-view.fixture.ts`, selected by `?demo=`.
//
// JSX-free on purpose: imported by the server tab AND by the pure model helpers the client variants
// use (registryModel.ts).

import { getOrgRollup, listOrgMemories, listOrgSkills } from "@/lib/db";
import { fixtureRegistryView } from "./registry-view.fixture";

export type RegistryStatus = "unmapped" | "scaffolding" | "scaffold_pr_open" | "indexed" | "error";
export type RegistryMode = "git_native" | "hosted_mirror";
export type TelemetrySink = "api" | "registry" | "off";

/** One artifact type's move out of ascent's tables and into the registry repo. */
export type MigrationStep = {
  state: "not-started" | "pr-open" | "merged" | "n/a";
  prUrl?: string;
  moved: number;
  total: number;
};

export type RegistryArtifact = "skills" | "practices" | "memory";

export type RegistryActivityKind = "skill-version" | "lesson" | "practice" | "memory" | "catalog" | "index";

export type RegistryActivityEntry = {
  at: string;
  kind: RegistryActivityKind;
  title: string;
  url?: string;
};

/** A repo the App can already see, offered in the "map an existing repo" picker (step 1). */
export type RegistryCandidate = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  /** Already has a recognizable `skills/` + `.ascent/registry.yaml` layout. */
  hasLayout: boolean;
  pushedAt: string;
};

export type RegistryView = {
  status: RegistryStatus;
  registry?: {
    fullName: string;
    url: string;
    defaultBranch: string;
    canonical: boolean;
    mode: RegistryMode;
    telemetrySink: TelemetrySink;
    lastIndexedAt: string | null;
    lastIndexSha: string | null;
    catalogSha: string | null;
    webhookHealthy: boolean;
  };
  counts: {
    skills: { registry: number; hostedOnly: number };
    practices: { registry: number; hostedOnly: number };
    memory: { registry: number; hostedOnly: number };
    lessons: number;
  };
  migration: Record<RegistryArtifact, MigrationStep>;
  fleet: {
    reposTotal: number;
    reposPointing: number;
    reposSynced30d: number;
    adoption: { inSync: number; stale: number; diverged: number; localOnly: number };
  };
  /** Last 20, newest first. */
  activity: RegistryActivityEntry[];
  telemetry: { invokes30d: number; reposReporting: number; sink: TelemetrySink };
  howTo: { syncCmd: string; hooksCmd: string; pointer: string };

  // ── Additive fields the three prototype directions need for the edge cases the brief names ──
  /** Step 2 of the stepper: does the App hold `contents:write` on the chosen repo? */
  permission: { contentsWrite: boolean; installUrl?: string };
  /** Populated only when `status === "scaffold_pr_open"` / `"scaffolding"`. */
  scaffoldPrUrl?: string;
  /** Populated only when `status === "error"` — what the last index attempt said. */
  error?: { message: string; at: string };
  /** The "map an existing repo" picker's options. Empty until the App's repo list is read. */
  candidates: RegistryCandidate[];
};

export const DEFAULT_REGISTRY_NAME = "ai-registry";

/** The developer-facing commands + manifest pointer. Same strings on every path, real or fixture. */
export function registryHowTo(registryFullName: string): RegistryView["howTo"] {
  return {
    syncCmd: "npx ascent skills sync",
    hooksCmd: "npx ascent hooks install",
    pointer: `skills.registry: github:${registryFullName}`,
  };
}

function emptyMigration(totals: Record<RegistryArtifact, number>): RegistryView["migration"] {
  const step = (total: number): MigrationStep => ({ state: "not-started", moved: 0, total });
  return { skills: step(totals.skills), practices: step(totals.practices), memory: step(totals.memory) };
}

/**
 * The tab's loader. `opts.demo` selects a fixture view (the prototype round's edge-case switch); with
 * no `demo` the real — currently always `unmapped` — view is assembled from what is genuinely readable
 * today. Never throws: a persistence-off workspace degrades to zeroes, not an error panel.
 */
export async function getRegistryView(slug: string, opts: { demo?: string } = {}): Promise<RegistryView> {
  const fixture = fixtureRegistryView(slug, opts.demo);
  if (fixture) return fixture;

  const [skills, memories, rollup] = await Promise.all([
    listOrgSkills(slug).catch(() => null),
    listOrgMemories(slug).catch(() => null),
    getOrgRollup(slug).catch(() => null),
  ]);

  // Everything hosted in ascent's tables today is, by definition, "hosted only": nothing is in a
  // registry until one is mapped. Practices have no cheap org-scoped count yet (the shapes are
  // resolved per dimension) — reported as 0 rather than guessed.
  const hostedSkills = skills?.length ?? 0;
  const hostedMemory = memories?.length ?? 0;
  const totals: Record<RegistryArtifact, number> = { skills: hostedSkills, practices: 0, memory: hostedMemory };

  return {
    status: "unmapped",
    counts: {
      skills: { registry: 0, hostedOnly: hostedSkills },
      practices: { registry: 0, hostedOnly: 0 },
      memory: { registry: 0, hostedOnly: hostedMemory },
      lessons: 0,
    },
    migration: emptyMigration(totals),
    fleet: {
      reposTotal: rollup?.repos?.length ?? 0,
      reposPointing: 0,
      reposSynced30d: 0,
      adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 },
    },
    activity: [],
    telemetry: { invokes30d: 0, reposReporting: 0, sink: "off" },
    howTo: registryHowTo(`${slug}/${DEFAULT_REGISTRY_NAME}`),
    permission: { contentsWrite: false },
    candidates: [],
  };
}
