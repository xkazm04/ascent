// POST /api/integrations/ingest/v1/metrics — the OTLP metrics receiver a Claude Code OTel exporter
// actually targets (it appends /v1/metrics to OTEL_EXPORTER_OTLP_ENDPOINT). Rate-limits, validates the
// per-org ingest token, parses OTLP/JSON, maps claude_code.* counters to measured per-repo records, and
// folds them in with add-semantics (counters accumulate). We only decode OTLP/JSON — the connect snippet
// sets OTEL_EXPORTER_OTLP_PROTOCOL=http/json. A default (protobuf) exporter is REFUSED with 415 rather
// than silently 202-and-dropped, so a misconfigured collector gets an actionable error, not a phantom
// success with no data. Auth (401) runs first, so the wire-format check never leaks to unauthenticated
// callers. A bodyless probe with no content-type (the connect page's "Test ingest token") stays 202.
// The body is read through the shared cap (413 over MAX_BODY) and the route sits behind the shared
// rate limiter — see src/lib/integrations/ingest-guard.ts.

import { NextResponse, type NextRequest } from "next/server";
import { guardIngest, payloadTooLarge, readCappedBody } from "@/lib/integrations/ingest-guard";
import { parseOtlpMetrics, type OtlpMetricsBody } from "@/lib/integrations/otlp";
import { recordUsage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const gate = await guardIngest(req);
  if (gate.deny) return gate.deny;

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("protobuf")) {
    // OTLP/protobuf is the OTel exporter's DEFAULT wire format — we don't decode it. Refuse loudly with
    // the one-line fix instead of a 202 the collector reads as "delivered" while nothing ever persists.
    await readCappedBody(req); // drain (bounded) so the socket closes cleanly
    return NextResponse.json(
      { error: "OTLP/protobuf isn't supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json so Claude Code exports OTLP over JSON to this endpoint." },
      { status: 415 },
    );
  }
  if (!contentType.includes("json")) {
    // No/other content-type (e.g. the connect page's bodyless "Test ingest token" probe). Nothing to
    // parse — accept so the token check reads as valid, but persist nothing.
    await readCappedBody(req);
    return NextResponse.json(
      { accepted: true, persisted: false, note: "Send OTLP over http/json (OTEL_EXPORTER_OTLP_PROTOCOL=http/json)." },
      { status: 202 },
    );
  }

  const read = await readCappedBody(req);
  if (!read.ok) return payloadTooLarge();

  let body: OtlpMetricsBody;
  try {
    body = JSON.parse(read.text) as OtlpMetricsBody;
  } catch {
    return NextResponse.json({ error: "Invalid OTLP JSON." }, { status: 400 });
  }

  const records = parseOtlpMetrics(body, Date.now());
  const res = await recordUsage(gate.slug, records, { mode: "add" });
  return NextResponse.json({ accepted: true, persisted: res.ok, stored: res.stored, org: gate.slug }, { status: 202 });
}
