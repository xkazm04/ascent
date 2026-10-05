// Custom repo segments — user-defined named slices of the fleet (platform, mobile, legacy,
// acquisitions). A segment is an org-scoped tag; repos are tagged via RepoSegment (many-to-many).
// Every org aggregate in src/lib/db/org.ts accepts an optional `segmentId` that scopes it to a
// segment's repos, and `compareSegments` puts two segments side by side (the segment-vs-segment
// view). Like the rest of src/lib/db, every function is a no-op / null when DATABASE_URL is unset.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgRollup } from "@/lib/db/org";
import { getOrgId } from "@/lib/db/org-rollup";
import { canonicalRepoFullName } from "@/lib/db/scans-shared";
import {
  compareScopes,
  resolveComparePair,
  summarizeScopedRepos,
  type SegmentComparison,
  type SegmentSummary,
} from "@/lib/db/segments-compare";
import {
  matchesRule,
  parseSegmentRule,
  segmentDrift,
  serializeSegmentRule,
  type SegmentMember,
  type SegmentMemberSource,
  type SegmentRule,
} from "@/lib/org/segmentRule";

/** Repository.fullName is stored trimmed and lowercased on each side of the slash.
 *  A tag lookup that keeps the caller's casing misses that row. */
function canonicalJoinedFullName(fullName: string): string {
  const slash = fullName.indexOf("/");
  if (slash < 0) return fullName.trim().toLowerCase();
  return canonicalRepoFullName(fullName.slice(0, slash), fullName.slice(slash + 1));
}

const DEFAULT_COLOR = "#3b9eff";
export const SEGMENT_NAME_MAX = 60;
const NAME_MAX = SEGMENT_NAME_MAX;
const SEGMENT_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Trim and bound a user-supplied segment name. */
export function normalizeSegmentName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX);
}

/** Validate a `#rrggbb` (or `#rgb`) hex color; fall back to the brand accent when malformed. */
export function normalizeColor(raw?: string | null): string {
  if (!raw) return DEFAULT_COLOR;
  const v = raw.trim();
  return SEGMENT_COLOR_RE.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
}

/**
 * repositories-segments #5: the API-facing validation the normalizers deliberately don't do. The
 * normalize* pair sanitizes-and-continues (a malformed colour silently became the brand accent, a
 * 61+-char name was silently truncated — both behind a 200 `{ ok: true }`), which is fine as a last
 * line of defence but rewrote API callers' intent with no signal. Routes call this FIRST and return
 * 400, so `{ color: "rebeccapurple" }` can no longer recolor a segment to blue while claiming success.
 * The in-app UI constrains its inputs (palette swatches + maxLength), so a 400 here is automation-only.
 * Returns a human-readable error, or null when the input is acceptable.
 */
export function segmentInputError(input: { name?: unknown; color?: unknown }): string | null {
  if (input.name != null) {
    if (typeof input.name !== "string") return "Segment name must be text.";
    const n = input.name.trim();
    if (!n) return "Segment name can't be empty.";
    if (n.length > NAME_MAX) return `Segment name must be ${NAME_MAX} characters or fewer.`;
  }
  if (input.color != null && input.color !== "") {
    if (typeof input.color !== "string" || !SEGMENT_COLOR_RE.test(input.color.trim())) {
      return "Segment colour must be a #rgb or #rrggbb hex.";
    }
  }
  return null;
}

export interface SegmentRow {
  id: string;
  name: string;
  color: string;
  /** Repos currently TAGGED into this segment — every repo ever added via setRepoSegment(s), whether
   *  or not it's watched or has ever been scanned. (G4-08) This is a DIFFERENT universe than
   *  `SegmentSummary.repoCount` below, which counts only the segment's watched-or-scanned repos (the
   *  fleet-rollup universe getOrgRollup already restricts to). A segment can legitimately show a
   *  different repoCount here than on the Segments comparison tab — that's "tagged" vs "scored" repos,
   *  not a bug — so any UI surfacing both MUST label which one it's showing. */
  repoCount: number;
  /** The segment's DECLARED membership, or null for a hand-kept list. A segment that carries one is
   *  expected to CONVERGE toward it (applySegmentRule), so every surface that renders a segment can
   *  say whether its tag set is a declaration or a snapshot. See src/lib/org/segmentRule.ts. */
  rule: SegmentRule | null;
  createdAt: string;
}

