// POST /api/integrations/ingest/v1/logs — Claude Code also exports OTLP logs (prompt/tool events) when
// OTEL_LOGS_EXPORTER=otlp. We authenticate and 202-accept them so the exporter doesn't error-loop, but
// don't yet fold them into usage (the token/cost signal lives in /v1/metrics). Parsing log events into
// usage/attribution is a later step.

import { NextResponse, type NextRequest } from "next/server";
import { guardIngest, payloadTooLarge, readCappedBody } from "@/lib/integrations/ingest-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await guardIngest(req);
  if (gate.deny) return gate.deny;
  // Bounded drain: accept-and-discard is deliberate here, but the read still has to be capped — this
  // is the highest-frequency ingest path (Claude Code flushes logs every 5s by default).
  const read = await readCappedBody(req);
  if (!read.ok) return payloadTooLarge();
  return NextResponse.json({ accepted: true, persisted: false, org: gate.slug }, { status: 202 });
}
