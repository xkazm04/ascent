// POST /api/integrations/ingest/v1/logs — Claude Code also exports OTLP logs (prompt/tool events) when
// OTEL_LOGS_EXPORTER=otlp. We authenticate and 202-accept them so the exporter doesn't error-loop, but
// don't yet fold them into usage (the token/cost signal lives in /v1/metrics). Parsing log events into
// usage/attribution is a later step.

import { NextResponse, type NextRequest } from "next/server";
import { bearerToken, parseIngestToken } from "@/lib/integrations/ingest-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get("authorization"), req.headers.get("x-ascent-ingest-token"));
  const parsed = token ? parseIngestToken(token) : null;
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid ingest token." }, { status: 401 });
  }
  await req.text().catch(() => "");
  return NextResponse.json({ accepted: true, persisted: false, org: parsed.slug }, { status: 202 });
}