/** All segments for an org, with live tagged-repo counts, newest first. */
export async function listSegments(orgSlug: string): Promise<SegmentRow[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const segments = await getPrisma().segment.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, color: true, ruleJson: true, createdAt: true, _count: { select: { repos: true } } },
  });
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    repoCount: s._count.repos,
    rule: parseSegmentRule(s.ruleJson),
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function createSegment(
  orgSlug: string,
  input: { name: string; color?: string | null; rule?: SegmentRule | null },
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Resolve an EXISTING org — never upsert one into being. On auth-off deployments the route's access
  // gate is permissive, so upserting here let any caller materialize a junk org row (with name=slug)
  // for an arbitrary slug. Match every sibling function's "unknown org → no-op" contract instead.
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const created = await prisma.segment.create({
    data: {
      orgId,
      name: normalizeSegmentName(input.name),
      color: normalizeColor(input.color),
      ...(input.rule !== undefined ? { ruleJson: serializeSegmentRule(input.rule) } : {}),
    },
    select: { id: true },
  });
  return created;
}

export async function updateSegment(
  id: string,
  data: { name?: string; color?: string | null; rule?: SegmentRule | null },
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().segment.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: normalizeSegmentName(data.name) } : {}),
      ...("color" in data ? { color: normalizeColor(data.color) } : {}),
      // `"rule" in data`, not a truthiness test: `rule: null` is the deliberate act of CLEARING the
      // declaration (a segment going back to a hand-kept list), which must reach the column.
      ...("rule" in data ? { ruleJson: serializeSegmentRule(data.rule ?? null) } : {}),
    },
  });
  return true;
}

/** Delete a segment and its membership rows atomically (no DB cascade under relationMode="prisma",
 *  so an unwrapped failure between the two deletes could otherwise leave an orphaned empty segment). */
export async function deleteSegment(id: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.repoSegment.deleteMany({ where: { segmentId: id } }),
    prisma.segment.delete({ where: { id } }),
  ]);
  return true;
}

/** The owning org's slug for a segment id (per-row tenant gate on /api/org/segments/:id). Null = unknown id. */
export async function getSegmentOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const s = await getPrisma().segment.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return s?.org.slug ?? null;
}

/**
 * Tag (`member=true`) or untag (`member=false`) a repo into a segment, scoped to the org so a
 * caller can't touch another tenant's data. Idempotent. Returns false when the segment or repo
 * doesn't belong to the org (or persistence is off).
 */
export async function setRepoSegment(
  orgSlug: string,
  segmentId: string,
  fullName: string,
  member: boolean,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const key = canonicalJoinedFullName(fullName);
  const [segment, repo] = await Promise.all([
    prisma.segment.findFirst({ where: { id: segmentId, orgId }, select: { id: true } }),
    prisma.repository.findUnique({ where: { orgId_fullName: { orgId, fullName: key } }, select: { id: true } }),
  ]);
  if (!segment || !repo) return false;

  if (member) {
    await prisma.repoSegment.upsert({
      where: { segmentId_repoId: { segmentId, repoId: repo.id } },
      update: {},
      create: { segmentId, repoId: repo.id, source: "manual" },
    });
  } else {
    await prisma.repoSegment.deleteMany({ where: { segmentId, repoId: repo.id } });
  }
  return true;
}

/**
 * Bulk tag (`member=true`) or untag (`member=false`) MANY repos into a segment in one round-trip —
 * the backend for auto-segments (by language) and the leaderboard's bulk action bar. Org-scoped:
 * the segment must belong to the org and only the org's repos are touched (unknown fullNames are
 * ignored). Idempotent — adds use `createMany({ skipDuplicates })`, removes a bounded `deleteMany`.
 * Returns the number of membership rows actually created/deleted, or -1 when the segment isn't the
 * org's (or persistence is off) so the route can 404.
 */
