// POST /api/integrations/ingest — the authenticated ingestion entrypoint for AI-usage telemetry.
//
// Validates the per-org ingest token (Authorization: Bearer <token>, the header a Claude Code OTel
// exporter is configured to send), then STORES any records sent in our normalized JSON contract
// { records: [{ source, scope, scopeKey, periodStart, tokens?, costCents?, sessions?, seats?, fidelity }] }.
// A body with no `records` (e.g. a raw OTLP push to THIS base path) is accepted with 202 but not
// persisted here — an OTel exporter instead targets the /v1/metrics sub-route, which parses OTLP metrics
// and persists them per repo. GET is a health probe for the Integrations page "Test" button.

import { NextResponse, type NextRequest } from "next/server";
import { guardIngest, payloadTooLarge, readCappedBody } from "@/lib/integrations/ingest-guard";
import { recordUsage, type UsageRecordInput } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, service: "ascent-integrations-ingest", accepts: "POST" });
}

/** Parse one untrusted record from the JSON contract into a typed UsageRecordInput, or null if invalid. */
function toRecord(x: unknown): UsageRecordInput | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const periodStart = new Date(String(r.periodStart));
  if (Number.isNaN(periodStart.getTime())) return null;
  if (typeof r.source !== "string" || typeof r.scopeKey !== "string") return null;
  const scope = r.scope;
  if (scope !== "repo" && scope !== "user" && scope !== "team" && scope !== "org") return null;
  const fidelity = r.fidelity;
  if (fidelity !== "measured" && fidelity !== "allocated") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    source: r.source,
    scope,
    scopeKey: r.scopeKey,
    periodStart,
    fidelity,
    tokens: num(r.tokens),
    costCents: num(r.costCents),
    sessions: num(r.sessions),
    seats: num(r.seats),
  };
}

export async function POST(req: NextRequest) {
  const gate = await guardIngest(req);
  if (gate.deny) return gate.deny;

  const read = await readCappedBody(req);
  if (!read.ok) return payloadTooLarge();
  const raw = read.text;
  let body: { records?: unknown } = {};
  try {
    body = raw ? (JSON.parse(raw) as { records?: unknown }) : {};
  } catch {
    /* non-JSON (e.g. raw OTLP protobuf) — accepted below, not persisted */
  }

  if (Array.isArray(body.records) && body.records.length > 0) {
    const records = body.records.map(toRecord).filter((r): r is UsageRecordInput => r !== null);
    const res = await recordUsage(gate.slug, records);
    return NextResponse.json({ accepted: true, persisted: res.ok, stored: res.stored, org: gate.slug }, { status: 202 });
  }

  return NextResponse.json(
    {
      accepted: true,
      persisted: false,
      org: gate.slug,
      note: "Token valid, telemetry accepted. Send {records:[...]} here to persist, or point an OTel exporter at this endpoint — its /v1/metrics receiver attributes spend per repo.",
    },
    { status: 202 },
  );
}
