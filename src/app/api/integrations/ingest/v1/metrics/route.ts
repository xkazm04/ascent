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
import { parseOtlpSessions } from "@/lib/integrations/sessions";
import { recordUsage } from "@/lib/db";
import { recordAgentSessions } from "@/lib/db/agent-sessions";

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

  // An export that lands nothing must SAY so. `received` counts every datapoint in the payload and
  // `skipped` says, by reason, which of them had no home — an allowlisted metric name, a resource with
  // no git.repository, or a remote on a host whose repo identity Ascent doesn't model. Without this the
  // 202 was indistinguishable between "40 datapoints stored" and "40 datapoints silently dropped".
  const now = Date.now();
  const parsed = parseOtlpMetrics(body, now);
  // W3a — the SAME bytes also fold into per-session attempts, which is the shape day buckets
  // structurally cannot answer "what does a unit of work cost" from. Independent of the usage write:
  // an exporter that predates the `session.id` attribute yields zero sessions and keeps working
  // exactly as before, and a session-write failure must never fail an ingest whose usage landed.
  const sessions = parseOtlpSessions(body, now);
  const [res, sessionsStored] = await Promise.all([
    recordUsage(gate.slug, parsed.records, { mode: "add" }),
    recordAgentSessions(gate.slug, sessions).catch((err) => {
      console.error("[ingest] agent-session write failed — usage still stored", err);
      return 0;
    }),
  ]);
  const droppedTotal = Object.values(parsed.skipped).reduce((a, b) => a + b, 0);
  return NextResponse.json(
    {
      accepted: true,
      persisted: res.ok,
      org: gate.slug,
      received: parsed.received,
      stored: res.stored,
      // Zero here with a non-zero `stored` is the actionable signal that the exporter is not sending
      // `session.id` — usage lands, attempts do not, and unit economics stay unavailable.
      sessions: sessionsStored,
      skipped: parsed.skipped,
      ...(parsed.unsupportedHosts.length ? { unsupportedHosts: parsed.unsupportedHosts } : {}),
      ...(droppedTotal > 0
        ? {
            note:
              parsed.skipped["unsupported-host"] > 0
                ? `${droppedTotal} datapoint(s) were not stored. Ascent attributes usage to GitHub repositories; set OTEL_RESOURCE_ATTRIBUTES=git.repository to a GitHub remote for the repos you want measured.`
                : `${droppedTotal} datapoint(s) were not stored. See the skipped counts.`,
          }
        : {}),
    },
    { status: 202 },
  );
}