export async function setRepoSegmentsBulk(
  orgSlug: string,
  segmentId: string,
  fullNames: string[],
  member: boolean,
  /** Who owns the rows this call creates. Defaults to "manual", so every existing caller (the tagging
   *  UI, the leaderboard's bulk bar) keeps writing rows a rule convergence may never reap. Only
   *  applySegmentRule passes "rule". */
  source: SegmentMemberSource = "manual",
): Promise<number> {
  if (!isDbConfigured()) return -1;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return -1;
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, orgId }, select: { id: true } });
  if (!segment) return -1;
  const unique = [...new Set(fullNames.filter((f) => typeof f === "string").map(canonicalJoinedFullName))];
  if (unique.length === 0) return 0;
  const repos = await prisma.repository.findMany({
    where: { orgId, fullName: { in: unique } },
    select: { id: true },
  });
  if (repos.length === 0) return 0;
  if (member) {
    const res = await prisma.repoSegment.createMany({
      data: repos.map((r) => ({ segmentId, repoId: r.id, source })),
      skipDuplicates: true,
    });
    return res.count;
  }
  const res = await prisma.repoSegment.deleteMany({ where: { segmentId, repoId: { in: repos.map((r) => r.id) } } });
  return res.count;
}

/** Per-repo segment membership: fullName → the segments it's tagged into (for the tagging UI). */
export async function getRepoSegmentMap(
  orgSlug: string,
): Promise<Record<string, { id: string; name: string; color: string }[]>> {
  if (!isDbConfigured()) return {};
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};
  const rows = await getPrisma().repoSegment.findMany({
    where: { segment: { orgId } },
    select: {
      repo: { select: { fullName: true } },
      segment: { select: { id: true, name: true, color: true } },
    },
  });
  const out: Record<string, { id: string; name: string; color: string }[]> = {};
  for (const r of rows) (out[r.repo.fullName] ||= []).push(r.segment);
  for (const fn of Object.keys(out)) out[fn]!.sort((a, b) => a.name.localeCompare(b.name)); // safe: fn comes from Object.keys(out)
  return out;
}

/** A repo the tagging UI can put into a segment: identity + GitHub's detected primary language
 *  (which feeds auto-add-by-language). */
export interface TaggableRepo {
  fullName: string;
  name: string;
  language: string | null;
  teams: string[];
}

/**
 * The repos the segment manager can tag — the SAME universe getOrgRollup uses (watched OR has-scans),
 * so the tagging list can never offer a repo the segment rollups would then ignore.
 *
 * Exists because the segment manager moved from the Repositories tab (which already had a full
 * `getOrgRollup` in hand for its leaderboard) to the Segments tab (which does not). Re-running the
 * rollup there would have paid for every repo's latest scan, its dimension rows, and four JSON blob
 * parses to read three scalar columns.
 */
export async function listTaggableRepos(orgSlug: string): Promise<TaggableRepo[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const repos = await getPrisma().repository.findMany({
    where: { orgId, OR: [{ watched: true }, { scans: { some: {} } }] },
    select: { fullName: true, name: true, primaryLanguage: true, teams: { select: { slug: true } } },
    orderBy: { fullName: "asc" },
  });
  return repos.map((r) => ({ fullName: r.fullName, name: r.name, language: r.primaryLanguage ?? null, teams: r.teams.map((t) => t.slug) }));
}

// ── Declared membership: the rule, and the explicit convergence toward it ─────────────────────────

/**
 * Every membership row of an org's segments, grouped by segment, WITH its owner.
 *
 * getRepoSegmentMap (above) answers the UI's question — "which segments is this repo in?" — and
 * deliberately carries no provenance, because the tagging chips do not care who wrote a row. Drift
 * does: a rule may only reap rows it owns, so the drift reader needs the `source` column the chip
 * reader has no business knowing about. Same single query, a different projection.
 */
