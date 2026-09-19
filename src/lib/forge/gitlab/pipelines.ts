// GitLab pipelines → the existing `CiHealth` shape.
//
// The exclusion set mirrors `src/lib/github/actions-health.ts` field for field, and for the same
// reason: a cancelled or skipped run is not a verdict on the pipeline, so counting it would drag the
// success rate down for reasons that say nothing about CI health. Sampling one page of the default
// branch's recent pipelines is the same bounded read the GitHub path performs.

import type { CiHealth } from "@/lib/github/actions-health";
import { gitlabGetSoft, projectRef, type GitlabFetchOpts } from "@/lib/forge/gitlab/http";

/** Recent default-branch pipelines sampled (one page) — the same figure `CI_HEALTH_SAMPLE` uses. */
export const GITLAB_PIPELINE_SAMPLE = 50;

/** The subset of `GET /projects/:id/pipelines` + `/pipelines/:id` this mapper reads. */
export interface GlPipeline {
  id?: number;
  status?: string; // success | failed | canceled | skipped | running | pending | manual | scheduled
  ref?: string;
  name?: string;
  source?: string; // push | merge_request_event | schedule | …
  created_at?: string;
  updated_at?: string;
  duration?: number | null; // SECONDS, per GitLab's API
}

/** Statuses that are not a verdict: a human cancelled it, a rule skipped it, or it hasn't finished. */
const NON_VERDICT = new Set(["canceled", "cancelled", "skipped", "running", "pending", "created", "manual", "scheduled", "waiting_for_resource", "preparing"]);

/**
 * PURE mapper. Returns null for an unreadable list (not observable), and a record with
 * `successRate: null` for a readable list that contained no concluded run — "no sample" is not "0%
 * healthy", and the two must stay distinguishable.
 *
 * `workflows` counts DISTINCT pipeline sources/names rather than files: GitLab's single
 * `.gitlab-ci.yml` means the GitHub notion of "how many workflows" maps most honestly onto the
 * distinct pipeline SOURCES observed (push / merge_request_event / schedule), each of which is a
 * separately-triggered pipeline definition in practice.
 */
export function mapCiHealth(branch: string, pipelines: GlPipeline[] | null): CiHealth | null {
  if (!pipelines) return null;
  const onBranch = pipelines.filter((p) => !p.ref || p.ref === branch);
  const concluded = onBranch.filter((p) => p.status && !NON_VERDICT.has(p.status));
  const success = concluded.filter((p) => p.status === "success").length;
  const failure = concluded.filter((p) => p.status === "failed").length;
  const denom = success + failure;

  const durations = concluded
    .map((p) => (typeof p.duration === "number" && p.duration > 0 ? p.duration / 60 : null))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b);

  const latest = onBranch
    .map((p) => p.updated_at ?? p.created_at)
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort()
    .at(-1) ?? null;

  // A currently-red "workflow": the MOST RECENT concluded pipeline of a given source failed. Same
  // reading as the GitHub path's "most recent sampled run failed", deduped and stably ordered.
  const seen = new Set<string>();
  const failing: string[] = [];
  for (const p of concluded) {
    const key = p.name ?? p.source ?? "pipeline";
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.status === "failed") failing.push(key);
  }

  return {
    branch,
    sampled: concluded.length,
    successRate: denom > 0 ? Math.round((success / denom) * 100) : null,
    medianDurationMin: durations.length ? Math.round(median(durations) * 10) / 10 : null,
    latestRunAt: latest,
    workflows: seen.size,
    failing,
  };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** GitLab's pipeline LIST omits `duration`; only the per-pipeline read carries it. Rather than fire 50
 *  extra calls, the list is used as-is and `medianDurationMin` reports null when no duration was
 *  returned — an unknown, never a fabricated zero. */
export async function fetchGitlabCiHealth(
  fullPath: string,
  branch: string,
  opts: GitlabFetchOpts & { externalId?: string } = {},
): Promise<CiHealth | null> {
  const ref = projectRef(fullPath, opts.externalId);
  const pipelines = await gitlabGetSoft<GlPipeline[]>(
    `/projects/${ref}/pipelines?ref=${encodeURIComponent(branch)}&per_page=${GITLAB_PIPELINE_SAMPLE}`,
    opts,
  );
  return mapCiHealth(branch, pipelines);
}
