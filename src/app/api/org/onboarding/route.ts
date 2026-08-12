// POST /api/org/onboarding { org, status: "completed" | "skipped" } -> { ok, stamped, at? }
//
// The member's own onboarding stamp (W6a) — the GATE for the guided getting-started flow. Either
// stamp, once set, silences the flow for this member in this org forever (stamp, not empty-data
// heuristic: an org whose data later empties out must not re-trigger onboarding). Viewer-scoped on
// purpose, mirroring the alerts `seen` watermark: dismissing your own onboarding is not a
// privileged action, and the write only ever lands on the CALLER's own Membership row, so it can't
// touch anyone else's state — which is also why it is not audit-logged (the norm set by
// markAlertsSeen: self-scoped read-state stamps aren't org-level actions).
//
// Step COMPLETION has no endpoint here by design — it is derived server-side from real data
// (GET /api/org/getting-started) and cannot be recorded.

import { NextResponse } from "next/server";
import { isDbConfigured, isOnboardingStatus, setOnboardingStamp } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Onboarding state requires a database." }, { status: 503 });
  }
  // CSRF defense-in-depth (the session cookie is SameSite=Lax), matching the alerts mutation.
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string; status?: unknown };
  if (!body.org) {
    return NextResponse.json({ error: 'Provide { org, status: "completed" | "skipped" }.' }, { status: 400 });
  }
  if (!isOnboardingStatus(body.status)) {
    return NextResponse.json({ error: 'status must be "completed" or "skipped".' }, { status: 400 });
  }
  // Any member (>= viewer) may stamp — it's their OWN row; the role gate is only the tenant wall.
  const denied = await requireOrgRole(body.org, "viewer");
  if (denied) return denied;
  const login = await resolveViewerLogin();
  // No viewer identity (auth-off / public org) → no Membership row to stamp; a clean no-op, not an
  // error — the same degraded contract as the alerts watermark.
  if (!login) return NextResponse.json({ ok: true, stamped: false });
  const at = new Date();
  const stamped = await setOnboardingStamp(body.org, login, body.status, at).catch(() => false);
  return NextResponse.json({ ok: true, stamped, ...(stamped ? { at: at.toISOString() } : {}) });
}
