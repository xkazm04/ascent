// POST /api/dev/seed-ai-usage — DEV/DEMO ONLY. Inserts MEASURED Claude Code usage (one record per
// repo) for an org so the /delivery "AI delivery intelligence" views demonstrate the measured-fidelity
// path — real telemetry isn't available in the PGlite demo. Idempotent (recordUsage upserts by the
// unique key). Gating mirrors /api/dev/seed-vercel-demo: ASCENT_SEED_SECRET when set, else non-prod only.
//
//   curl -X POST "http://localhost:3000/api/dev/seed-ai-usage?org=vercel"

import { NextResponse, type NextRequest } from "next/server";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { recordUsage, type UsageRecordInput } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-seed-secret") ?? new URL(req.url).searchParams.get("secret");
    return provided === secret;
  }
  return process.env.NODE_ENV !== "production";
}

// FNV-1a — deterministic, so re-seeding an org yields the same spend (stable demo across reloads).
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden: set ASCENT_SEED_SECRET and pass it via x-seed-secret or ?secret=" }, { status: 403 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "persistence is disabled: set DATABASE_URL first" }, { status: 400 });
  }

  const prisma = getPrisma();
  const slug = (new URL(req.url).searchParams.get("org") ?? "vercel").toLowerCase();
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, repositories: { select: { fullName: true } } },
  });
  if (!org) {
    return NextResponse.json({ error: `org "${slug}" not found: import it first (node scripts/seed-org.mjs vercel)` }, { status: 404 });
  }

  // Current month bucket; getOrgUsageRollup's 35-day window captures it.
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const records: UsageRecordInput[] = org.repositories.map((r) => {
    const h = hash(r.fullName);
    const seats = 4 + (h % 40); // 4..43
    const costCents = (150 + (h % 3200)) * 100; // $150..$3349 / mo
    return { source: "claude-code", scope: "repo", scopeKey: r.fullName, periodStart, seats, costCents, tokens: costCents * 40, fidelity: "measured" };
  });

  const res = await recordUsage(slug, records);
  return NextResponse.json({ ok: res.ok, org: slug, repos: org.repositories.length, stored: res.stored });
}
