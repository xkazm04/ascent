// GET /api/auth/viewer — the EFFECTIVE viewer for client components (the scan form's notify control).
// Surfaces getViewer() — the same gate the scan routes use — so it honors the dev auth-bypass viewer
// too (unlike a raw client-side Supabase call, which only sees a real session). Returns just the
// non-sensitive bits the notify UX needs: is someone signed in, and their account email (if any).

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";
import { authGateEnabled } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const viewer = await getViewer();
  return NextResponse.json(
    { signedIn: Boolean(viewer), email: viewer?.email ?? null, gated: authGateEnabled() },
    { headers: { "cache-control": "no-store, private" } },
  );
}
