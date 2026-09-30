// Org-authored best-practice playbooks (Direction #3) — the company's own reusable standards per
// maturity dimension, authored in-app by owners/admins. CRUD layer behind /api/org/playbooks. Distinct
// from the DERIVED practice library (getOrgPractices), which is inferred from scans. `steps` is stored
// as a JSON string[]; this module is the single place it's (de)serialized + bounded.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

export interface PlaybookRow {
  id: string;
  title: string;
  dimId: string;
  summary: string;
  steps: string[];
  createdBy: string | null;
  createdAt: string;
  /** Bumped each time the content is edited — the change-history anchor. */
  version: number;
  /** ISO of the last content edit. */
  updatedAt: string;
  /** Present on a direct read. List reads omit archived rows, so they leave this false. */
  archived?: boolean;
}

export interface PlaybookInput {
  title: string;
  dimId: string;
  summary?: string;
  steps?: string[];
}

function parseSteps(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Collapse embedded newlines (and the whitespace around them) to a single space. Titles and steps are
 * SINGLE-LINE by contract: playbookStarterFile renders each step as one `- [ ] …` checkbox line and the
 * title as an H1 / PR title / commit message, so a raw-JSON API caller sending "a\nb" would otherwise
 * commit a broken checklist or heading into a customer repo. The UI can't produce these (the modal
 * splits steps on \n), so this only defends the API path. Summaries stay multi-line on purpose.
 */
function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, " ");
}

/** Trim/cap the steps and serialize to JSON — bounds free-text storage (≤20 steps, ≤300 chars each,
 *  single-line — see oneLine). */
function cleanSteps(steps: string[] | undefined): string {
  const out = (steps ?? [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => oneLine(s.trim()).slice(0, 300))
    .slice(0, 20);
  return JSON.stringify(out);
}

/** The single DTO mapper from a persisted Playbook row to {@link PlaybookRow} — shared by
 *  listPlaybooks and getPlaybook so the field list can't drift between the list and single-row reads. */
function toPlaybookRow(p: {
  id: string;
  title: string;
  dimId: string;
  summary: string;
  steps: string;
  createdBy: string | null;
  createdAt: Date;
  version: number;
  updatedAt: Date;
  archived?: boolean;
}): PlaybookRow {
  return {
    id: p.id,
    title: p.title,
    dimId: p.dimId,
    summary: p.summary,
    steps: parseSteps(p.steps),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    version: p.version,
    updatedAt: p.updatedAt.toISOString(),
    archived: p.archived === true,
  };
}

export async function listPlaybooks(orgSlug: string): Promise<PlaybookRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await prisma.playbook.findMany({ where: { orgId, archived: false }, orderBy: { createdAt: "desc" } });
  return rows.map(toPlaybookRow);
}

export async function createPlaybook(
  orgSlug: string,
  input: PlaybookInput,
  createdBy?: string | null,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Resolve an EXISTING org — never upsert one into being. Matches createSegment's fix
  // (src/lib/db/segments.ts): on an auth-off deployment the route's access gate is permissive, so
  // upserting here let any typo'd/attacker-chosen slug materialize a junk Organization row (name=slug)
  // plus a playbook under it. Org creation belongs to the explicit install/onboarding flow only.
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  return prisma.playbook.create({
    data: {
      orgId,
      title: oneLine(input.title.trim()).slice(0, 200),
      dimId: input.dimId,
      summary: (input.summary ?? "").trim().slice(0, 1000),
      steps: cleanSteps(input.steps),
      createdBy: createdBy ?? null,
    },
    select: { id: true },
  });
}

export async function updatePlaybook(
  id: string,
  patch: Partial<PlaybookInput> & { archived?: boolean },
): Promise<void> {
  if (!isDbConfigured()) return;
  const data: Prisma.PlaybookUpdateInput = {};
  // Never persist a blank title (the PATCH route 400s first; this is the safety net for any other
  // caller) — a nameless playbook corrupts cards, initiative/PR titles, and branch slugs.
  if (patch.title !== undefined && patch.title.trim()) data.title = oneLine(patch.title.trim()).slice(0, 200);
  if (patch.dimId !== undefined) data.dimId = patch.dimId;
  if (patch.summary !== undefined) data.summary = patch.summary.trim().slice(0, 1000);
  if (patch.steps !== undefined) data.steps = cleanSteps(patch.steps);
  if (patch.archived !== undefined) data.archived = patch.archived;
  // A content edit (not an archive toggle) bumps the version — the change-history signal (PLAY-6).
  const contentEdit = ["title", "dimId", "summary", "steps"].some((k) => patch[k as keyof typeof patch] !== undefined);
  if (contentEdit) data.version = { increment: 1 };
  await getPrisma().playbook.update({ where: { id }, data });
}

