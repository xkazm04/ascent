// POST /api/integrations/ingest/v1/metrics — the OTLP metrics receiver a Claude Code OTel exporter
// actually targets (it appends /v1/metrics to OTEL_EXPORTER_OTLP_ENDPOINT). Validates the per-org
// ingest token, parses OTLP/JSON, maps claude_code.* counters to measured per-repo records, and folds
// them in with add-semantics (counters accumulate). An OTLP/protobuf body is accepted but not parsed —
// the connect snippet sets OTEL_EXPORTER_OTLP_PROTOCOL=http/json, so JSON is the supported wire format.

import { NextResponse, type NextRequest } from "next/server";
import { bearerToken, parseIngestToken } from "@/lib/integrations/ingest-token";
import { parseOtlpMetrics, type OtlpMetricsBody } from "@/lib/integrations/otlp";
import { recordUsage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = bearerToken(req.headers.get("authorization"), req.headers.get("x-ascent-ingest-token"));
  const parsed = token ? parseIngestToken(token) : null;
  if (!parsed) {
    return NextResponse.json({ error: "Missing or invalid ingest token." }, { status: 401 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    // OTLP/protobuf — drain so the exporter's POST completes, but we don't decode it (no protobuf dep).
    await req.text().catch(() => "");
    return NextResponse.json(
      { accepted: true, persisted: false, note: "Send OTLP over http/json (OTEL_EXPORTER_OTLP_PROTOCOL=http/json); protobuf isn't decoded." },
      { status: 202 },
    );
  }

  let body: OtlpMetricsBody;
  try {
    body = JSON.parse(await req.text()) as OtlpMetricsBody;
  } catch {
    return NextResponse.json({ error: "Invalid OTLP JSON." }, { status: 400 });
  }

  const records = parseOtlpMetrics(body, Date.now());
  const res = await recordUsage(parsed.slug, records, { mode: "add" });
  return NextResponse.json({ accepted: true, persisted: res.ok, stored: res.stored, org: parsed.slug }, { status: 202 });
}
