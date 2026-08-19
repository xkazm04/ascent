// Persistence for the org's mapped registry repo(s) — the `OrgRegistry` row behind UC2
// (docs/REGISTRY-AND-CARE-IMPL.md §2). PURE DB: nothing here talks to GitHub, so the indexer, the
// scaffold writer and the API routes all compose it without dragging a token into the read path.
//
// Deliberately NOT exported through the `@/lib/db` barrel — import it by direct path
// (`@/lib/db/org-registry`). The mirror-row writers live beside it in `org-registry-mirror.ts`.
//
// Every read degrades to null when persistence is off (`isDbConfigured()` false), exactly like the
// sibling org modules, so a demo/local workspace renders the honest `unmapped` state instead of an
// error panel.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

export type RegistryStatusValue = "unmapped" | "scaffolding" | "scaffold_pr_open" | "indexed" | "error";
export type RegistryModeValue = "git_native" | "hosted_mirror";
export type TelemetrySinkValue = "api" | "registry" | "off";

export const REGISTRY_STATUSES: readonly RegistryStatusValue[] = [
  "unmapped",
  "scaffolding",
  "scaffold_pr_open",
  "indexed",
  "error",
];
export const REGISTRY_MODES: readonly RegistryModeValue[] = ["git_native", "hosted_mirror"];
export const TELEMETRY_SINKS: readonly TelemetrySinkValue[] = ["api", "registry", "off"];

/** One artifact type's migration out of ascent's tables, as persisted in `migrationJson`. */
export interface RegistryMigrationStep {
  state: "not-started" | "pr-open" | "merged" | "n/a";
  prUrl?: string;
  moved: number;
  total: number;
}

export interface OrgRegistryRow {
  id: string;
  orgId: string;
  repositoryId: string | null;
  fullName: string;
  defaultBranch: string;
  canonical: boolean;
  mode: RegistryModeValue;
  telemetrySink: TelemetrySinkValue;
  status: RegistryStatusValue;
  lastIndexedAt: string | null;
  lastIndexSha: string | null;
  catalogSha: string | null;
  webhookHealthy: boolean;
  policies: Record<string, unknown> | null;
  migration: Partial<Record<"skills" | "practices" | "memory", RegistryMigrationStep>>;
  scaffoldPrUrl: string | null;
  lastError: string | null;
  counts: { skills: number; practices: number; memory: number; lessons: number };
  /**
   * The registry's `usage/` lane, aggregated at index time.
   *
   * `contributors: 0` means nobody is REPORTING — which is a different fact from
   * a fleet that runs nothing, and every surface that renders the number has to
   * be able to tell them apart.
   */
  usage: { invokes30d: number; contributors: number };
  warnings: string[];
  createdBy: string | null;
  updatedAt: string;
}

export interface UpsertOrgRegistryInput {
  fullName: string;
  defaultBranch?: string;
  canonical?: boolean;
  mode?: RegistryModeValue;
  telemetrySink?: TelemetrySinkValue;
  status?: RegistryStatusValue;
  scaffoldPrUrl?: string | null;
  repositoryId?: string | null;
  createdBy?: string | null;
}

const one = <T>(v: readonly T[], raw: unknown, fallback: T): T =>
  (v as readonly unknown[]).includes(raw) ? (raw as T) : fallback;

export function parseRegistryJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const v: unknown = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

