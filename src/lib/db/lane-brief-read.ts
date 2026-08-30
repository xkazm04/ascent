// THE FOUR-AND-A-HALF READS a lane brief needs, gathered in one place.
//
// SEPARATE FROM `src/lib/org/lane-brief.ts` on purpose — the `-load.ts` sibling pattern. That module
// is pure assembly and is imported by a client (the curation panel renders the provenance it
// produces); this one touches Prisma. Keeping them apart is what stops `next build` dragging the db
// layer into a client chunk, which is a failure `tsc` and the unit suite both pass straight through
// (see the `build-not-in-gate` note in the repo's memory).
//
// EVERY READ DEGRADES TO EMPTY, NEVER THROWS. A brief missing its playbooks because the playbook read
// failed is a worse outcome than a brief that says "no playbook covers D3" — but only slightly, and
// the alternative (a lane that dies because a side read failed) is worse than both. `buildLaneBrief`
// turns an empty section into an explicit absence line, so a failed read is at least *stated*.

import { candidateOrgMemories } from "@/lib/db/org-memory";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { listOrgSkills } from "@/lib/db/org-skills";
import { listPlaybooks } from "@/lib/db/playbooks";
import { minePracticeShapes } from "@/lib/org/practice-mining";
import { recallMemories } from "@/lib/memory/recall";
import type { LaneBriefInput } from "@/lib/org/lane-brief";

/** How many memory rows to consider before recall ranks them. */
const MEMORY_CANDIDATES = 60;
/** Character budget handed to `recallMemories`; the brief's own byte cap trims again after. */
const MEMORY_BUDGET = 4_000;

/** Active playbooks for these dimensions. `[]` on any failure — never a throw into the lane. */
async function readPlaybooks(org: string, dimIds: readonly string[]): Promise<LaneBriefInput["playbooks"]> {
  try {
    const rows = (await listPlaybooks(org)) ?? [];
    return rows
      .filter((p) => dimIds.includes(p.dimId))
      .map((p) => ({ id: p.id, title: p.title, dimId: p.dimId, version: p.version, summary: p.summary, steps: p.steps }));
  } catch {
    return [];
  }
}

/**
 * The house pattern, mined from the org's OWN repositories.
 *
 * Only `offerable` patterns whose gap list includes this repo: a pattern this repo already follows is
 * not something to brief it about, and a pattern with no exemplars is not a house style. Read through
 * `minePracticeShapes` rather than a local re-derivation — W2-J2 owns that miner, and a second copy
 * of its rules here is how the two would drift.
 */
async function readHousePattern(
  org: string,
  repo: string,
  dimIds: readonly string[],
): Promise<LaneBriefInput["housePattern"]> {
  try {
    const sources = (await getOrgPracticeShapes(org)) ?? [];
    return minePracticeShapes(sources)
      .filter((m) => m.offerable && dimIds.includes(m.dimId) && m.gapRepos.includes(repo))
      .map((m) => ({
        practiceId: m.practiceId,
        label: m.label,
        dimId: m.dimId,
        // Outline first, then layout: the outline is what the practice DOES and the layout is where
        // it lives, and an agent reading only the first half should still have the useful half.
        lines: [...m.outline, ...m.layout].map((l) => l.text),
        exemplars: m.exemplars,
      }));
  } catch {
    return [];
  }
}

/**
 * Procedural memory for this repo, through the SAME `candidateOrgMemories` → `recallMemories` pair
 * Athena's gate uses. There is no lane-specific recall function and there should not be: a second
 * ranking would mean the loop and the companion disagree about what the org remembers.
 */
async function readMemories(org: string, repo: string): Promise<LaneBriefInput["memories"]> {
  try {
    const rows = await candidateOrgMemories(org, { namespace: repo, limit: MEMORY_CANDIDATES }, null);
    if (rows.length === 0) return [];
    const result = recallMemories(rows, { now: Date.now(), charBudget: MEMORY_BUDGET, kinds: ["procedural"] });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return result.selected.map((s) => ({
      id: s.memory.id,
      kind: s.memory.kind,
      content: s.memory.content,
      source: byId.get(s.memory.id)?.source ?? null,
    }));
  } catch {
    return [];
  }
}

/** Registry skills whose CATEGORY maps into this batch's dimensions (SKILL_CATEGORY_DIMS). The
 *  mapping itself lives in the pure module; this read hands over every skill and lets it filter. */
async function readSkills(org: string): Promise<LaneBriefInput["skills"]> {
  try {
    const rows = (await listOrgSkills(org)) ?? [];
    return rows.map((s) => ({ id: s.id, name: s.name, category: s.category, summary: s.description }));
  } catch {
    return [];
  }
}

/**
 * What the repo's LATEST scan actually recorded for these dimensions.
 *
 * Its own Prisma read rather than a `scans-read.ts` helper: that module is another lane's this wave,
 * and the read here is one narrow query (dimension rows for one scan) rather than a comparison. The
 * scan ORDER is copied deliberately from `SCAN_ORDER` — `scannedAt` is not unique, so a bare desc
 * sort would let this brief quote a different "latest" than the lane's own before-scan.
 */
async function readEvidence(org: string, repo: string, dimIds: readonly string[]): Promise<LaneBriefInput["evidence"]> {
  if (!isDbConfigured()) return [];
  try {
    const orgRow = await getOrgBySlug(org);
    if (!orgRow) return [];
    const prisma = getPrisma();
    const repoRow = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId: orgRow.id, fullName: repo.toLowerCase() } },
      select: { id: true },
    });
    if (!repoRow) return [];
    const scan = await prisma.scan.findFirst({
      where: { repoId: repoRow.id },
      orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (!scan) return [];
    const dims = await prisma.scanDimension.findMany({
      where: { scanId: scan.id, dimId: { in: [...dimIds] } },
      select: { dimId: true, name: true, score: true, evidence: true, gaps: true },
    });
    return dims.map((d) => ({
      dimId: d.dimId,
      name: d.name,
      score: d.score,
      evidence: parseStrings(d.evidence),
      gaps: parseStrings(d.gaps),
    }));
  } catch {
    return [];
  }
}

/** JSON-in-TEXT string[], defensively. A malformed column is an empty list, never a crash. */
function parseStrings(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Everything `buildLaneBrief` needs, read in parallel.
 *
 * `Promise.all` rather than sequential awaits because these are five independent reads on one
 * connection and a lane is already the slowest thing in the system; each one owns its own failure.
 */
export async function loadLaneBriefInput(org: string, repo: string, dimIds: string[]): Promise<LaneBriefInput> {
  const dims = [...new Set(dimIds)].filter(Boolean);
  const [playbooks, housePattern, memories, skills, evidence] = await Promise.all([
    readPlaybooks(org, dims),
    readHousePattern(org, repo, dims),
    readMemories(org, repo),
    readSkills(org),
    readEvidence(org, repo, dims),
  ]);
  return { org, repo, dimIds: dims, playbooks, housePattern, memories, skills, evidence };
}
