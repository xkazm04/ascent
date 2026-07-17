// GET /api/quota -> { enforced, remaining, limit, resetAt, scope }
// Read-only "how many free public scans are left this week" for the current caller (signed-in users
// get their elevated per-user bucket; anonymous callers their per-IP one). Powers a live meter on
// the scan entry point BEFORE committing a scan — the count otherwise only surfaced post-scan via
// response headers. Never consumes a slot. no-store so the meter is always live.

import { NextResponse } from "next/server";
import { peekPublicScanQuota } from "@/lib/public-scan-quota";
import { getViewer } from "@/lib/access";
import { QUOTA_PEEK_RATE_LIMIT, rateLimitRequest, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Rate-limited like every other public surface: "read-only" still means an auth resolution + a DB
  // read per request with no CDN absorption (no-store) — an unauthenticated amplification lever
  // without this. Generous budget (see QUOTA_PEEK_RATE_LIMIT); the QuotaMeter tolerates a non-OK
  // response (keeps its last state), so a 429 is safe client-side.
  const rl = rateLimitRequest(request, QUOTA_PEEK_RATE_LIMIT);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const viewer = await getViewer().catch(() => null);
  const quota = await peekPublicScanQuota(request, { viewerId: viewer?.id });
  return NextResponse.json(quota, { headers: { "cache-control": "no-store" } });
}
