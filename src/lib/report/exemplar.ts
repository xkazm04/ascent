// Exemplar diff (moonshot #34) — the PURE half.
//
// The time diff (`compare.ts`) answers "what changed here". This answers the question it structurally
// cannot: *what does a stronger repo have at the EVIDENCE level that this one lacks, and which
// practice transfers it?* Three exemplar modes, one profile shape: a named peer repo, the org's best
// on a dimension, or the public cohort's top decile.
//
// No DB, no `next/*`, no clock — the server reads live in `exemplar-load.ts` (the `-load.ts` sibling
// pattern that keeps the client/server boundary intact; see the `build-not-in-gate` note). Type-only
// imports from `@/lib/db/scans` are erased at compile time, exactly as `compare.ts` does.
//
// ── FRAMING RULE, and it is not decoration ───────────────────────────────────────────────────────
// Everything here is **has / lacks**, never better / worse. A signal a library lacks and a service
// carries is a difference, not a defect. So the diff is two-directional by construction
// (`absentSignals` AND `aheadSignals`): a one-directional panel would be dishonest, and would read as
// a ranking of teams rather than a transfer of practice.
//
// ── HONEST NULLS ─────────────────────────────────────────────────────────────────────────────────
// A dimension one side did not score is `notComparable`: null gaps, excluded from every count. It is
// never coerced to 0, which would manufacture a score gap out of an absence of measurement.
//
// ── THE MATCH LEVEL IS THE SIGNAL, NOT THE STRING ────────────────────────────────────────────────
// Every set comparison here runs through `diffSignalSets` (compare.ts), which keys on the signal NAME
// with embedded counts blanked, and returns the original strings for display. Exact normalized string
// equality is the right level for one repo against its own earlier scan — a moved count IS the finding
// there — and the wrong one ACROSS repos, where two projects never phrase a detector line identically:
// it told a repo with a test framework that the exemplar has one and it does not, landed the same
// count-bearing line in `absentSignals` AND `aheadSignals`, and fragmented cohort consensus below its
// support threshold so a dimension contributed no evidence at all (UAT `SAM-L1-10`). The normalizer for
// exactly this was already written in the neighbouring module and was not imported.
//
// Raw strings survive to the reader: `absentSignals` carries what the EXEMPLAR's detector wrote,
// `aheadSignals` what the SUBJECT's did. The key is used for the lookup only.

import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";
import type { DimensionId, RepoArchetype } from "@/lib/types";
import { DIMENSIONS } from "@/lib/maturity/model";
import { diffSignalSets } from "@/lib/report/compare";
import { PRACTICES } from "@/lib/practices";
import { minedStarter, type MinedPractice } from "@/lib/org/practice-mining";
import { COHORT_MIN, CORPUS_BASIS } from "@/lib/corpus/eligibility";
import { orgTabHref } from "@/lib/org/orgTabs";

// ── Floors ───────────────────────────────────────────────────────────────────────────────────────

/** Repos a cohort needs before it is a cohort at all. Same discipline as `COHORT_MIN`. */
export const COHORT_EXEMPLAR_MIN = COHORT_MIN;
/**
 * Distinct owning ORGS a cohort needs. This is the floor this item adds, and it is the answer to the
 * cross-tenant question: five public repos belonging to one tenant is a de-facto private view of that
 * tenant's engineering, rebranded as "the cohort". `CHAMPION_MIN_POP = 3` is already this codebase's
 * floor for "is this pattern real", so the org floor uses the same number.
 */
export const COHORT_MIN_ORGS = 3;
/** Share of the top decile that must carry a signal before it enters the cohort profile. */
export const COHORT_SUPPORT = 2 / 3;
/** Rows per cohort query. Mirrors `BENCHMARK_CORPUS_CAP`'s reasoning at a smaller, per-slice scale. */
export const EXEMPLAR_CANDIDATE_CAP = 2000;

/** Members of the top decile, floored at 3 — a "top decile" of 5 repos is otherwise a single repo. */
export function decileSize(n: number): number {
  return Math.min(n, Math.max(3, Math.ceil(n * 0.1)));
}

