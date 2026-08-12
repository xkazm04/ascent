// Context Health (W4) — the quality-over-presence read of a repo's agent-context layer.
//
// Pure derivation over facts the scan ALREADY holds plus the ≤3 cheap per-file freshness lookups
// (fetchGuidanceFreshness in src/lib/github/source.ts): per detected guidance file its last-modified
// date, size, and guidance-quality grade; repo-level staleness as the APPROXIMATE count of commits
// that landed since the guidance was last edited (read off the weekly commitActivity buckets — never
// presented as an exact rev-list); and reference DRIFT as `@file`-style path references checked
// against the actual tree index (zero extra fetches — a dead ref is measurable drift).
//
// DISPLAY/PERSIST-ONLY, like techStack and passport: the composite NEVER feeds the scan score or the
// LLM prompt, so shipping it needs no SCORING_RUBRIC_VERSION bump. Pinned by the "stays display-only"
// test in context-health.test.ts. Folding it into D1 later is a deliberate, versioned rubric event.

import type { ContextHealth, ContextHealthFile, GuidanceFreshness, RepoFile, RepoSnapshot } from "@/lib/types";
import { guidanceQuality } from "@/lib/analyze";

/** Shape version persisted inside contextHealthJson, for read-time tolerance. */
export const CONTEXT_HEALTH_VERSION = "1";

// The agent-instruction files the D1 detector already recognizes as primary guidance (mirrors
// pickFilesToFetch step 0 in src/lib/github/source.ts, minus the multi-file .cursor/rules/ dir —
// freshness lookups are budgeted per FILE, so only single-file guidance artifacts qualify).
const GUIDANCE_PATH_RE =
  /((^|\/)(claude\.md|agents?\.md|agent\.md|\.cursorrules|\.windsurfrules)|^\.github\/copilot-instructions\.md)$/i;

/** How many guidance files the health read covers (== the freshness-lookup budget in source.ts). */
export const MAX_GUIDANCE_FILES = 3;

