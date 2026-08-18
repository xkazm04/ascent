// The Registry tab's read model — ONE shape the panel renders (docs/REGISTRY-AND-CARE-IMPL.md §4).
//
// The registry is a CUSTOMER-OWNED repo (`<org>/ai-registry`); ascent onboards it, indexes it and
// tracks how the fleet syncs against it. This loader reads the `OrgRegistry` row and the indexed
// mirror counts, falling back to an honest `unmapped` view. Anything the indexer cannot yet observe
// (fleet pointers, sync recency, invoke telemetry) is reported as ZERO rather than guessed.
// `capabilities` is what the UI gates GitHub actions on (§0b.5) — see @/lib/registry/capabilities.
//
// THIS MODULE IS SERVER-ONLY and returns ONLY real data. The shaped example states live in
// `registry-view.fixture.ts` and are selected in REACT STATE by the tab's preview shell — never by a
// search param, so a preview can never be bookmarked or shared as if it were someone's registry.

import { getOrgRollup } from "@/lib/db";
import { getOrgId } from "@/lib/db/org-rollup";
import { getOrgRegistry, type OrgRegistryRow } from "@/lib/db/org-registry";
import { countRegistryMirrors } from "@/lib/db/org-registry-write";
import { getRegistryCapabilities, type RegistryCapabilities } from "@/lib/registry/capabilities";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import { registryHowTo } from "./registry-howto";

export { DEFAULT_REGISTRY_NAME, registryHowTo };
export type { RegistryCapabilities };

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

  /** What ascent can ACTUALLY do for this viewer: render a GitHub action only when its flag is true
   *  — `canWrite` for scaffold / re-index / migrate, `canCreateRepo` for "create the repo". */
  capabilities: RegistryCapabilities;

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

const step = (total: number): MigrationStep => ({ state: "not-started", moved: 0, total });

/** The persisted migration state, with totals refreshed from the live hosted counts. */
function migrationOf(row: OrgRegistryRow | null, totals: Record<RegistryArtifact, number>): RegistryView["migration"] {
  const of = (t: RegistryArtifact) => {
    const saved = row?.migration?.[t];
    return saved ? { ...saved, total: saved.total || totals[t] } : step(totals[t]);
  };
  return { skills: of("skills"), practices: of("practices"), memory: of("memory") };
}

/** The header block, present only once a registry is mapped. */
const registryOf = (row: OrgRegistryRow): NonNullable<RegistryView["registry"]> => ({
  fullName: row.fullName,
  url: `https://github.com/${row.fullName}`,
  defaultBranch: row.defaultBranch,
  canonical: row.canonical,
  mode: row.mode,
  telemetrySink: row.telemetrySink,
  lastIndexedAt: row.lastIndexedAt,
  lastIndexSha: row.lastIndexSha,
  catalogSha: row.catalogSha,
  webhookHealthy: row.webhookHealthy,
});

/** Activity ascent can actually attest to: its own index passes and the catalog it wrote. */
function activityOf(row: OrgRegistryRow | null): RegistryActivityEntry[] {
  if (!row?.lastIndexedAt) return [];
  const url = `https://github.com/${row.fullName}`;
  const sha = row.lastIndexSha ? row.lastIndexSha.slice(0, 7) : "HEAD";
  const c = row.counts;
  const out: RegistryActivityEntry[] = [
    {
      at: row.lastIndexedAt,
      kind: "index",
      title:
        row.status === "error"
          ? `Index failed at ${sha}${row.lastError ? ` — ${row.lastError}` : ""}`
          : `Indexed at ${sha} — ${c.skills} skills · ${c.practices} practices · ${c.memory} notes`,
      url: `${url}/tree/${row.lastIndexSha ?? row.defaultBranch}`,
    },
  ];
  if (row.catalogSha) {
    out.push({ at: row.lastIndexedAt, kind: "catalog", title: "catalog.json indexed", url: `${url}/blob/${row.defaultBranch}/catalog.json` });
  }
  return out;
}

/**
 * The tab's loader. The view is assembled from the `OrgRegistry` row + mirror counts + fleet size and
 * degrades to an honest `unmapped` when no registry is mapped. Never throws: a persistence-off
 * workspace degrades to zeroes and `capabilities.reason = "persistence-off"`, not an error panel.
 */
export async function getRegistryView(slug: string): Promise<RegistryView> {
  const [row, capabilities, rollup, orgId] = await Promise.all([
    getOrgRegistry(slug).catch(() => null),
    getRegistryCapabilities(slug).catch(() => null),
    getOrgRollup(slug).catch(() => null),
    getOrgId(slug).catch(() => null),
  ]);
  const caps: RegistryCapabilities = capabilities ?? {
    appConfigured: false, installed: false, canWrite: false, canCreateRepo: false, reason: "app-not-configured", installUrl: null,
  };
  const zeroes = () => ({ skills: { registry: 0, hostedOnly: 0 }, practices: { registry: 0, hostedOnly: 0 }, memory: { registry: 0, hostedOnly: 0 } });
  const counts = orgId ? await countRegistryMirrors(orgId).catch(zeroes) : zeroes();
  const totals = { skills: counts.skills.hostedOnly, practices: counts.practices.hostedOnly, memory: counts.memory.hostedOnly };
  const fullName = row?.fullName ?? `${slug}/${DEFAULT_REGISTRY_NAME}`;

  return {
    status: row?.status ?? "unmapped",
    ...(row ? { registry: registryOf(row) } : {}),
    counts: { ...counts, lessons: row?.counts.lessons ?? 0 },
    migration: migrationOf(row, totals),
    // Fleet sync is not observable until the adoption pass (R5) hashes each repo's skills against
    // the catalog; reported as zero rather than estimated.
    fleet: { reposTotal: rollup?.repos?.length ?? 0, reposPointing: 0, reposSynced30d: 0, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 } },
    activity: activityOf(row),
    telemetry: { invokes30d: 0, reposReporting: 0, sink: row?.telemetrySink ?? "off" },
    howTo: registryHowTo(fullName),
    capabilities: caps,
    permission: { contentsWrite: caps.canWrite, ...(caps.installUrl ? { installUrl: caps.installUrl } : {}) },
    ...(row?.scaffoldPrUrl ? { scaffoldPrUrl: row.scaffoldPrUrl } : {}),
    ...(row?.lastError && row.status === "error" ? { error: { message: row.lastError, at: row.lastIndexedAt ?? row.updatedAt } } : {}),
    candidates: [],
  };
}
