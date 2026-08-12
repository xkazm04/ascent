// GET  /api/org/ai-stance?org=slug                         -> { active, draft, versions }   (member read)
// POST /api/org/ai-stance { org, action, stance }          -> { ok, stance }                (owner)
//        action: "draft"   — save/replace the org's single draft row
//        action: "publish" — publish (bump version, supersede the prior published row)
//
// The org's versioned AI stance (W3) — the governance artifact the compliance readout and the
// AI_POLICY.md apply-PR derive from. Auth is a clone of the gate-policy route: member read,
// owner-gated write (it states the org-wide policy), same-origin enforced by requireOrgOwnerPost,
// stance sanitized on write (sanitizeStance) and again on read in the db layer. Every write is
// audit-logged the way gate-policy changes are: WHAT the stance became (version + a terse summary),
// not just that it moved.

import { NextResponse } from "next/server";
import {
  getActiveOrgStance,
  getDraftOrgStance,
  isDbConfigured,
  listOrgStanceVersions,
  publishOrgStance,
  recordOrgAudit,
  saveOrgStanceDraft,
} from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { resolveViewerLogin } from "@/lib/access";
import type { AiStance } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Terse audit summary of a stored stance — the `status` field the audit viewer renders. */
function stanceBits(s: AiStance): string {
  const bits: string[] = [];
  if (s.permittedTools.length) bits.push(`${s.permittedTools.length} tools`);
  if (s.permittedModels.length) bits.push(`${s.permittedModels.length} models`);
  if (s.noAiZones.length) bits.push(`${s.noAiZones.length} no-AI zones`);
  if (s.reviewTiers.length) bits.push(`${s.reviewTiers.length} review tiers`);
  if (s.provenance.requireTrailer) bits.push("trailer required");
  if (s.provenance.requireHumanApproval) bits.push("human approval required");
  return bits.join(" · ") || "empty stance";
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The AI stance requires a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const [active, draft, versions] = await Promise.all([
    getActiveOrgStance(org),
    getDraftOrgStance(org),
    listOrgStanceVersions(org),
  ]);
  return NextResponse.json({ active, draft, versions });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The AI stance requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ action?: unknown; stance?: unknown }>(request, {
    missingOrgError: "Provide { org, action, stance }.",
  });
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  const action = body.action === "publish" ? "publish" : body.action === "draft" ? "draft" : null;
  if (!action) return NextResponse.json({ error: 'Provide action: "draft" | "publish".' }, { status: 400 });

  // resolveViewerLogin, not getSession — parity with gate-policy (the Supabase wall is the live stack).
  const actorLogin = await resolveViewerLogin();

  const stored =
    action === "publish"
      ? await publishOrgStance(org, body.stance, actorLogin ?? null)
      : await saveOrgStanceDraft(org, body.stance);
  if (stored === undefined) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  if (stored === null) {
    // An all-invalid stance sanitizes to nothing. Unlike the gate (where null clears), an empty
    // stance is refused: "no stance" is the absence of rows, never a published empty document.
    return NextResponse.json({ error: "The stance is empty after validation — nothing was stored." }, { status: 400 });
  }

  await recordOrgAudit(
    "org.ai_stance",
    org,
    {
      org,
      action,
      version: stored.version,
      status: `${action === "publish" ? "published" : "draft"} v${stored.version} — ${stanceBits(stored.stance)}`,
      stance: stored.stance,
    },
    actorLogin ?? undefined,
  ).catch(() => {});

  return NextResponse.json({ ok: true, stance: stored });
}