/** Priority of a guidance file when the budget forces a choice: what an agent reads first. */
function guidanceRank(path: string): number {
  const base = path.toLowerCase().replace(/^.*\//, "");
  if (base === "claude.md") return 0;
  if (base === "agents.md" || base === "agent.md") return 1;
  return 2;
}

/**
 * Pick the ≤{@link MAX_GUIDANCE_FILES} guidance files a scan measures: root files before nested
 * ones (the repo-wide contract beats a package-local copy), CLAUDE.md/AGENTS.md before rules files.
 * Deterministic, so re-scans measure the same files.
 */
export function pickGuidanceFiles(tree: RepoFile[]): RepoFile[] {
  const depth = (p: string) => p.split("/").length;
  return tree
    .filter((t) => t.type === "blob" && GUIDANCE_PATH_RE.test(t.path))
    .sort(
      (a, b) =>
        depth(a.path) - depth(b.path) ||
        guidanceRank(a.path) - guidanceRank(b.path) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, MAX_GUIDANCE_FILES);
}

/** guidanceQuality's maximum attainable points (the sum of every rule) — the 0..100 normalizer. */
const GUIDANCE_QUALITY_MAX = 56;

/**
 * APPROXIMATE commits landed since `sinceIso`, read off the scan's weekly commit-activity buckets
 * (oldest→newest, newest bucket = the current week). Whole trailing weeks are summed exactly; the
 * partial oldest week is pro-rated. Returns null when there is nothing to count against (no activity
 * blob — tokenless scan — or an unparseable date). When the edit predates the window the result is a
 * LOWER BOUND — callers must label it (`windowCapped`).
 */
export function commitsSince(
  commitActivity: number[] | null | undefined,
  sinceIso: string,
  nowMs: number,
): { count: number; windowCapped: boolean } | null {
  if (!commitActivity || commitActivity.length === 0) return null;
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return null;
  const weeks = commitActivity.length;
  const weeksSince = Math.max(0, (nowMs - since) / (7 * 86_400_000));
  const full = Math.min(weeks, Math.floor(weeksSince));
  let count = 0;
  for (let i = weeks - full; i < weeks; i++) count += commitActivity[i] ?? 0;
  const olderIdx = weeks - full - 1;
  const frac = Math.min(1, weeksSince - full);
  if (olderIdx >= 0 && frac > 0) count += Math.round((commitActivity[olderIdx] ?? 0) * frac);
  return { count, windowCapped: weeksSince > weeks };
}

/**
 * Exponential decay of context potency under code churn: a guidance file doesn't rot with the
 * calendar, it rots with the commits that land after it was written. `tolerance` is how many commits
 * the file can absorb before it's half wrong. (Survivor from the P4 prototype — real math, real inputs.)
 */
export function decayPotency(churnSinceEdit: number, tolerance: number): number {
  if (tolerance <= 0) return 0;
  return Math.round(100 * Math.pow(0.5, churnSinceEdit / tolerance));
}

/** Days until potency halves at `commitsPerWeek`. Infinity when nothing is landing. (P4 survivor.) */
export function halfLife(tolerance: number, commitsPerWeek: number): number {
  if (commitsPerWeek <= 0) return Infinity;
  return (tolerance / commitsPerWeek) * 7;
}

/** Commit tolerance of a guidance file: a longer, higher-quality file absorbs more change before it
 *  is half wrong. Shared by the scan-time potency and the UI's half-life projection. */
export function guidanceTolerance(bytes: number | undefined, sectionsScore: number): number {
  return Math.max(8, ((bytes ?? 0) / 1000) * (sectionsScore / 12));
}

// `@path/to/file.ext` references — the same shape guidanceQuality's "Uses file references" rule
// rewards, extracted (not just detected) so each ref can be checked against the tree.
const FILE_REF_RE = /@([A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:mdx?|tsx?|jsx?|py|go|rs|json|ya?ml|toml|sql|sh))\b/g;

/** Cap on persisted dead-ref examples (the count is exact; the list is a sample). */
const MAX_DEAD_REFS = 12;

/** Extract `@file` refs from guidance text and split them against the tree index. Pure. */
export function detectRefDrift(
  guidanceText: string,
  guidancePath: string,
  treePaths: ReadonlySet<string>,
): { refsTotal: number; deadRefs: string[] } {
  const dir = guidancePath.includes("/") ? guidancePath.slice(0, guidancePath.lastIndexOf("/") + 1) : "";
  const seen = new Set<string>();
  const dead: string[] = [];
  for (const m of guidanceText.matchAll(FILE_REF_RE)) {
    const ref = m[1]!;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const rel = (dir + ref).toLowerCase().replace(/\/\.\//g, "/");
    const alive = treePaths.has(ref.toLowerCase()) || treePaths.has(rel);
    if (!alive && dead.length < MAX_DEAD_REFS) dead.push(ref);
  }
  return { refsTotal: seen.size, deadRefs: dead };
}

export interface DeriveContextHealthInput {
  snapshot: RepoSnapshot;
  /** Per-file freshness lookups (≤3). Entries missing lastModifiedAt = unknown, never fabricated. */
  freshness: GuidanceFreshness[];
  /** The scan's weekly commit totals (oldest→newest), or null on a tokenless scan. */
  commitActivity: number[] | null;
  /** The scan's timestamp (ISO) — staleness is measured as of the scan, deterministically. */
  now: string;
}

/**
 * Derive a repo's Context Health from a finished snapshot + the freshness lookups. Pure and total:
 * every degraded input (no guidance files, unknown freshness, no activity blob, unfetched content)
 * narrows the result honestly instead of throwing or fabricating. Invoked from composeScanReport
 * next to buildPassport; persisted as Scan.contextHealthJson / cached on Repository.contextHealthJson.
 */
export function deriveContextHealth(input: DeriveContextHealthInput): ContextHealth {
  const { snapshot, commitActivity } = input;
  const nowMs = Date.parse(input.now);
  const picked = pickGuidanceFiles(snapshot.tree);
  const contentByPath = new Map(snapshot.files.map((f) => [f.path.toLowerCase(), f.content]));
  const freshnessByPath = new Map(input.freshness.map((f) => [f.path, f]));

  const files: ContextHealthFile[] = picked.map((t) => {
    const text = contentByPath.get(t.path.toLowerCase());
    const points = text ? guidanceQuality(text).reduce((a, g) => a + g.points, 0) : 0;
    const fresh = freshnessByPath.get(t.path);
    return {
      path: t.path,
      ...(fresh?.lastModifiedAt ? { lastModifiedAt: fresh.lastModifiedAt } : {}),
      ...(fresh?.lastCommitSha ? { lastCommitSha: fresh.lastCommitSha } : {}),
      ...(t.size != null ? { bytes: t.size } : {}),
      sectionsScore: Math.min(100, Math.round((points / GUIDANCE_QUALITY_MAX) * 100)),
    };
  });

  const present = files.length > 0;

  // Primary file = the highest-quality guidance (what an agent gets the most from), ties broken by
  // the deterministic pick order (root CLAUDE.md first).
  const primary = files.reduce<ContextHealthFile | null>(
    (best, f) => (best == null || f.sectionsScore > best.sectionsScore ? f : best),
    null,
  );

  // Quality — the primary file's graded signals, reusing D1's guidanceQuality verbatim.
  const primaryText = primary ? contentByPath.get(primary.path.toLowerCase()) : undefined;
  const qualitySignals = primaryText ? guidanceQuality(primaryText).map((g) => g.label) : [];
  const quality = { score: primary?.sectionsScore ?? 0, signals: qualitySignals };

  // Freshness — approximate staleness of the primary file under the repo's own change rate.
  let freshness: ContextHealth["freshness"] = {
    score: null,
    ageDays: null,
    commitsSinceEdit: null,
    approximate: true,
  };
  if (primary?.lastModifiedAt && Number.isFinite(nowMs)) {
    const editedMs = Date.parse(primary.lastModifiedAt);
    const ageDays = Number.isFinite(editedMs) ? Math.max(0, Math.floor((nowMs - editedMs) / 86_400_000)) : null;
    const since = commitsSince(commitActivity, primary.lastModifiedAt, nowMs);
    if (since) {
      const tolerance = guidanceTolerance(primary.bytes, primary.sectionsScore);
      freshness = {
        score: decayPotency(since.count, tolerance),
        ageDays,
        commitsSinceEdit: since.count,
        approximate: true,
        ...(since.windowCapped ? { windowCapped: true } : {}),
      };
    } else {
      // Date known but nothing to count churn against (tokenless scan → no commitActivity):
      // report the age honestly, leave the potency unknown rather than fabricated.
      freshness = { score: null, ageDays, commitsSinceEdit: null, approximate: true };
    }
  }

  // Drift — dead `@file` refs across ALL measured guidance files vs the tree index (free).
  const treePaths = new Set(snapshot.tree.filter((t) => t.type === "blob").map((t) => t.path.toLowerCase()));
  let refsTotal = 0;
  const deadRefs: string[] = [];
  for (const f of files) {
    const text = contentByPath.get(f.path.toLowerCase());
    if (!text) continue;
    const d = detectRefDrift(text, f.path, treePaths);
    refsTotal += d.refsTotal;
    for (const r of d.deadRefs) if (deadRefs.length < MAX_DEAD_REFS) deadRefs.push(r);
  }
  const drift = {
    score: refsTotal === 0 ? 100 : Math.round(100 * ((refsTotal - deadRefs.length) / refsTotal)),
    refsTotal,
    deadRefs,
  };

  // Composite — quality-weighted blend; freshness drops OUT of the blend (weights renormalized)
  // when it is unknown, so a keyless-degraded scan is narrower, never lower.
  let score = 0;
  if (present) {
    const parts: Array<{ w: number; v: number }> = [
      { w: 0.45, v: quality.score },
      ...(freshness.score != null ? [{ w: 0.35, v: freshness.score }] : []),
      { w: 0.2, v: drift.score },
    ];
    const wSum = parts.reduce((a, p) => a + p.w, 0);
    score = Math.round(parts.reduce((a, p) => a + p.w * p.v, 0) / wSum);
  }

  return { version: CONTEXT_HEALTH_VERSION, present, files, freshness, quality, drift, score };
}

/** Defensive parse of a persisted contextHealthJson blob — null on malformed/legacy content, so a
 *  bad row degrades to "not assessed" instead of crashing a fleet page. Mirrors parsePassportJson. */
export function parseContextHealthJson(raw: string | null | undefined): ContextHealth | null {
  if (!raw) return null;
  try {
    const ch = JSON.parse(raw) as ContextHealth;
    if (
      !ch ||
      typeof ch !== "object" ||
      typeof ch.version !== "string" ||
      typeof ch.present !== "boolean" ||
      !Array.isArray(ch.files) ||
      typeof ch.score !== "number" ||
      !ch.freshness ||
      !ch.quality ||
      !ch.drift
    ) {
      return null;
    }
    return ch;
  } catch {
    return null;
  }
}
