// Exemplar diff (moonshot #34) — the SERVER-ONLY half.
//
// `exemplar.ts` is pure so a client component can import its types; every Prisma read lives here, in
// the `-load.ts` sibling. That split is not stylistic: importing `@/lib/db` from a module a client
// component pulls in breaks `next build` while `tsc` and vitest both stay green (the
// `build-not-in-gate` failure this repo has already paid for once).
//
// ── TENANCY IS THE WHOLE SECURITY SURFACE OF THIS FILE ───────────────────────────────────────────
//
// 1. `repo:` and `org:best` resolve ONLY inside the org the page already derived from
//    `readableOrgForOwner(owner)`. Every query carries `orgId` BESIDE the caller-supplied name
//    (gate-then-constrain, AGENTS.md), so a crafted `?against=` naming another tenant's repo is
//    `not-found` — deliberately NOT `forbidden`, which would be an existence oracle telling an
//    attacker their guess was real.
// 2. When the viewer's org is the shared public namespace, `isPrivate: false` rides the query too —
//    the same defence-in-depth clause `loadRepositoryHistory` carries.
// 3. `cohort:` NEVER reads the viewer's org. It reads `isPrivate: false` repos across the corpus and
//    returns AGGREGATE-ONLY: no member repo is named, listed, linked, or counted per-repo. The two
//    floors in `exemplar.ts` (5 repos AND 3 distinct owning orgs) are what keeps that aggregate from
//    being one tenant's engineering under another name.
// 4. No writes, so no audit row — the same choice `getOrgBenchmark` makes over the same corpus. Said
//    out loud because a cross-tenant READ that writes nothing is a decision, not an oversight.
//
// Both sides are filtered by `BENCHMARK_ELIGIBLE` (`@/lib/corpus/eligibility`): a mock-engine scan is
// a different scoring function and an old-rubric row a retired instrument, so neither may be an
// exemplar. The SUBJECT is checked separately (`isScanEligible`) and still renders when ineligible —
// with the basis line saying the two sides were measured differently.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db";
import { canonicalRepoFullName, DEFAULT_ORG_SLUG, parseStringArray, resolveOrgId } from "@/lib/db/scans-shared";
import { BENCHMARK_ELIGIBLE } from "@/lib/corpus/eligibility";
import type { ComparableDimension } from "@/lib/db/scans";
import type { RepoArchetype } from "@/lib/types";
import {
  buildCohortProfile,
  COHORT_EXEMPLAR_MIN,
  EXEMPLAR_CANDIDATE_CAP,
  exemplarRefLabel,
  formatExemplarRef,
  repoProfile,
  selectOrgBest,
  type CohortMember,
  type ExemplarOption,
  type ExemplarProfile,
  type ExemplarRef,
} from "@/lib/report/exemplar";

export type ExemplarResolution =
  | { kind: "ok"; profile: ExemplarProfile }
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "below-floor"; population: number; min: number }
  /** DB down or not configured — degrades like every sibling reader instead of taking the page down. */
  | { kind: "unavailable" };

/** How many org repos a picker or an `org:best` scan will consider. */
const ORG_CANDIDATE_CAP = 500;

const DIM_SELECT = { select: { dimId: true, name: true, score: true, signalScore: true, evidence: true, gaps: true } } as const;

const SCAN_SELECT = {
  where: BENCHMARK_ELIGIBLE,
  orderBy: { scannedAt: "desc" },
  take: 1,
  select: { scannedAt: true, overallScore: true, archetype: true, dimensions: DIM_SELECT },
} as const;

function toDimensions(rows: { dimId: string; name: string; score: number; signalScore: number; evidence: string | null; gaps: string | null }[]): ComparableDimension[] {
  return rows.map((d) => ({
    dimId: d.dimId,
    name: d.name,
    score: d.score,
    signalScore: d.signalScore,
    evidence: parseStringArray(d.evidence),
    gaps: parseStringArray(d.gaps),
  }));
}

// ── The cohort seam ──────────────────────────────────────────────────────────────────────────────

export interface CohortQuery {
  by: "lang" | "archetype";
  value: string;
  cap: number;
}

/**
 * Where cohort members come from. TODAY: the live public corpus, below. Moonshot #2 (the open
 * benchmark corpus) swaps in a rubric-versioned SNAPSHOT behind this exact signature — no caller
 * changes, and the floors and aggregate-only rules keep applying because they live in `exemplar.ts`,
 * not in the source.
 */
export type CohortSource = (q: CohortQuery) => Promise<CohortMember[]>;