async function listSegmentMembers(orgId: string): Promise<Map<string, SegmentMember[]>> {
  const rows = await getPrisma().repoSegment.findMany({
    where: { segment: { orgId } },
    select: { segmentId: true, source: true, repo: { select: { fullName: true } } },
  });
  const out = new Map<string, SegmentMember[]>();
  for (const r of rows) {
    const list = out.get(r.segmentId) ?? [];
    list.push({ fullName: r.repo.fullName, source: r.source === "rule" ? "rule" : "manual" });
    out.set(r.segmentId, list);
  }
  return out;
}

/** The outcome of one convergence: how many membership rows it created and how many it reaped. */
export interface SegmentRuleApplied {
  added: number;
  removed: number;
}

/**
 * Converge a segment's membership toward its DECLARED rule — the one destructive path in this module.
 *
 * Adds every matching, untagged repo of the taggable universe as a `rule`-owned row and deletes ONLY
 * `rule`-owned rows that no longer match. A hand-tagged row is never touched, whatever the rule says:
 * once two writers share a join table, last-write-wins is the absence of a policy, and the policy here
 * is per-row ownership (src/lib/org/segmentRule.ts). The delete is scoped to `source: "rule"` in the
 * query as well as in the id list, so even a wrong id list could not take a manual row with it.
 *
 * Idempotent: a second apply computes an empty drift, issues no write at all (not even a no-op
 * transaction) and returns { added: 0, removed: 0 }.
 *
 * Returns null — this module's established "nothing happened" — when persistence is off, the org is
 * unknown, the segment is not the org's (the per-row tenant filter, so a caller cannot converge
 * another tenant's segment), or the segment carries no rule to apply.
 */
export async function applySegmentRule(orgSlug: string, segmentId: string): Promise<SegmentRuleApplied | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const segment = await prisma.segment.findFirst({
    where: { id: segmentId, orgId },
    select: { id: true, ruleJson: true },
  });
  if (!segment) return null;
  const rule = parseSegmentRule(segment.ruleJson);
  if (!rule) return null;

  // The SAME universe listTaggableRepos and getOrgRollup use (watched OR has-scans), so convergence can
  // never tag a repo the segment rollups would then ignore.
  const [repos, existing] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId, OR: [{ watched: true }, { scans: { some: {} } }] },
      select: { id: true, fullName: true, primaryLanguage: true, teams: { select: { slug: true } } },
    }),
    prisma.repoSegment.findMany({ where: { segmentId }, select: { repoId: true, source: true } }),
  ]);
  const ruleRepo = (r: { fullName: string; primaryLanguage: string | null; teams: { slug: string }[] }) => ({
    fullName: r.fullName,
    language: r.primaryLanguage,
    teams: r.teams.map((t) => t.slug),
  });
  const byId = new Map(repos.map((r) => [r.id, r]));
  const tagged = new Set(existing.map((e) => e.repoId));
  const addIds = repos.filter((r) => !tagged.has(r.id) && matchesRule(ruleRepo(r), rule)).map((r) => r.id);
  const removeIds = existing
    .filter((e) => {
      if (e.source !== "rule") return false; // a human put it there; the rule has no say
      const repo = byId.get(e.repoId);
      if (!repo) return false; // left the taggable universe: absence is not a mismatch
      return !matchesRule(ruleRepo(repo), rule);
    })
    .map((e) => e.repoId);

  if (addIds.length === 0 && removeIds.length === 0) return { added: 0, removed: 0 };
  const ops = [];
  if (addIds.length > 0) {
    ops.push(
      prisma.repoSegment.createMany({
        data: addIds.map((repoId) => ({ segmentId, repoId, source: "rule" })),
        skipDuplicates: true,
      }),
    );
  }
  if (removeIds.length > 0) {
    ops.push(prisma.repoSegment.deleteMany({ where: { segmentId, source: "rule", repoId: { in: removeIds } } }));
  }
  await prisma.$transaction(ops);
  return { added: addIds.length, removed: removeIds.length };
}