/** Prisma row -> the typed, defensively-parsed shape every caller reads. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRow(r: any): OrgRegistryRow {
  return {
    id: r.id,
    orgId: r.orgId,
    repositoryId: r.repositoryId ?? null,
    fullName: r.fullName,
    defaultBranch: r.defaultBranch || "main",
    canonical: Boolean(r.canonical),
    mode: one(REGISTRY_MODES, r.mode, "git_native"),
    telemetrySink: one(TELEMETRY_SINKS, r.telemetrySink, "off"),
    status: one(REGISTRY_STATUSES, r.status, "unmapped"),
    lastIndexedAt: r.lastIndexedAt ? new Date(r.lastIndexedAt).toISOString() : null,
    lastIndexSha: r.lastIndexSha ?? null,
    catalogSha: r.catalogSha ?? null,
    webhookHealthy: Boolean(r.webhookHealthy),
    policies: parseRegistryJson<Record<string, unknown> | null>(r.policiesJson ?? null, null),
    migration: parseRegistryJson<OrgRegistryRow["migration"]>(r.migrationJson ?? null, {}),
    scaffoldPrUrl: r.scaffoldPrUrl ?? null,
    lastError: r.lastError ?? null,
    counts: {
      skills: r.skillCount ?? 0,
      practices: r.practiceCount ?? 0,
      memory: r.memoryCount ?? 0,
      lessons: r.lessonCount ?? 0,
    },
    usage: { invokes30d: r.usageInvokes30d ?? 0, contributors: r.usageContributors ?? 0 },
    warnings: parseRegistryJson<string[]>(r.warningsJson ?? null, []).filter((w) => typeof w === "string"),
    createdBy: r.createdBy ?? null,
    updatedAt: new Date(r.updatedAt ?? Date.now()).toISOString(),
  };
}

/** The org's CANONICAL registry (the one the fleet views merge first), or null when none is mapped. */
export async function getOrgRegistry(slug: string): Promise<OrgRegistryRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(slug);
  if (!orgId) return null;
  const rows = await getPrisma().orgRegistry.findMany({
    where: { orgId },
    orderBy: [{ canonical: "desc" }, { createdAt: "asc" }],
    take: 1,
  });
  return rows[0] ? toRow(rows[0]) : null;
}

/** Every registry mapped to the org, canonical first. Team-level registries are legal beside it. */
export async function listOrgRegistries(slug: string): Promise<OrgRegistryRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(slug);
  if (!orgId) return [];
  const rows = await getPrisma().orgRegistry.findMany({
    where: { orgId },
    orderBy: [{ canonical: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toRow);
}

/** A registry by id (the indexer's entry point once a route resolved it). */
export async function getRegistryById(id: string): Promise<OrgRegistryRow | null> {
  if (!isDbConfigured()) return null;
  const r = await getPrisma().orgRegistry.findUnique({ where: { id } });
  return r ? toRow(r) : null;
}

/**
 * Map (or re-map) `fullName` as a registry of `slug`. Keyed on the schema's @@unique([orgId, fullName]),
 * so calling it twice for the same repo UPDATES rather than duplicating — the map action is safe to
 * retry from a flaky client. Returns null when persistence is off or the org is unknown.
 *
 * A newly-mapped canonical registry demotes any other canonical row in the same org, so the invariant
 * "one canonical registry per org" is enforced here rather than hoped for by the callers.
 */
export async function upsertOrgRegistry(slug: string, input: UpsertOrgRegistryInput): Promise<OrgRegistryRow | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(slug);
  if (!orgId) return null;
  const prisma = getPrisma();
  const fullName = input.fullName.trim();
  const canonical = input.canonical ?? true;

  const data = {
    defaultBranch: (input.defaultBranch || "main").trim(),
    canonical,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.telemetrySink ? { telemetrySink: input.telemetrySink } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.scaffoldPrUrl !== undefined ? { scaffoldPrUrl: input.scaffoldPrUrl } : {}),
    ...(input.repositoryId !== undefined ? { repositoryId: input.repositoryId } : {}),
  };

  const row = await prisma.orgRegistry.upsert({
    where: { orgId_fullName: { orgId, fullName } },
    update: data,
    create: { orgId, fullName, createdBy: input.createdBy ?? null, ...data },
  });

  if (canonical) {
    await prisma.orgRegistry.updateMany({
      where: { orgId, canonical: true, id: { not: row.id } },
      data: { canonical: false },
    });
  }
  return toRow(row);
}
