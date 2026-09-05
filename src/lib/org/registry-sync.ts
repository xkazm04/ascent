// "Where does this content live?" — the ONE small read the Skills, Memory and Practices tabs share.
//
// Those three tabs are the registry's consumers: once an org maps a registry repo, their rows stop
// being ascent's to edit and become a mirror of files in git. Before that, everything they show lives
// only in ascent's tables. Either way the tab has to SAY SO, and it must say the same thing on all
// three — so the answer is loaded here once and rendered by one component
// (`src/features/shared/registry/RegistrySyncStrip.tsx`).
//
// Deliberately NOT `getRegistryView`: that loader probes GitHub for capabilities and counts mirror
// rows across three tables. A consumer tab only needs the repo, when it was last indexed, and the
// denormalized counts the last index pass stamped on the row — one query, no network.

import { getOrgRegistry } from "@/lib/db/org-registry";

export interface RegistrySync {
  /** True once an `OrgRegistry` row exists for the org — the registry may still be mid-scaffold. */
  mapped: boolean;
  fullName: string | null;
  /** `https://github.com/<owner>/<repo>`, or null when nothing is mapped. */
  url: string | null;
  defaultBranch: string;
  /** ISO timestamp of the last successful index pass, or null when it has never been read. */
  lastIndexedAt: string | null;
  /** Denormalized counts stamped by the last index pass. Zeroes before the first one. */
  counts: { skills: number; practices: number; memory: number; lessons: number };
  status: "unmapped" | "scaffolding" | "scaffold_pr_open" | "indexed" | "error";
}

export const UNMAPPED_SYNC: RegistrySync = {
  mapped: false,
  fullName: null,
  url: null,
  defaultBranch: "main",
  lastIndexedAt: null,
  counts: { skills: 0, practices: 0, memory: 0, lessons: 0 },
  status: "unmapped",
};

/**
 * Blob URL of one mirrored file in the registry repo — the "Open in registry" deep link a
 * registry-origin row offers instead of an in-app edit form. Null when the row is hosted, when
 * nothing is mapped, or when the indexer never recorded a path (so a link can never 404 by
 * construction).
 */
export function registryFileUrl(sync: RegistrySync, registryPath: string | null | undefined): string | null {
  if (!sync.url || !registryPath) return null;
  return `${sync.url}/blob/${sync.defaultBranch}/${registryPath.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * `https://github.com/<owner>/<repo>/blob/<branch>` — the prefix a client row needs to build its own
 * "Open in registry" link without being handed the whole `RegistrySync`. Null when nothing is mapped,
 * which is also the flag the consumer tabs use to decide whether per-row origin markers mean anything.
 */
export function registryBlobBase(sync: RegistrySync): string | null {
  return sync.url ? `${sync.url}/blob/${sync.defaultBranch}` : null;
}

/** The org's canonical registry as the consumer tabs read it. Never throws — degrades to unmapped. */
export async function getRegistrySync(slug: string): Promise<RegistrySync> {
  const row = await getOrgRegistry(slug).catch(() => null);
  if (!row) return UNMAPPED_SYNC;
  return {
    mapped: true,
    fullName: row.fullName,
    url: `https://github.com/${row.fullName}`,
    defaultBranch: row.defaultBranch,
    lastIndexedAt: row.lastIndexedAt,
    counts: row.counts,
    status: row.status,
  };
}
