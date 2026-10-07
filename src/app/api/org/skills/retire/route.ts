// POST /api/org/skills/retire { org, ids, restore? } -> { retired | restored, skipped: [{ id, reason }] }
//
// The bulk half of the single archive at /api/org/skills/[id] DELETE, and its undo. Destructive, so:
// SESSION + ADMIN only (no `askl_` bearer path - a machine credential never sweeps a library), and the
// caller's org is gated FIRST, before any read.
//
// THE RULE THIS ROUTE EXISTS TO HOLD: eligibility is re-derived here, from this server's own library and
// usage reads, and the posted `ids` are only a FILTER over that derivation. A retire endpoint that
// retires what the client names is worse than the missing surface it replaces: a forged id, a stale tab,
// a cross-tenant id or a registry-origin row would each archive something no verdict ever selected.
// Three refusals, each named in the response so the panel can show the difference rather than its own
// optimistic count:
//   not-in-library        - not a live row of THIS org (covers forged and cross-tenant ids)
//   not-a-prune-candidate - the server's own fold does not call it `abandoned` (isPruneCandidate)
//   registry-origin       - a mirror of a file the customer owns; the next index pass would restore it
//
// Entitlement goes through the ONE skills write-door table (src/lib/org/skill-write-gate.ts) at its
// `edit` door - the same door the single archive uses, because an archive REPLACES a row rather than
// growing the library, so a personal workspace at its cap may still retire. This route deliberately does
// not mint a fifth door: the rule would be a byte-for-byte copy of `edit`'s row, and a duplicated cell is
// exactly the drift that table was built to remove.
//
// Audit uses the EXISTING actions (`org_skill.archived` / `org_skill.updated`) with `via: "sweep"`, so no
// new action is registered and the sweep's use is still countable apart from the per-row link.

import { NextResponse } from "next/server";
import {
  archiveOrgSkill,
  getOrgSkillOrgSlug,
  isDbConfigured,
  listOrgSkills,
  recordOrgAudit,
  updateOrgSkill,
} from "@/lib/db";
import { refusePublicOrgAdmin, requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";
import { isPruneCandidate, type SkillUsage } from "@/lib/org/skill-usage";
import { getOrgSkillUsage } from "@/lib/org/skill-usage-load";
import { skillWriteDenial, skillWriteGate } from "@/lib/org/skill-write-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The named refusals. A skipped id always carries one; there is no silent skip. */
export type RetireSkipReason = "not-in-library" | "not-a-prune-candidate" | "registry-origin";

interface Skip {
  id: string;
  reason: RetireSkipReason;
}

/** Cap on one sweep. A library this size is already past the point where a bulk ask is reviewable. */
const MAX_IDS = 200;

export async function POST(request: Request) {
  // CSRF first, before the DB probe and before any read: a destructive bulk sweep is browser-only
  // (the panel is its only caller), so a request that cannot show this origin has no business here.
  const xo = requireSameOrigin(request);
  if (xo) return xo;
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { org?: string; ids?: unknown; restore?: unknown };
  const org = typeof body.org === "string" ? body.org.trim() : "";
  const raw = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  // De-duplicate before anything else: a repeated id must not archive twice, and must not count twice.
  const ids = [...new Set(raw)].slice(0, MAX_IDS);
  if (!org || ids.length === 0) {
    return NextResponse.json({ error: "org and a non-empty ids array are required." }, { status: 400 });
  }

  // Destructive: admin + session, gated on the org before any read of the library.
  const denied = refusePublicOrgAdmin(org) ?? (await requireOrgRole(org, "admin"));
  if (denied) return denied;
  const gate = await skillWriteGate(org, "edit");
  if (!gate.allowed) {
    const denial = skillWriteDenial(gate);
    return NextResponse.json(denial.body, { status: denial.status });
  }

  const actor = (await resolveViewerLogin().catch(() => null)) ?? undefined;
  return body.restore === true ? restore(org, ids, actor) : retire(org, ids, actor);
}

async function retire(org: string, ids: string[], actor: string | undefined): Promise<Response> {
  // The server's OWN view of what is eligible. Both reads are org-scoped, so a cross-tenant id is simply
  // absent from them - the "does this belong to the caller's org" question is answered by construction.
  const [listed, usage] = await Promise.all([
    listOrgSkills(org).catch(() => [] as Awaited<ReturnType<typeof listOrgSkills>>),
    getOrgSkillUsage(org).catch(() => ({}) as Record<string, SkillUsage>),
  ]);
  const byId = new Map((listed ?? []).map((s) => [s.id, s]));

  const skipped: Skip[] = [];
  const eligible: string[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: "not-in-library" });
      continue;
    }
    if (row.origin === "registry") {
      skipped.push({ id, reason: "registry-origin" });
      continue;
    }
    const u = usage[id];
    if (!u || !isPruneCandidate(u)) {
      skipped.push({ id, reason: "not-a-prune-candidate" });
      continue;
    }
    eligible.push(id);
  }

  let retired = 0;
  for (const id of eligible) {
    try {
      await archiveOrgSkill(id);
    } catch {
      // A row that vanished between the read and the write is not a retirement; it is not in the library.
      skipped.push({ id, reason: "not-in-library" });
      continue;
    }
    retired += 1;
    await recordOrgAudit("org_skill.archived", org, { skillId: id, via: "sweep" }, actor).catch(() => {});
  }
  return NextResponse.json({ retired, skipped });
}

/**
 * The undo. `listOrgSkills` excludes archived rows by design, so ownership here is resolved from the row
 * itself (getOrgSkillOrgSlug) and compared to the gated org: gate-then-constrain, with a mismatch skipped
 * rather than restored. Restore does not re-derive prune candidacy - the row's dormancy is exactly why it
 * was archived, and refusing to un-archive it would make the sweep one-way.
 */
async function restore(org: string, ids: string[], actor: string | undefined): Promise<Response> {
  const skipped: Skip[] = [];
  let restored = 0;
  for (const id of ids) {
    const owner = await getOrgSkillOrgSlug(id).catch(() => null);
    if (owner !== org) {
      skipped.push({ id, reason: "not-in-library" });
      continue;
    }
    try {
      await updateOrgSkill(id, { archived: false });
    } catch {
      skipped.push({ id, reason: "not-in-library" });
      continue;
    }
    restored += 1;
    await recordOrgAudit("org_skill.updated", org, { skillId: id, archived: false, via: "sweep" }, actor).catch(() => {});
  }
  return NextResponse.json({ restored, skipped });
}
