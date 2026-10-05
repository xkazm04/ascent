// PUT  /api/org/segments/:id/rule { kind, values } -> declare the segment's membership rule (no write
//                                                      to the fleet). { kind: null } clears it.
// POST /api/org/segments/:id/rule [{ kind, values }] -> declare (when a rule is supplied) and then
//                                                      CONVERGE: tag every match, reap only rule-owned
//                                                      non-matches. Returns { added, removed }.
//
// Per-row tenant gate, resolve-then-gate: the owning org is derived from the SEGMENT via
// getSegmentOrgSlug(id) and that org is gated, never a caller-supplied org beside a caller-supplied id.
// Same shape as the sibling PATCH/DELETE route, and what src/app/api/org/id-routes-gated.test.ts
// requires of every [id] route under /api/org.
//
// The apply is audited as `segment.rule_applied` with COUNTS ONLY: a converged segment can name
// hundreds of repos, and the bulk-tag route already settled that the trail never stores the list.

import { NextResponse } from "next/server";
import { applySegmentRule, getSegmentOrgSlug, recordOrgAudit, updateSegment } from "@/lib/db";
import { normalizeSegmentRule, segmentRuleInputError, type SegmentRule } from "@/lib/org/segmentRule";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DB + per-row tenant gate. Declaring and converging are both member-level writes on a slice the
 *  member can already tag by hand, so neither escalates to admin. Returns the owning slug so the audit
 *  row and the apply use the same org the gate resolved. */
async function gate(id: string): Promise<{ org: string } | Response> {
  const guard = dbGuard("Segments");
  if (guard) return guard;
  const org = await getSegmentOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Segment not found." }, { status: 404 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  return { org };
}

async function readRule(request: Request): Promise<{ rule?: SegmentRule | null } | Response> {
  const body = (await request.json().catch(() => ({}))) as { kind?: unknown; values?: unknown };
  // An absent `kind` means "no declaration in this body" — PUT treats that as a no-op and POST applies
  // the stored rule. An explicit null CLEARS the declaration (back to a hand-kept list).
  if (body.kind === undefined) return {};
  if (body.kind === null) return { rule: null };
  const invalid = segmentRuleInputError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  return { rule: normalizeSegmentRule(body) };
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await gate(id);
  if (gated instanceof Response) return gated;
  const parsed = await readRule(request);
  if (parsed instanceof Response) return parsed;
  if (!("rule" in parsed)) return NextResponse.json({ error: "Provide a rule { kind, values }." }, { status: 400 });
  try {
    await updateSegment(id, { rule: parsed.rule ?? null });
    return NextResponse.json({ ok: true, rule: parsed.rule ?? null });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    console.error("[org/segments/rule] declare failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to save the rule." }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await gate(id);
  if (gated instanceof Response) return gated;
  const parsed = await readRule(request);
  if (parsed instanceof Response) return parsed;
  try {
    // Declare first, then converge, so the one gesture the UI offers ("every Python repo belongs to
    // this segment") both records the intent and ends in tagged repos.
    if ("rule" in parsed) await updateSegment(id, { rule: parsed.rule ?? null });
    const applied = await applySegmentRule(gated.org, id);
    if (!applied) {
      return NextResponse.json({ error: "No rule to apply for this segment." }, { status: 404 });
    }
    const actorLogin = await resolveViewerLogin();
    await recordOrgAudit(
      "segment.rule_applied",
      gated.org,
      { segmentId: id, added: applied.added, removed: applied.removed },
      actorLogin ?? undefined,
    );
    return NextResponse.json({ ok: true, added: applied.added, removed: applied.removed });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    console.error("[org/segments/rule] apply failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to apply the rule." }, { status: 500 });
  }
}
