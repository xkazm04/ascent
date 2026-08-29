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
import { countOrgSkillInvokes } from "@/lib/db/org-skills";
import { listOrgSkillUsageSamples } from "@/lib/db/org-skill-usage-samples";
import { listConformance, listConformanceMaps, type ConformanceMapRow, type ConformanceRow } from "@/lib/db/org-registry-conformance";
import { listOrgKnowledgeSubjects } from "@/lib/db/org-registry-subjects";
import { listRegistrySignals } from "@/lib/db/org-registry-signals";
import { listRecentLessons, type SkillLessonRow } from "@/lib/db/org-skill-lessons";
import { summarizeSignals, type SignalSummary } from "@/lib/registry/signals";
import { getRegistryCapabilities, type RegistryCapabilities } from "@/lib/registry/capabilities";
import { DEFAULT_REGISTRY_NAME } from "@/lib/registry/layout";
import { registryHowTo } from "./registry-howto";

export { DEFAULT_REGISTRY_NAME, registryHowTo };
export type { ConformanceMapRow, ConformanceRow, SignalSummary };

/**
 * How many judged pairs travel to the tab. A fleet of 50 repos × 180 pairs is 9,000 rows, which is a
 * megabyte of RSC payload for a grid nobody reads past the first screen. Truncation is DISCLOSED
 * (`conformance.truncated`) rather than silent — a matrix that quietly stops at 3,000 rows would
 * report a repo as having no deviations when it has plenty.
 */
export const CONFORMANCE_PAIR_CAP = 3000;
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
  /**
   * The two sinks of the invoke channel (#19), reported SEPARATELY and never summed — an installation
   * may report to both, and adding them would count it twice.
   *   `invokes30d` / `reposReporting` — sink B, the registry's own `usage/` lane, as the last index
   *      pass read it. `measured: false` means no pass has read the lane, which is not "zero usage".
   *   `invokesDirect30d` — sink A, this org's own events API (hook / CI / MCP), last 30 days. Null
   *      when persistence is off.
   *   `invokesBySkill` — sink B per skill NAME (a registry-only skill has no OrgSkill id).
   *
   * The two new fields are OPTIONAL so the shaped preview states (registry-view.fixture.ts) stay
   * valid without asserting a sink they were never written to describe. "Has the lane been read at
   * all?" is not a field here either: `registry.lastIndexedAt` already answers it, and a second
   * encoding of the same fact is a second thing to keep in sync.
   */
  telemetry: {
    invokes30d: number;
    reposReporting: number;
    sink: TelemetrySink;
    invokesDirect30d?: number | null;
    invokesBySkill?: Record<string, number>;
  };
  /** The knowledge/ lane, one entry per Reference Knowledge Bundle, as that
   *  bundle's own generated index states it. Empty until a pass reads the lane. */
  bundles: OrgRegistryRow["bundles"];
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

  // ── #18: the fleet's conformance against the org's OWN corpus ──────────────────────────────────
  /**
   * What each repo's `.ai/registry-map.json` says about itself, as the last sweep ingested it.
   *
   * OPTIONAL, and absent means "never swept" — which every surface must render as *no sweep yet*,
   * never as a clean fleet. Inside it, `reposWithoutMap` counts repos the sweep visited that have no
   * map at all: also not "no deviations". The three states this block keeps apart (never swept /
   * no map / swept and judged) are the difference between an instrument and a decoration.
   */
  conformance?: {
    /** One entry per repo that HAS a map. */
    repos: ConformanceMapRow[];
    /** Judged pairs, capped for the wire — see CONFORMANCE_PAIR_CAP. */
    pairs: ConformanceRow[];
    /** True when the cap actually bit, so a reader is told the matrix is partial. */
    truncated: boolean;
    /** Repos in the fleet with no map of their own. */
    reposWithoutMap: number;
    /** Subjects mirrored from the knowledge lane — the matrix's row vocabulary. */
    subjects: number;
  };
  /**
   * The `signals/` lane, per subject. `contributors: 0` is "no witness" — the corpus has told us
   * nothing about itself — and is never a green tick.
   */
  signals?: { contributors: number; subjects: SignalSummary[] };
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

