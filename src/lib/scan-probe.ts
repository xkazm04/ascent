// The CREDIT-FREE control probe (moonshot #10, lane W3-L).
//
// A probe is NOT a scan. It runs no inference, writes no `Scan` row, reserves no credit, and never
// produces a score — median cost ~3 REST calls and under two seconds, against ~6 minutes and one
// credit for a live scan. That is the whole point of the two-speed fleet: control posture can be
// re-observed continuously and for free, while re-scoring stays on cadence and stays paid.
//
// It deliberately calls the EXISTING fetchers (`fetchBranchGovernance`, `fetchSecurityPosture`) with
// no new parameter and no change to the scan path — W4-P rewrites `scan-ingest` wholesale and needs
// a byte-comparable baseline, so nothing here reaches into it.

import { fetchBranchGovernance } from "@/lib/github/governance";
import { fetchSecurityPosture } from "@/lib/github/security-posture";
import { ghFetch, githubApiBase } from "@/lib/github/host";
import { latestObservations, recordObservations, type ControlSample } from "@/lib/db/control-observations";
import { setRepoMissing } from "@/lib/db/org-watch";
import { resolveRepoJobRef } from "@/lib/db/scan-jobs";
import {
  CONTROL_IDS,
  HEARTBEAT_AFTER_MS,
  diffSamples,
  governanceToSamples,
  postureToSamples,
  repoMetaToSamples,
  type RepoMeta,
} from "@/lib/scan-probe-controls";

const META_TIMEOUT_MS = 10_000;

export interface ProbeInput {
  orgSlug: string;
  fullName: string;
  /** Installation token. Absent = a keyless public read; the private controls then come back
   *  `unmeasurable`, which is the honest answer and never `fail`. */
  token?: string;
  repoId?: string | null;
  jobId?: string | null;
  deliveryId?: string | null;
  /** Injectable clock, so the heartbeat arithmetic is testable. */
  now?: () => number;
}

export interface ProbeResult {
  fullName: string;
  /** Rows actually written (changes + due heartbeats), not controls looked at. */
  written: number;
  transitions: number;
  /** How many of the observed controls came back unreadable — the honesty metric of a probe. */
  unmeasurable: number;
  /** null when the metadata read failed for a reason other than 404: we do not know. */
  present: boolean | null;
}

/**
 * Read one repo's deterministic controls and append what changed.
 *
 * `GET /repos/{owner}/{repo}` first, because its answer decides the rest: a 404 IS the observation
 * that the repo is gone (renamed, deleted, or turned private beyond our token), and it also carries
 * the default branch the governance read needs. Any other failure leaves `present` unknown — a
 * GitHub blip must never flag a live repo as missing.
 */
export async function probeRepository(input: ProbeInput): Promise<ProbeResult> {
  const now = input.now ?? Date.now;
  const [owner = "", repo = ""] = input.fullName.split("/");
  const meta = await fetchRepoMeta(owner, repo, input.token);

  const samples: ControlSample[] = [...repoMetaToSamples(meta)];
  if (meta?.present) {
    // Only fan out when there is something to read. A 404'd repo has no branch and no advisories,
    // and repoMetaToSamples has already recorded both as unmeasurable rather than as absent.
    const branch = meta.defaultBranch ?? "main";
    const [gov, posture] = await Promise.all([
      input.token ? fetchBranchGovernance(owner, repo, branch, input.token).catch(() => null) : Promise.resolve(null),
      input.token ? fetchSecurityPosture(owner, repo, input.token).catch(() => null) : Promise.resolve(null),
    ]);
    samples.push(...governanceToSamples(gov), ...postureToSamples(posture));
  } else {
    // The repo could not be read: record the governance/posture controls as unmeasurable too, so the
    // ledger says "we stopped being able to see this" rather than falling silent about it.
    samples.push(...governanceToSamples(null), ...postureToSamples(null));
  }

  const repoId: string | null =
    input.repoId ?? (await resolveRepoJobRef(input.orgSlug, input.fullName).then((r) => r?.repoId ?? null));
  const prev = repoId ? await latestObservations(repoId) : [];
  const due = diffSamples(prev, samples, HEARTBEAT_AFTER_MS, now());
  const { written, transitions } = await recordObservations(input.orgSlug, repoId, due, {
    repoFullName: input.fullName,
    source: "probe",
    jobId: input.jobId ?? null,
    deliveryId: input.deliveryId ?? null,
  });

  // Refresh `missingSince` from the observation, NOT from the sample list: this is the column
  // `reconcileListedRepos` can only maintain for orgs whose repos we can list, which the App-install
  // funnel never does — so a renamed private repo burned a rescan slot forever. `present === null`
  // (an unreadable metadata call) writes nothing at all: unknown is not "gone".
  if (repoId && meta) await setRepoMissing(repoId, !meta.present).catch(() => {});

  return {
    fullName: input.fullName,
    written,
    transitions,
    unmeasurable: samples.filter((s) => s.state === "unmeasurable").length,
    present: meta ? meta.present : null,
  };
}

/** `GET /repos/{owner}/{repo}` — visibility, archived, default branch. 404 → a real "not present";
 *  any other non-2xx → null (unknown), which the mappers turn into `unmeasurable`. */
async function fetchRepoMeta(owner: string, repo: string, token?: string): Promise<RepoMeta | null> {
  if (!owner || !repo) return null;
  try {
    const res = await ghFetch(`${githubApiBase()}/repos/${owner}/${repo}`, { token, timeoutMs: META_TIMEOUT_MS });
    if (res.status === 404) return { present: false, visibility: null, archived: null, defaultBranch: null };
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { private?: boolean; visibility?: string; archived?: boolean; default_branch?: string }
      | null;
    if (!body) return null;
    // `visibility` is the richer field but is absent on some hosts/plans; `private` is universal, so
    // it is the fallback rather than the primary. Neither present ⇒ null, i.e. unmeasurable.
    const visibility =
      body.visibility === "public" || body.visibility === "private"
        ? body.visibility
        : typeof body.private === "boolean"
          ? body.private
            ? "private"
            : "public"
          : null;
    return {
      present: true,
      visibility,
      archived: typeof body.archived === "boolean" ? body.archived : null,
      defaultBranch: body.default_branch ?? null,
    };
  } catch {
    return null;
  }
}

export { CONTROL_IDS };