// ── Ref grammar ──────────────────────────────────────────────────────────────────────────────────

export type ExemplarRef =
  | { kind: "repo"; owner: string; name: string }
  /** `dimId: null` is the bare `org:best` — ranked on overall score rather than one dimension. */
  | { kind: "org-best"; dimId: DimensionId | null }
  | { kind: "cohort"; by: "lang"; value: string }
  | { kind: "cohort"; by: "archetype"; value: RepoArchetype };

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const DIM_IDS = new Set(DIMENSIONS.map((d) => d.id as string));
const ARCHETYPES = new Set<string>(["solo", "team", "org"]);

/**
 * Parse a `?against=` token. An unparseable ref returns **null**, and the page then SAYS the
 * comparison was not made — it never silently falls back to another exemplar, because a comparison
 * the reader did not ask for, rendered where the one they did ask for should be, is worse than none.
 */
export function parseExemplarRef(raw: string | null | undefined): ExemplarRef | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  if (s === "org:best") return { kind: "org-best", dimId: null };
  if (s.startsWith("org:best:")) {
    const dim = s.slice("org:best:".length).toUpperCase();
    return DIM_IDS.has(dim) ? { kind: "org-best", dimId: dim as DimensionId } : null;
  }
  if (s.startsWith("cohort:lang:")) {
    const value = s.slice("cohort:lang:".length).trim();
    return value && SEGMENT.test(value) ? { kind: "cohort", by: "lang", value } : null;
  }
  if (s.startsWith("cohort:archetype:")) {
    const value = s.slice("cohort:archetype:".length).trim().toLowerCase();
    return ARCHETYPES.has(value) ? { kind: "cohort", by: "archetype", value: value as RepoArchetype } : null;
  }
  // `repo:` prefix optional — a bare `owner/name` is what a user pastes.
  const body = s.startsWith("repo:") ? s.slice("repo:".length) : s;
  const parts = body.split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) return null;
  return { kind: "repo", owner, name };
}

/** The canonical URL token — so `formatExemplarRef(parseExemplarRef(x))` round-trips and the compare
 *  URL stays shareable and back-button-safe. */
export function formatExemplarRef(ref: ExemplarRef): string {
  switch (ref.kind) {
    case "repo":
      return `repo:${ref.owner}/${ref.name}`;
    case "org-best":
      return ref.dimId ? `org:best:${ref.dimId}` : "org:best";
    default:
      return `cohort:${ref.by}:${ref.value}`;
  }
}

/**
 * Human label for a ref, used before any profile has been resolved (picker options, notices).
 *
 * `publicCorpus` is not cosmetic. A viewer who is not a member of the repo's org is resolved to the
 * SHARED PUBLIC org, and "best in org" then means "best in the public corpus" — a different claim
 * about a different population, told to the reader in the first person (UAT `SAM-L1-13`).
 */
export function exemplarRefLabel(ref: ExemplarRef, opts: { publicCorpus?: boolean } = {}): string {
  switch (ref.kind) {
    case "repo":
      return `${ref.owner}/${ref.name}`;
    case "org-best":
      if (opts.publicCorpus) {
        return ref.dimId ? `best in the public corpus for ${ref.dimId}` : "best in the public corpus";
      }
      return ref.dimId ? `best in org for ${ref.dimId}` : "best in org overall";
    default:
      return ref.by === "lang" ? `${ref.value} · top decile` : `${ref.value} repos · top decile`;
  }
}

/**
 * Picker `<optgroup>` names. Two of the five exist ONLY because the viewer's org may be the shared
 * public namespace: `readableOrgForOwner` downgrades a non-member to it, and the picker then listed
 * up to `ORG_CANDIDATE_CAP` public-corpus repos under "Your repos" with an "Org best" that meant
 * "best in the public corpus" (UAT `SAM-L1-13`). The label follows the population, not the code path.
 */
export type ExemplarGroup = "Your repos" | "Public corpus" | "Org best" | "Corpus best" | "Cohort";