/**
 * The live public corpus: every `isPrivate: false` repo whose latest ELIGIBLE scan matches the slice,
 * across all orgs. `orgId` is read for one purpose only — enforcing `COHORT_MIN_ORGS` — and never
 * leaves `buildCohortProfile`.
 */
export const livePublicCorpus: CohortSource = async (q) => {
  const repos = await getPrisma().repository.findMany({
    where: {
      isPrivate: false,
      scans: { some: BENCHMARK_ELIGIBLE },
      ...(q.by === "lang" ? { primaryLanguage: q.value } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: q.cap,
    select: { orgId: true, fullName: true, scans: SCAN_SELECT },
  });
  const out: CohortMember[] = [];
  for (const r of repos) {
    const s = r.scans[0];
    if (!s) continue;
    // Archetype lives on the SCAN, so that slice is filtered here rather than in the where clause.
    if (q.by === "archetype" && s.archetype !== q.value) continue;
    out.push({
      orgId: r.orgId,
      repoFullName: r.fullName,
      overallScore: s.overallScore,
      dimensions: toDimensions(s.dimensions),
    });
  }
  return out;
};

// ── Resolution ───────────────────────────────────────────────────────────────────────────────────

/**
 * Did the subject's own scan clear the eligibility filter? An ineligible subject is NOT hidden — the
 * panel renders and the basis line says the two sides were produced by different instruments. Hiding
 * it would answer a question nobody asked; hiding the mismatch would be the dishonest half.
 */
export async function isScanEligible(scanId: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  return dbReadSafe(async () => {
    const row = await getPrisma().scan.findFirst({ where: { id: scanId, ...BENCHMARK_ELIGIBLE }, select: { id: true } });
    return row !== null;
  }, false);
}

export async function resolveExemplar(
  ref: ExemplarRef,
  ctx: { orgSlug: string; subjectFullName: string },
  source: CohortSource = livePublicCorpus,
): Promise<ExemplarResolution> {
  if (!isDbConfigured()) return { kind: "unavailable" };
  return dbReadSafe<ExemplarResolution>(async () => {
    if (ref.kind === "cohort") return resolveCohort(ref, source);
    const orgId = await resolveOrgId(ctx.orgSlug);
    if (!orgId) return { kind: "not-found" };
    return ref.kind === "repo" ? resolveRepo(ref, orgId, ctx) : resolveOrgBest(ref, orgId, ctx);
  }, { kind: "unavailable" });
}

async function resolveRepo(
  ref: Extract<ExemplarRef, { kind: "repo" }>,
  orgId: string,
  ctx: { orgSlug: string; subjectFullName: string },
): Promise<ExemplarResolution> {
  const fullName = canonicalRepoFullName(ref.owner, ref.name);
  // A repo is not its own exemplar — and saying so is clearer than a diff of everything against zero.
  if (fullName === ctx.subjectFullName) return { kind: "forbidden" };
  const repo = await getPrisma().repository.findFirst({
    // GATE-THEN-CONSTRAIN: `orgId` sits beside the caller-supplied name, so another tenant's repo is
    // simply not found. Removing it is the leak this lane's fail-before pins.
    where: {
      orgId,
      fullName,
      ...(ctx.orgSlug === DEFAULT_ORG_SLUG ? { isPrivate: false } : {}),
    },
    select: { fullName: true, scans: SCAN_SELECT },
  });
  if (!repo) return { kind: "not-found" };
  const s = repo.scans[0];
  // The repo exists but has no ELIGIBLE scan: there is nothing comparable to show, and inventing a
  // comparison from a mock or old-rubric row would be the exact error the filter exists to prevent.
  if (!s) return { kind: "not-found" };
  return {
    kind: "ok",
    profile: repoProfile(ref, {
      repoFullName: repo.fullName,
      scannedAt: s.scannedAt.toISOString(),
      overallScore: s.overallScore,
      dimensions: toDimensions(s.dimensions),
    }),
  };
}

async function resolveOrgBest(
  ref: Extract<ExemplarRef, { kind: "org-best" }>,
  orgId: string,
  ctx: { subjectFullName: string },
): Promise<ExemplarResolution> {
  const candidates = await loadOrgCandidates(orgId);
  const profile = selectOrgBest(candidates, { dimId: ref.dimId, excludeFullName: ctx.subjectFullName });
  return profile ? { kind: "ok", profile } : { kind: "not-found" };
}

async function loadOrgCandidates(orgId: string) {
  const repos = await getPrisma().repository.findMany({
    where: { orgId, scans: { some: BENCHMARK_ELIGIBLE } },
    orderBy: { updatedAt: "desc" },
    take: ORG_CANDIDATE_CAP,
    select: { fullName: true, scans: SCAN_SELECT },
  });
  return repos.flatMap((r) => {
    const s = r.scans[0];
    return s
      ? [{
          repoFullName: r.fullName,
          scannedAt: s.scannedAt.toISOString(),
          overallScore: s.overallScore,
          dimensions: toDimensions(s.dimensions),
        }]
      : [];
  });
}

async function resolveCohort(
  ref: Extract<ExemplarRef, { kind: "cohort" }>,
  source: CohortSource,
): Promise<ExemplarResolution> {
  const members = await source({ by: ref.by, value: ref.value, cap: EXEMPLAR_CANDIDATE_CAP });
  const out = buildCohortProfile(members, ref);
  // No silent fallback to a broader slice: a reader cannot tell a substituted cohort from the one
  // they asked for, so below the floor the page says so and shows nothing.
  return out.kind === "ok" ? { kind: "ok", profile: out.profile } : out;
}

// ── Picker options ───────────────────────────────────────────────────────────────────────────────

/**
 * Everything the viewer could compare this repo against. Empty is a legitimate answer — a one-repo
 * org with no public cohort has no exemplar, and the picker then simply does not offer the field.
 *
 * SELF-HOSTED needs no flag here: on a self-hosted install the "public corpus" is that install's own
 * repos, which will not clear `COHORT_MIN_ORGS`, so the cohort options are absent. The floor is the
 * mechanism (`selfHosted()` turns plan gates off and changes nothing on this path).
 */
/**
 * The two facets `listExemplarOptions` needs that `ScanComparison` does not carry: the repo's primary
 * language (a Repository column) and its archetype (a Scan column). Read here rather than widening a
 * `src/lib/db` type this lane must not edit. Org-constrained like every other read in this file.
 */
export async function loadSubjectFacets(
  orgSlug: string,
  subjectFullName: string,
): Promise<{ primaryLanguage: string | null; archetype: RepoArchetype }> {
  const fallback = { primaryLanguage: null, archetype: "org" as RepoArchetype };
  if (!isDbConfigured()) return fallback;
  return dbReadSafe(async () => {
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return fallback;
    const repo = await getPrisma().repository.findFirst({
      where: { orgId, fullName: subjectFullName },
      select: { primaryLanguage: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { archetype: true } } },
    });
    if (!repo) return fallback;
    return {
      primaryLanguage: repo.primaryLanguage ?? null,
      archetype: (repo.scans[0]?.archetype ?? "org") as RepoArchetype,
    };
  }, fallback);
}

export async function listExemplarOptions(
  ctx: {
    orgSlug: string;
    subjectFullName: string;
    primaryLanguage: string | null;
    archetype: RepoArchetype;
  },
  source: CohortSource = livePublicCorpus,
): Promise<ExemplarOption[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<ExemplarOption[]>(async () => {
    const orgId = await resolveOrgId(ctx.orgSlug);
    if (!orgId) return [];
    const candidates = (await loadOrgCandidates(orgId)).filter((c) => c.repoFullName !== ctx.subjectFullName);

    const options: ExemplarOption[] = candidates.map((c) => {
      const [owner = "", name = ""] = c.repoFullName.split("/");
      return {
        value: formatExemplarRef({ kind: "repo", owner, name }),
        label: c.repoFullName,
        group: "Your repos" as const,
        scannedAt: c.scannedAt,
      };
    });
    if (candidates.length > 0) {
      const ref: ExemplarRef = { kind: "org-best", dimId: null };
      options.push({ value: formatExemplarRef(ref), label: exemplarRefLabel(ref), group: "Org best", scannedAt: null });
    }

    const slices: Extract<ExemplarRef, { kind: "cohort" }>[] = [
      ...(ctx.primaryLanguage ? [{ kind: "cohort", by: "lang", value: ctx.primaryLanguage } as const] : []),
      { kind: "cohort", by: "archetype", value: ctx.archetype } as const,
    ];
    for (const ref of slices) {
      // Offered only when it actually clears BOTH floors — an option that resolves to "below floor"
      // is a promise the page cannot keep.
      const members = await source({ by: ref.by, value: ref.value, cap: EXEMPLAR_CANDIDATE_CAP });
      if (members.length < COHORT_EXEMPLAR_MIN) continue;
      if (buildCohortProfile(members, ref).kind !== "ok") continue;
      options.push({ value: formatExemplarRef(ref), label: exemplarRefLabel(ref), group: "Cohort", scannedAt: null });
    }
    return options;
  }, []);
}
