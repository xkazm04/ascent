// Pins the OTLP metrics receiver's wire-format guard. A default OTel exporter speaks OTLP/protobuf,
// which we don't decode: rather than 202-and-drop (a phantom success with no data), a protobuf
// content-type is REFUSED with 415 naming the OTEL_EXPORTER_OTLP_PROTOCOL=http/json fix. http/json is
// parsed and persisted as before; a bodyless probe with no content-type stays 202 (the connect page's
// "Test ingest token"). Auth (401) runs BEFORE the content-type check — a protobuf body with a bad
// token gets 401, not 415, so the wire-format behavior never leaks to unauthenticated callers.
// The token + db + otlp boundaries are mocked; the route's dispatch runs for real.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/integrations/ingest-token", () => ({
  bearerToken: vi.fn((auth: string | null) => (auth ? auth.replace(/^Bearer /i, "") : null)),
  parseIngestToken: vi.fn(),
}));
vi.mock("@/lib/integrations/otlp", () => ({ parseOtlpMetrics: vi.fn() }));
vi.mock("@/lib/db", () => ({ recordUsage: vi.fn(async () => ({ ok: true, stored: 1 })) }));

import { POST } from "./route";
import { MAX_BODY } from "@/lib/integrations/ingest-guard";
import { parseIngestToken } from "@/lib/integrations/ingest-token";
import { parseOtlpMetrics } from "@/lib/integrations/otlp";
import { recordUsage } from "@/lib/db";

const mockParse = vi.mocked(parseIngestToken);
const mockOtlp = vi.mocked(parseOtlpMetrics);
const mockRecord = vi.mocked(recordUsage);

/** A parseOtlpMetrics result with sane defaults, so each case states only what it cares about. */
function parseResult(over: Partial<ReturnType<typeof parseOtlpMetrics>> = {}): ReturnType<typeof parseOtlpMetrics> {
  return {
    records: [{ scope: "repo", scopeKey: "acme/api" }],
    received: 1,
    skipped: { "unknown-metric": 0, "no-repo-attr": 0, "unsupported-host": 0 },
    unsupportedHosts: [],
    ...over,
  } as unknown as ReturnType<typeof parseOtlpMetrics>;
}

function mkReq(opts: { body?: string; contentType?: string; auth?: string | null } = {}): NextRequest {
  const { body, contentType, auth = "Bearer asc_otel.acme.mac" } = opts;
  const headers: Record<string, string> = {};
  if (auth) headers.authorization = auth;
  if (contentType) headers["content-type"] = contentType;
  return new Request("http://localhost/api/integrations/ingest/v1/metrics", { method: "POST", headers, body }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParse.mockReturnValue({ slug: "acme", epoch: 0 } as ReturnType<typeof parseIngestToken>);
  mockOtlp.mockReturnValue(parseResult());
  mockRecord.mockResolvedValue({ ok: true, stored: 1 });
});

describe("POST /api/integrations/ingest/v1/metrics — wire-format guard", () => {
  it("415s an OTLP/protobuf body with an actionable http/json message, without persisting", async () => {
    const res = await POST(mkReq({ body: "\x08\x01protobuf", contentType: "application/x-protobuf" }));
    expect(res.status).toBe(415);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/OTEL_EXPORTER_OTLP_PROTOCOL=http\/json/);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("parses and persists an http/json body (behavior unchanged)", async () => {
    const res = await POST(mkReq({ body: JSON.stringify({ resourceMetrics: [] }), contentType: "application/json" }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, persisted: true, stored: 1, org: "acme" });
    expect(mockOtlp).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });

  it("keeps the bodyless no-content-type probe at 202 (the connect page's Test button)", async () => {
    const res = await POST(mkReq({})); // no content-type, no body
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ accepted: true, persisted: false });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await POST(mkReq({ body: "{not json", contentType: "application/json" }));
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("413s a body over the ingest cap instead of buffering it, and persists nothing", async () => {
    const req = new Request("http://localhost/api/integrations/ingest/v1/metrics", {
      method: "POST",
      headers: { authorization: "Bearer asc_otel.acme.mac", "content-type": "application/json", "content-length": String(MAX_BODY + 1) },
      body: "{}",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("auth precedes the content-type check", () => {
  it("401s a protobuf body with an invalid token (auth first — no 415 leak to unauthenticated callers)", async () => {
    mockParse.mockReturnValue(null);
    const res = await POST(mkReq({ body: "\x08\x01", contentType: "application/x-protobuf", auth: "Bearer bad" }));
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("401s a missing token before any content-type handling", async () => {
    mockParse.mockReturnValue(null);
    const res = await POST(mkReq({ auth: null }));
    expect(res.status).toBe(401);
  });
});

describe("the 202 reports what actually landed", () => {
  it("carries received / stored / skipped-by-reason on a clean push", async () => {
    mockOtlp.mockReturnValue(parseResult({ received: 12 }));
    mockRecord.mockResolvedValue({ ok: true, stored: 3 });
    const res = await POST(mkReq({ body: "{}", contentType: "application/json" }));
    expect(await res.json()).toMatchObject({
      received: 12,
      stored: 3,
      skipped: { "unknown-metric": 0, "no-repo-attr": 0, "unsupported-host": 0 },
    });
  });

  it("names the unsupported hosts and explains the drop when a non-GitHub remote is pushed", async () => {
    mockOtlp.mockReturnValue(
      parseResult({
        records: [],
        received: 9,
        skipped: { "unknown-metric": 0, "no-repo-attr": 0, "unsupported-host": 9 },
        unsupportedHosts: ["gitlab.com"],
      }),
    );
    mockRecord.mockResolvedValue({ ok: true, stored: 0 });
    const res = await POST(mkReq({ body: "{}", contentType: "application/json" }));
    const data = (await res.json()) as { received: number; stored: number; unsupportedHosts: string[]; note: string };
    // The whole point: 9 datapoints in, 0 stored, and the response says so instead of a bare 202.
    expect(data).toMatchObject({ received: 9, stored: 0, unsupportedHosts: ["gitlab.com"] });
    expect(data.note).toMatch(/GitHub repositories/);
  });

  it("summarizes a drop with no unsupported host without blaming the host", async () => {
    mockOtlp.mockReturnValue(
      parseResult({ received: 5, skipped: { "unknown-metric": 2, "no-repo-attr": 3, "unsupported-host": 0 } }),
    );
    const data = (await (await POST(mkReq({ body: "{}", contentType: "application/json" }))).json()) as { note: string };
    expect(data.note).toMatch(/5 datapoint\(s\) were not stored/);
    expect(data.note).not.toMatch(/GitHub repositories/);
  });

  it("omits the note entirely when nothing was skipped", async () => {
    mockOtlp.mockReturnValue(parseResult({ received: 4 }));
    const data = (await (await POST(mkReq({ body: "{}", contentType: "application/json" }))).json()) as { note?: string };
    expect(data.note).toBeUndefined();
  });
});