/** The group a single-repo / org-best option belongs to, given whose corpus it was drawn from. */
export function exemplarGroups(publicCorpus: boolean): { repos: ExemplarGroup; best: ExemplarGroup } {
  return publicCorpus
    ? { repos: "Public corpus", best: "Corpus best" }
    : { repos: "Your repos", best: "Org best" };
}

// ── The exemplar side ────────────────────────────────────────────────────────────────────────────

/** What the comparison was computed on. A gap without its basis is not an auditable number. */
export interface ExemplarBasis {
  rubric: string;
  excludesMockEngine: true;
  /** Repos of the decile that had to carry a signal (cohort only); null for single-repo modes. */
  minSupport: number | null;
  /** True when the SUBJECT scan itself is outside the eligible set — stated, never hidden. */
  subjectEligible: boolean;
}

export interface ExemplarProfile {
  /** Canonical ref, echoed back into the URL. */
  key: string;
  kind: "repo" | "org-best" | "cohort";
  label: string;
  /** null for a cohort — a cohort is NEVER attributed to the repos it was built from. */
  repoFullName: string | null;
  /** ISO string (wire-safe dates); null for a cohort, which has no single scan time. */
  scannedAt: string | null;
  overallScore: number | null;
  /** Cohort dimensions carry consensus evidence and MEDIAN scores. */
  dimensions: ComparableDimension[];
  /** Cohort member count; null for single-repo modes. */
  population: number | null;
  basis: { rubric: string; excludesMockEngine: true; minSupport: number | null };
}

/** Picker option — one selectable exemplar. `group` drives the `<optgroup>`. */
export interface ExemplarOption {
  value: string;
  label: string;
  group: ExemplarGroup;
  /** Only ever set for a single-repo option; a cohort option never carries a scan time. */
  scannedAt: string | null;
}

// ── The diff ─────────────────────────────────────────────────────────────────────────────────────

export interface ExemplarDimensionDiff {
  id: DimensionId;
  name: string;
  subjectScore: number | null;
  exemplarScore: number | null;
  /** exemplar − subject; null unless BOTH sides scored the dimension. */
  scoreGap: number | null;
  signalGap: number | null;
  /** In the exemplar, not in the subject — THE TRANSFER LIST. */
  absentSignals: string[];
  /** In the subject, not in the exemplar. The other direction, always rendered. */
  aheadSignals: string[];
  gapsOnlyInSubject: string[];
  /** False when only one side scored it: excluded from every count, no delta rendered. */
  comparable: boolean;
  /** One line naming the concrete signals to transfer; null rather than a filler sentence. */
  transferLine: string | null;
}

