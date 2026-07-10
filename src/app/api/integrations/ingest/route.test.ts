// Pins the authenticated AI-usage ingestion entrypoint: an invalid/missing bearer token is rejected
// (401) before any write; a valid token persists ONLY the records that pass toRecord's untrusted-input
// validation (bad scope/fidelity/date dropped); a non-JSON or record-less body is accepted (202) but not
// persisted. The token + db boundaries are mocked; the route's parse/validate/dispatch runs for real.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/integrations/ingest-token", () => ({
  bearerToken: vi.fn((auth: string | null) => (auth ? auth.replace(/^Bearer /i, "") : null)),
  parseIngestToken: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ recordUsage: vi.fn(async () => ({ ok: true, stored: 1 })) }));

import { GET, POST } from "./route";
import { parseIngestToken } from "@/lib/integrations/ingest-token";
import { recordUsage } from "@/lib/db";

const mockParse = vi.mocked(parseIngestToken);
const mockRecord = vi.mocked(recordUsage);

function mkReq(body?: string, auth = "Bearer asc_otel.acme.mac"): NextRequest {
  return new Request("http://localhost/api/integrations/ingest", {
    method: "POST",
    headers: auth ? { authorization: auth, "content-type": "application/json" } : {},
    body,
  }) as unknown as NextRequest;
}

const validRecord = {
  source: "claude-code",
  scope: "repo",
  scopeKey: "acme/api",
  periodStart: "2026-07-01T00:00:00Z",
  fidelity: "measured",
  tokens: 500,
  costCents: 1000,
  sessions: 2,
  seats: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockParse.mockReturnValue({ slug: "acme" } as ReturnType<typeof parseIngestToken>);
  mockRecord.mockResolvedValue({ ok: true, stored: 1 });
});

describe("GET /api/integrations/ingest — health probe", () => {
  it("reports the service is up and accepts POST", async () => {
    const res = await GET();
    expect(await res.json()).toEqual({ ok: true, service: "ascent-integrations-ingest", accepts: "POST" });
  });
});

describe("POST /api/integrations/ingest", () => {
  it("401s a missing/invalid ingest token before touching the DB", async () => {
    mockParse.mockReturnValue(null);
    const res = await POST(mkReq(JSON.stringify({ records: [validRecord] })));
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("persists the org's valid records and returns 202 with the stored count", async () => {
    mockRecord.mockResolvedValue({ ok: true, stored: 1 });
    const res = await POST(mkReq(JSON.stringify({ records: [validRecord] })));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ accepted: true, persisted: true, stored: 1, org: "acme" });
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const [slug, records] = mockRecord.mock.calls[0]!;
    expect(slug).toBe("acme");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ source: "claude-code", scope: "repo", scopeKey: "acme/api", fidelity: "measured" });
    expect(records[0]!.periodStart).toBeInstanceOf(Date);
  });

  it("drops untrusted records that fail validation (bad scope, bad fidelity, bad date)", async () => {
    const res = await POST(
      mkReq(
        JSON.stringify({
          records: [
            validRecord,
            { ...validRecord, scope: "galaxy" }, // invalid scope → dropped
            { ...validRecord, fidelity: "guessed" }, // invalid fidelity → dropped
            { ...validRecord, periodStart: "not-a-date" }, // NaN date → dropped
            { ...validRecord, source: 123 }, // non-string source → dropped
          ],
        }),
      ),
    );
    expect(res.status).toBe(202);
    const [, records] = mockRecord.mock.calls[0]!;
    expect(records).toHaveLength(1); // only the one valid record survived toRecord
  });

  it("accepts a non-JSON body (raw OTLP) with 202 but does not persist", async () => {
    const res = await POST(mkReq("\x08\x01 not json"));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, persisted: false, org: "acme" });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("accepts a record-less JSON body with 202 but does not persist", async () => {
    const res = await POST(mkReq(JSON.stringify({ hello: "world" })));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, persisted: false });
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