export async function deletePlaybook(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().playbook.delete({ where: { id } });
}

/** Fetch one playbook by id (content + dimension), for the per-row apply route. Null if absent. */
export async function getPlaybook(id: string): Promise<PlaybookRow | null> {
  if (!isDbConfigured()) return null;
  const p = await getPrisma().playbook.findUnique({ where: { id } });
  if (!p) return null;
  return toPlaybookRow(p);
}

/** Resolve the org slug owning a playbook, so a per-row route can authorize the caller. Null if absent. */
export async function getPlaybookOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const p = await getPrisma().playbook.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return p?.org.slug ?? null;
}

/** Record that a playbook was applied to a repo (idempotent per playbook+repo). False if org/playbook
 *  unknown — defense-in-depth alongside the route's authz. The human "Mark applied" door and the loop's
 *  verified-close stamp write through here; opening a playbook PR does NOT (row 40: a draft is
 *  proposed until a rescan finds the file landed, see playbook-adoption.ts). */
export async function applyPlaybook(
  orgSlug: string,
  playbookId: string,
  repoFullName: string,
  appliedBy?: string | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  // Archived standards are withdrawn: listPlaybooks already hides them, and a stamp here would
  // put an adoption mark on a standard the library no longer offers.
  const pb = await prisma.playbook.findFirst({
    where: { id: playbookId, orgId, archived: false },
    select: { id: true, version: true },
  });
  if (!pb) return false;
  // Stamp the version adopted, so a repo on an older version is visible once the playbook is edited.
  await prisma.playbookApplication.upsert({
    where: { playbookId_repoFullName: { playbookId, repoFullName } },
    update: { appliedBy: appliedBy ?? null, appliedVersion: pb.version, appliedAt: new Date() },
    create: { playbookId, orgId, repoFullName, appliedBy: appliedBy ?? null, appliedVersion: pb.version },
  });
  return true;
}

/**
 * ADOPTION EVIDENCE FROM A VERIFIED CLOSE (moonshot #25).
 *
 * When a loop lane's rescan actually closes rows, the playbooks the lane's BRIEF quoted are stamped
 * as applied to that repo. Two constraints make this evidence rather than optimism:
 *
 *   • only playbooks that were IN THE BRIEF. A close under a playbook the agent never saw is a
 *     coincidence, and recording it as adoption would let the adoption number climb on work the
 *     playbook had nothing to do with;
 *   • only after the RESCAN closed something. The agent's claim is not the trigger — the verifier is.
 *
 * `appliedBy: "loop"` so the ledger can always separate machine-stamped adoption from a human's.
 * Rides `applyPlaybook`'s existing per-(playbook, repo) upsert, so a second lane on the same repo
 * refreshes the version rather than duplicating a row.
 *
 * @param briefedPlaybookIds the playbook ids the lane's brief actually quoted.
 * @returns how many playbooks were stamped.
 */
export async function stampPlaybookApplications(
  orgSlug: string,
  repoFullName: string,
  briefedPlaybookIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(briefedPlaybookIds)].filter(Boolean);
  if (ids.length === 0) return 0;
  let stamped = 0;
  for (const id of ids) {
    const ok = await applyPlaybook(orgSlug, id, repoFullName, "loop").catch(() => false);
    if (ok) stamped += 1;
  }
  return stamped;
}

/** Remove a playbook→repo application. */
export async function unapplyPlaybook(playbookId: string, repoFullName: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().playbookApplication.deleteMany({ where: { playbookId, repoFullName } });
}

// Adoption analytics + the landed-PR stamp live in playbook-adoption.ts (row 40); re-exported here so
// `@/lib/db` and every caller keep importing them from this module.
export { getPlaybookAdoption, stampLandedPlaybook, LANDED_BY_SCAN, type PlaybookAdoption } from "@/lib/db/playbook-adoption";