export interface ExemplarDiff {
  exemplar: {
    key: string;
    kind: ExemplarProfile["kind"];
    label: string;
    repoFullName: string | null;
    scannedAt: string | null;
    overallScore: number | null;
    population: number | null;
  };
  subject: { scanId: string; scannedAt: string; overallScore: number };
  /** exemplar − subject overall; null when the exemplar has no overall score (never fabricated). */
  overallGap: number | null;
  /** Canonical `DIMENSIONS` order; a dimension neither side scored is omitted entirely. */
  dimensions: ExemplarDimensionDiff[];
  notComparable: DimensionId[];
  absentSignalCount: number;
  aheadSignalCount: number;
  /** True when the exemplar has nothing the subject lacks — a real answer, not an empty panel. */
  nothingToTransfer: boolean;
  basis: ExemplarBasis;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Compare one scan against a resolved exemplar profile, per dimension, in canonical order.
 *
 * `subjectEligible` travels in from the caller (only the load layer can know whether the subject scan
 * cleared `BENCHMARK_ELIGIBLE`). An ineligible subject still renders — with the basis line saying the
 * two sides were measured differently. Hiding the comparison would be the less honest choice; hiding
 * the mismatch would be the dishonest one.
 */
export function diffAcrossRepos(
  subject: ComparableScan,
  exemplar: ExemplarProfile,
  opts: { subjectEligible?: boolean } = {},
): ExemplarDiff {
  const subjectDims = new Map(subject.dimensions.map((d) => [d.dimId, d]));
  const exemplarDims = new Map(exemplar.dimensions.map((d) => [d.dimId, d]));

  const dimensions: ExemplarDimensionDiff[] = [];
  const notComparable: DimensionId[] = [];
  let absentSignalCount = 0;
  let aheadSignalCount = 0;

  for (const def of DIMENSIONS) {
    const mine = subjectDims.get(def.id);
    const theirs = exemplarDims.get(def.id);
    if (!mine && !theirs) continue;

    const comparable = Boolean(mine && theirs);
    if (!comparable) notComparable.push(def.id);

    const evidence = diffSignalSets(mine?.evidence ?? [], theirs?.evidence ?? []);
    const gaps = diffSignalSets(mine?.gaps ?? [], theirs?.gaps ?? []);
    // Only a two-sided dimension contributes signals: a "gap" against a side that was never measured
    // is an artifact of the measurement, not of the repository.
    const absentSignals = comparable ? evidence.onlyInB : [];
    const aheadSignals = comparable ? evidence.onlyInA : [];
    const gapsOnlyInSubject = comparable ? gaps.onlyInA : [];
    absentSignalCount += absentSignals.length;
    aheadSignalCount += aheadSignals.length;

    const scoreGap = mine && theirs ? theirs.score - mine.score : null;
    const signalGap = mine && theirs ? theirs.signalScore - mine.signalScore : null;

    dimensions.push({
      id: def.id,
      name: (theirs ?? mine)!.name,
      subjectScore: mine ? mine.score : null,
      exemplarScore: theirs ? theirs.score : null,
      scoreGap,
      signalGap,
      absentSignals,
      aheadSignals,
      gapsOnlyInSubject,
      comparable,
      transferLine:
        absentSignals.length > 0
          ? `${def.id}${scoreGap !== null && scoreGap !== 0 ? ` ${signed(scoreGap)}` : ""}: exemplar has ${absentSignals.join("; ")}`
          : null,
    });
  }

  return {
    exemplar: {
      key: exemplar.key,
      kind: exemplar.kind,
      label: exemplar.label,
      repoFullName: exemplar.repoFullName,
      scannedAt: exemplar.scannedAt,
      overallScore: exemplar.overallScore,
      population: exemplar.population,
    },
    subject: { scanId: subject.id, scannedAt: subject.scannedAt, overallScore: subject.overallScore },
    overallGap: exemplar.overallScore === null ? null : exemplar.overallScore - subject.overallScore,
    dimensions,
    notComparable,
    absentSignalCount,
    aheadSignalCount,
    nothingToTransfer: absentSignalCount === 0,
    basis: { ...exemplar.basis, subjectEligible: opts.subjectEligible ?? true },
  };
}

// ── Selection: the org's best ────────────────────────────────────────────────────────────────────

/** A candidate repo for `org:best`, already filtered to eligible scans by the load layer. */
export interface OrgCandidate {
  repoFullName: string;
  scannedAt: string;
  overallScore: number;
  dimensions: ComparableDimension[];
}

/**
 * The org's strongest repo — by `signalScore` on `dimId`, or by overall score for the bare ref. The
 * subject repo is excluded (a repo is not its own exemplar). Deterministic on ties (lexicographic
 * full name), so the same org always resolves to the same exemplar and a shared URL stays stable.
 *
 * `signalScore` rather than the blended score on purpose: the blend carries LLM judgment, and "who
 * has the most detected evidence for this dimension" is the question a transfer list is built on.
 */
export function selectOrgBest(
  candidates: readonly OrgCandidate[],
  opts: { dimId: DimensionId | null; excludeFullName: string; publicCorpus?: boolean },
): ExemplarProfile | null {
  const ref: ExemplarRef = { kind: "org-best", dimId: opts.dimId };
  const pool = candidates.filter((c) => c.repoFullName !== opts.excludeFullName);
  const scored = pool
    .map((c) => {
      const dim = opts.dimId ? c.dimensions.find((d) => d.dimId === opts.dimId) : null;
      if (opts.dimId && !dim) return null; // never rank a repo on a dimension it did not score
      return { c, rank: dim ? dim.signalScore : c.overallScore };
    })
    .filter((x): x is { c: OrgCandidate; rank: number } => x !== null)
    .sort((a, b) => b.rank - a.rank || a.c.repoFullName.localeCompare(b.c.repoFullName));

  const best = scored[0]?.c;
  if (!best) return null;
  return {
    key: formatExemplarRef(ref),
    kind: "org-best",
    // The heading names the POPULATION this was best in, which is not "org" for a viewer resolved to
    // the shared public namespace (UAT `SAM-L1-13`).
    label: `${exemplarRefLabel(ref, { publicCorpus: opts.publicCorpus })} · ${best.repoFullName}`,
    repoFullName: best.repoFullName,
    scannedAt: best.scannedAt,
    overallScore: best.overallScore,
    dimensions: best.dimensions,
    population: null,
    basis: { ...CORPUS_BASIS, minSupport: null },
  };
}

/** A profile for a single named peer repo — the `repo:` mode, one shape with the other two. */
export function repoProfile(
  ref: Extract<ExemplarRef, { kind: "repo" }>,
  scan: { repoFullName: string; scannedAt: string; overallScore: number; dimensions: ComparableDimension[] },
): ExemplarProfile {
  return {
    key: formatExemplarRef(ref),
    kind: "repo",
    label: scan.repoFullName,
    repoFullName: scan.repoFullName,
    scannedAt: scan.scannedAt,
    overallScore: scan.overallScore,
    dimensions: scan.dimensions,
    population: null,
    basis: { ...CORPUS_BASIS, minSupport: null },
  };
}

// ── Selection: the cohort ────────────────────────────────────────────────────────────────────────

/** One public-corpus member. `orgId` and `repoFullName` are used ONLY to enforce the floors and to
 *  order the decile deterministically — neither ever reaches the returned profile. */
export interface CohortMember {
  orgId: string;
  repoFullName: string;
  overallScore: number;
  dimensions: ComparableDimension[];
}

export type CohortOutcome =
  | { kind: "ok"; profile: ExemplarProfile }
  | { kind: "below-floor"; population: number; min: number };

/** Median of a non-empty numeric list, rounded — cohort scores are integers on the wire. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return Math.round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

/** How many of `lists` carry the SAME SIGNAL as `s`. Signal-level, not string-level: a decile whose
 *  members each wrote their own count for one detector would otherwise support each phrasing once and
 *  clear no threshold, and the dimension would contribute no consensus evidence at all. */
function support(s: string, lists: readonly string[][]): number {
  return lists.filter((l) => diffSignalSets([s], l).shared.length > 0).length;
}

/**
 * The public cohort's top decile, as one profile. AGGREGATE-ONLY BY CONSTRUCTION: no member repo is
 * named, listed, linked or counted per-repo anywhere in the return value. That plus the two floors is
 * the whole answer to "is this a cross-tenant leak".
 *
 * Two floors, and the second is the one that matters: `COHORT_EXEMPLAR_MIN` repos AND
 * `COHORT_MIN_ORGS` distinct owning orgs. Five public repos from a single tenant would otherwise be
 * that tenant's engineering, aggregated but recoverable. Below either floor the answer is
 * `below-floor` with the real population — never a partial cohort, never a silent fallback to a
 * broader slice, because a reader cannot tell a substituted cohort from the one they asked for.
 */
export function buildCohortProfile(
  members: readonly CohortMember[],
  ref: Extract<ExemplarRef, { kind: "cohort" }>,
): CohortOutcome {
  const orgs = new Set(members.map((m) => m.orgId));
  if (members.length < COHORT_EXEMPLAR_MIN) {
    return { kind: "below-floor", population: members.length, min: COHORT_EXEMPLAR_MIN };
  }
  if (orgs.size < COHORT_MIN_ORGS) {
    return { kind: "below-floor", population: orgs.size, min: COHORT_MIN_ORGS };
  }

  const ranked = [...members].sort(
    (a, b) => b.overallScore - a.overallScore || a.repoFullName.localeCompare(b.repoFullName),
  );
  const decile = ranked.slice(0, decileSize(ranked.length));
  const minSupport = Math.ceil(decile.length * COHORT_SUPPORT);

  const dimensions: ComparableDimension[] = [];
  for (const def of DIMENSIONS) {
    const rows = decile
      .map((m) => m.dimensions.find((d) => d.dimId === def.id))
      .filter((d): d is ComparableDimension => Boolean(d));
    // A dimension the decile did not score is ABSENT from the profile, never zero.
    if (rows.length === 0) continue;
    const evidenceLists = rows.map((r) => r.evidence);
    const gapLists = rows.map((r) => r.gaps);
    dimensions.push({
      dimId: def.id,
      name: def.name,
      score: median(rows.map((r) => r.score)),
      signalScore: median(rows.map((r) => r.signalScore)),
      evidence: consensus(evidenceLists, minSupport),
      gaps: consensus(gapLists, minSupport),
    });
  }

  return {
    kind: "ok",
    profile: {
      key: formatExemplarRef(ref),
      kind: "cohort",
      label: exemplarRefLabel(ref),
      repoFullName: null,
      scannedAt: null,
      overallScore: median(decile.map((m) => m.overallScore)),
      dimensions,
      population: members.length,
      basis: { ...CORPUS_BASIS, minSupport },
    },
  };
}

/** Strings at least `min` of the lists carry. Below the threshold a dimension contributes NO evidence
 *  rather than a thin list that reads like consensus but is one repo's phrasing. */
function consensus(lists: readonly string[][], min: number): string[] {
  const out: string[] = [];
  for (const list of lists) {
    for (const s of list) {
      if (out.some((k) => diffSignalSets([s], [k]).shared.length > 0)) continue;
      if (support(s, lists) >= min) out.push(s);
    }
  }
  return out;
}

// ── Transfer → practice join ─────────────────────────────────────────────────────────────────────

export interface TransferRow {
  dimId: DimensionId;
  absentSignals: string[];
  /** From the static catalog, joined by dimension. `null` only if a dimension loses its practice. */
  practice: { id: string; label: string; what: string } | null;
  /** The org's OWN mined shape, when the miner judged it offerable; null falls back to the catalog. */
  housePattern: { outline: string[]; exemplars: number } | null;
  applyHref: string | null;
  skillsHref: string | null;
}

/**
 * Join each transferable dimension to the practice that carries it.
 *
 * This GENERALIZES the existing `ExemplarPointer` join (`src/components/report/roadmapPieces.tsx`)
 * from "what good looks like" to "what *they* have" — the same PRACTICES-by-dimension map, not a
 * second parallel join that can disagree with the report card about which practice owns a dimension.
 *
 * `PRACTICES` is one entry per `D1..D9`, so the join is total; a dimension with no mapped practice
 * still yields a row carrying the absent signals, because the signals are the finding and the
 * practice is only the suggested vehicle.
 *
 * `orgSlug` null (a public-org viewer) yields null hrefs — nothing dangles into a tab they cannot open.
 */
export function transferJoin(
  diff: ExemplarDiff,
  mined: readonly MinedPractice[],
  orgSlug: string | null,
): TransferRow[] {
  return diff.dimensions
    .filter((d) => d.absentSignals.length > 0)
    .map((d) => {
      const practice = PRACTICES.find((p) => p.dimId === d.id) ?? null;
      const m = practice ? mined.find((x) => x.practiceId === practice.id) : undefined;
      const starter = m ? minedStarter(m) : null;
      return {
        dimId: d.id,
        absentSignals: d.absentSignals,
        practice: practice ? { id: practice.id, label: practice.label, what: practice.what } : null,
        housePattern: starter && m ? { outline: starter, exemplars: m.exemplars.length } : null,
        applyHref: orgSlug ? orgTabHref(orgSlug, "practices") : null,
        skillsHref: orgSlug ? orgTabHref(orgSlug, "skills") : null,
      };
    });
}