/**
 * Activity ascent can actually attest to: its own index passes, the catalog it wrote, and — since
 * #36 — the lessons it mirrored.
 *
 * The `lesson` kind has been in the union (and in the label map, and in the fixtures) since the tab
 * shipped, emitted by nothing. A vocabulary with a dead member teaches a reader that the feed is
 * decorative; this makes the existing kind real rather than adding one.
 */
function activityOf(row: OrgRegistryRow | null, lessons: SkillLessonRow[] = []): RegistryActivityEntry[] {
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
  for (const l of lessons) {
    // `learnedOn` is the lesson's own claim about when the run happened and is what a reader means
    // by "when"; a lesson whose heading carried no readable date falls back to when ascent mirrored
    // it, which is a different and weaker fact — so it is never presented as the run's date.
    out.push({
      at: l.learnedOn ?? l.createdAt,
      kind: "lesson",
      title: `${l.skillName}${l.versionUsed ? ` v${l.versionUsed}` : ""}${l.project ? ` — ${l.project}` : ""}`,
      url: `${url}/blob/${row.defaultBranch}/${l.registryPath}`,
    });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
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
  // Both sinks, read side by side so the panel can say which one is silent (#19). Each degrades on
  // its own: a failed read is "not measured", never a zero.
  const [samples, invokesDirect30d] = orgId
    ? await Promise.all([
        listOrgSkillUsageSamples(orgId).catch(() => []),
        countOrgSkillInvokes(orgId).catch(() => null),
      ])
    : [[], null];
  const invokesBySkill: Record<string, number> = {};
  for (const s of samples) invokesBySkill[s.skillName] = (invokesBySkill[s.skillName] ?? 0) + s.invokes;

  // #18. Every read degrades on its own: a failed conformance read must not cost the tab its
  // telemetry, and vice versa. All three are absent-not-zero when the org has never swept.
  const [maps, pairs, subjects, signalRows, recentLessons] = orgId
    ? await Promise.all([
        listConformanceMaps(orgId).catch(() => []),
        listConformance(orgId, { limit: CONFORMANCE_PAIR_CAP + 1 }).catch(() => []),
        listOrgKnowledgeSubjects(orgId).catch(() => []),
        listRegistrySignals(orgId).catch(() => []),
        listRecentLessons(orgId, 10).catch(() => []),
      ])
    : [[], [], [], [], []];
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
    activity: activityOf(row, recentLessons),
    // Read from the registry's own `usage/` lane at index time, not counted here.
    // `reposReporting` is how many installations CONTRIBUTED a file — a zero with
    // invokes 0 means nobody is reporting, which is a different fact from a fleet
    // that runs nothing, and the instrument panel says so.
    bundles: row?.bundles ?? [],
    telemetry: {
      invokes30d: row?.usage.invokes30d ?? 0,
      reposReporting: row?.usage.contributors ?? 0,
      sink: row?.telemetrySink ?? "off",
      invokesDirect30d,
      invokesBySkill,
    },
    // Absent, not empty, when nothing has been swept: `conformance: undefined` is what lets the
    // panel say "never swept" instead of drawing an empty grid that reads as a clean fleet.
    ...(maps.length
      ? {
          conformance: {
            repos: maps,
            pairs: pairs.slice(0, CONFORMANCE_PAIR_CAP),
            truncated: pairs.length > CONFORMANCE_PAIR_CAP,
            reposWithoutMap: Math.max(0, (rollup?.repos?.length ?? 0) - maps.length),
            subjects: subjects.length,
          },
        }
      : {}),
    ...(signalRows.length
      ? { signals: { contributors: new Set(signalRows.map((r) => r.contributor)).size, subjects: summarizeSignals(signalRows) } }
      : {}),
    howTo: registryHowTo(fullName),
    capabilities: caps,
    permission: { contentsWrite: caps.canWrite, ...(caps.installUrl ? { installUrl: caps.installUrl } : {}) },
    ...(row?.scaffoldPrUrl ? { scaffoldPrUrl: row.scaffoldPrUrl } : {}),
    ...(row?.lastError && row.status === "error" ? { error: { message: row.lastError, at: row.lastIndexedAt ?? row.updatedAt } } : {}),
    candidates: [],
  };
}