// ── Segment-vs-segment comparison ─────────────────────────────────────────────

/**
 * The comparison shapes and their pure reducers live in src/lib/db/segments-compare.ts; this file
 * re-exports them so every existing call site (`@/lib/db/segments`, and db/index.ts's barrel) keeps
 * importing from exactly where it always did. AGENTS.md's split-behind-a-barrel pattern, as
 * src/lib/db/org.ts and src/lib/db/scans.ts do it: the module was 636 lines and growing.
 */
export {
  buildSegmentComparison,
  compareScopes,
  resolveComparePair,
  summarizeScopedRepos,
  type CompareScope,
  type SegmentComparison,
  type SegmentPoint,
  type SegmentSummary,
} from "@/lib/db/segments-compare";
/**
 * The ONE set of reads every Segments-tab aggregate is derived from: the segments, one unscoped fleet
 * rollup, every membership row, and (for the drift) the taggable universe.
 *
 * Exists so the strip and the A/B comparison cannot each buy their own rollup. `drift: false` drops the
 * taggable select for a caller that renders no drift line (compareSegments), which keeps the pair read
 * strictly cheaper than the pair of scoped rollups it replaced.
 */
async function readSegmentsFleet(
  orgSlug: string,
  opts?: { drift?: boolean },
): Promise<{
  segs: SegmentRow[] | null;
  rollup: Awaited<ReturnType<typeof getOrgRollup>>;
  membersBySeg: Map<string, SegmentMember[]>;
  taggable: TaggableRepo[];
}> {
  const orgId = await getOrgId(orgSlug);
  const [segs, rollup, membersBySeg, taggable] = await Promise.all([
    listSegments(orgSlug),
    getOrgRollup(orgSlug),
    orgId ? listSegmentMembers(orgId) : Promise.resolve(new Map<string, SegmentMember[]>()),
    // The drift inputs. One cheap indexed select over the same universe the rollup scores, so a
    // declared segment's drift is readable on this strip without a per-segment query.
    opts?.drift === false ? Promise.resolve([] as TaggableRepo[]) : listTaggableRepos(orgSlug),
  ]);
  return { segs, rollup, membersBySeg, taggable };
}

type SegmentsFleet = Awaited<ReturnType<typeof readSegmentsFleet>>;

/** The per-segment strip, derived from the one rollup. */
function summariesOf(f: SegmentsFleet): SegmentSummary[] {
  const repos = f.rollup?.repos ?? [];
  return (f.segs ?? []).map((s) => {
    const members = f.membersBySeg.get(s.id) ?? [];
    const tagged = new Set(members.map((m) => m.fullName));
    return summarizeScopedRepos(
      { id: s.id, name: s.name, rule: s.rule, drift: segmentDrift({ rule: s.rule, repos: f.taggable, membership: members }) },
      repos.filter((r) => tagged.has(r.fullName)),
    );
  });
}

/** The A/B comparison, derived from the SAME rollup by partitioning it on the membership map. A null
 *  `bId` is the whole-fleet baseline, which is the unpartitioned rollup — not an empty segment. */
function comparisonOf(f: SegmentsFleet, pair: { aId: string | null; bId: string | null }): SegmentComparison | null {
  if (!f.rollup || pair.aId === null) return null;
  const seg = (id: string) => (f.segs ?? []).find((s) => s.id === id) ?? null;
  const a = seg(pair.aId);
  if (!a) return null;
  const members = (id: string) => new Set((f.membersBySeg.get(id) ?? []).map((m) => m.fullName));
  const b = pair.bId === null ? null : seg(pair.bId);
  return compareScopes(
    f.rollup.repos,
    { id: a.id, name: a.name, members: members(a.id) },
    b ? { id: b.id, name: b.name, members: members(b.id) } : { id: null, name: "Whole fleet" },
  );
}

