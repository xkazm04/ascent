// The ONE repo-history read ladder: /trends, /report/compare and /api/history all walk it.
//
// Every history policy change (the plan window, the strict db-down read, DbUnavailableError matched by
// code) used to land three times, once per surface, and the copies drifted: Compare read 60 scans where
// the shared cap says 200, and the API had no "hidden by the window" signal at all. This module is the
// decision itself, io-free: each surface injects its own reads and maps the returned state to a page
// notice or a status code. The sign-in gate is NOT part of it; each surface keeps its own and calls
// this after it, so no gate is loosened or tightened here.
//
// Ladder, in order: repo present -> repo parses -> database configured -> readable org -> plan window
// -> strict read (db-down caught by code) -> when the windowed read is empty, a one-row unwindowed probe
// tells "outside the window" from "never scanned".

import { parseRepoUrl } from "@/lib/github/source";
import { HISTORY_SCAN_CAP } from "@/lib/history/limits";
import type { HistoryWindow } from "@/lib/history/window";
import { isDbDown } from "@/app/trends/dbDown";

/** The page surfaces, plus the API (whose depth is the caller's `?limit=`). */
export type HistorySurface = "trends" | "compare" | "api";

/**
 * How deep each surface reads. Trends and Compare read the SAME depth, so any scan the trends chart
 * plots resolves as `?a=` / `?b=` on Compare instead of falling back to the default pair. The API
 * keeps the caller's limit (the DB reader defaults and clamps it).
 */
export const HISTORY_DEPTH: Record<HistorySurface, number | undefined> = {
  trends: HISTORY_SCAN_CAP,
  compare: HISTORY_SCAN_CAP,
  api: undefined,
};

export interface RepoTarget {
  owner: string;
  repo: string;
}

export interface HistoryReadArgs extends RepoTarget {
  orgSlug: string;
  limit: number | undefined;
  since: Date | null;
}

export interface RepoHistoryDeps<T extends { scans: readonly unknown[] }> {
  dbConfigured: boolean;
  resolveOrg: (owner: string) => Promise<string>;
  resolveWindow: (orgSlug: string) => Promise<HistoryWindow>;
  /** The surface's windowed, strict read. */
  read: (args: HistoryReadArgs) => Promise<T | null>;
  /** How many scans exist with NO window (a one-row read is enough). Called only under a window. */
  probe: (args: RepoTarget & { orgSlug: string }) => Promise<number>;
}

/** The prelude every surface answers before reading: shared so the API can run it ahead of its gate. */
export type RepoHistoryTarget =
  | { kind: "missing-repo" }
  | { kind: "invalid-repo" }
  | { kind: "no-db"; repo: string }
  | { kind: "target"; repo: string; target: RepoTarget };

export type RepoHistoryAccess<T> =
  | Exclude<RepoHistoryTarget, { kind: "target" }>
  | { kind: "db-down"; repo: string; target: RepoTarget; error: unknown }
  | { kind: "outside-window"; repo: string; target: RepoTarget; orgSlug: string; window: HistoryWindow }
  | { kind: "empty"; repo: string; target: RepoTarget; orgSlug: string; window: HistoryWindow; data: T | null }
  | { kind: "ok"; repo: string; target: RepoTarget; orgSlug: string; window: HistoryWindow; data: T };

export function resolveRepoHistoryTarget(repo: string | null | undefined, dbConfigured: boolean): RepoHistoryTarget {
  if (!repo) return { kind: "missing-repo" };
  const parsed = parseRepoUrl(repo);
  if (!parsed) return { kind: "invalid-repo" };
  const fullName = `${parsed.owner}/${parsed.repo}`;
  if (!dbConfigured) return { kind: "no-db", repo: fullName };
  return { kind: "target", repo: fullName, target: { owner: parsed.owner, repo: parsed.repo } };
}

export async function resolveRepoHistoryAccess<T extends { scans: readonly unknown[] }>(input: {
  repo: string | null | undefined;
  surface: HistorySurface;
  /** Overrides the surface depth (the API's `?limit=`). */
  limit?: number;
  deps: RepoHistoryDeps<T>;
}): Promise<RepoHistoryAccess<T>> {
  const { deps } = input;
  const t = resolveRepoHistoryTarget(input.repo, deps.dbConfigured);
  if (t.kind !== "target") return t;
  const { repo, target } = t;
  const orgSlug = await deps.resolveOrg(target.owner);
  const limit = input.limit ?? HISTORY_DEPTH[input.surface];
  let window: HistoryWindow;
  let data: T | null;
  let hidden = false;
  try {
    window = await deps.resolveWindow(orgSlug);
    data = await deps.read({ ...target, orgSlug, limit, since: window.since });
    if (window.since && (!data || data.scans.length === 0)) {
      hidden = (await deps.probe({ ...target, orgSlug })) > 0;
    }
  } catch (error) {
    if (!isDbDown(error)) throw error;
    return { kind: "db-down", repo, target, error };
  }
  if (hidden) return { kind: "outside-window", repo, target, orgSlug, window };
  if (!data || data.scans.length === 0) return { kind: "empty", repo, target, orgSlug, window, data };
  return { kind: "ok", repo, target, orgSlug, window, data };
}

/** Where the sign-in prompt sends the reader back to: the WHOLE request, so a shared pair survives. */
export function historyReturnPath(
  surface: "trends" | "compare",
  params: { repo?: string; a?: string; b?: string; against?: string },
): string {
  const base = surface === "trends" ? "/trends" : "/report/compare";
  const keys = surface === "trends" ? (["repo"] as const) : (["repo", "a", "b", "against"] as const);
  const qs = keys
    .filter((k) => params[k])
    .map((k) => `${k}=${encodeURIComponent(params[k]!)}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}