/** Headline maturity summary for every segment of an org, newest first — the per-segment rollup strip
 *  on the comparison page. ONE fleet rollup + the repo→segment map, then every summary derived in memory
 *  by filtering the already-loaded repos — this used to run a full getOrgRollup PER segment (K+ complete
 *  fleet-table scans on one page load, growing linearly with the user-created, so unbounded, segment
 *  count: a connection-pool / TTFB hazard). A surface that also draws the A/B comparison should call
 *  {@link loadSegmentsView} instead, which shares this rollup with it. */
export async function listSegmentSummaries(orgSlug: string): Promise<SegmentSummary[] | null> {
  if (!isDbConfigured()) return null;
  const f = await readSegmentsFleet(orgSlug);
  if (!f.segs) return null;
  if (!f.rollup) return []; // org missing / nothing to roll up — match the prior empty-out behaviour
  return summariesOf(f);
}

/**
 * Compare two segments side by side (platform vs legacy). `bId` may be null to compare a segment
 * against the whole fleet. Returns null when persistence is off, the org is unknown, there is nothing
 * to roll up, or `aId` isn't a segment of the org.
 *
 * ONE fleet rollup, partitioned in memory. It used to be two — `summarizeSegment` per side, each a
 * scoped `getOrgRollup` (both deleted 2026-10-05 along with `summarizeScopedRollup`, which they were
 * the last callers of; tech-groups.ts made the same move for stacks on 2026-08-19) — on a tab that had
 * already fetched the unscoped rollup for its per-segment strip. getOrgRollup's header documents why
 * that mattered: a nested `take` does not bound the transfer, so the org's entire scan history crosses
 * the wire per call. Prefer {@link loadSegmentsView} from a surface that needs the strip too: it pays
 * for the rollup once for BOTH readings.
 */
export async function compareSegments(orgSlug: string, aId: string, bId: string | null): Promise<SegmentComparison | null> {
  if (!isDbConfigured()) return null;
  const f = await readSegmentsFleet(orgSlug, { drift: false });
  if (!f.segs || !f.rollup) return null;
  const pair = resolveComparePair(f.segs, aId, bId, { exact: true });
  return comparisonOf(f, pair);
}

/** Everything the Segments tab reads off the fleet: the per-segment strip AND the A/B comparison, both
 *  reduced from the SAME rollup, plus the A/B ids that were actually resolved (so the picker renders
 *  the pair being drawn rather than the pair that was asked for). */
export interface SegmentsView {
  summaries: SegmentSummary[];
  comparison: SegmentComparison | null;
  aId: string | null;
  bId: string | null;
}

/**
 * The Segments tab's one read.
 *
 * The tab shows two things off the same fleet — a summary per segment and one A/B comparison — and it
 * used to buy the fleet three times to do it: `listSegmentSummaries` (one unscoped rollup) plus
 * `compareSegments` (one scoped rollup per side). Three full `getOrgRollup` transfers for one screen,
 * each carrying the org's entire scan history (org-rollup.ts' own header). This is the same screen for
 * ONE rollup: partition it by the membership map the strip already needed.
 *
 * The A/B resolution lives here rather than in the view because the selection decides which slice is
 * drawn: both Segments views had an identical copy of it (`?a=`/`?b=` with a fall-back to the first two
 * segments) and a drift between the two would have meant two tabs comparing different pairs off the
 * same URL. `null` when persistence is off or the org is unknown; an org with nothing to roll up gets
 * empty summaries and no comparison, never a fabricated one.
 */
export async function loadSegmentsView(
  orgSlug: string,
  sel?: { a?: string | null; b?: string | null },
): Promise<SegmentsView | null> {
  if (!isDbConfigured()) return null;
  const f = await readSegmentsFleet(orgSlug);
  if (!f.segs) return null;
  if (!f.rollup) return { summaries: [], comparison: null, aId: null, bId: null };
  const pair = resolveComparePair(f.segs, sel?.a, sel?.b);
  return { summaries: summariesOf(f), comparison: comparisonOf(f, pair), ...pair };
}
