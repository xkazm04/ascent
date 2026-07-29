// Pins the ingest-token rotation endpoint: owner-only, same-origin, explicit-intent, audited, and —
// the part that matters — the token it hands back actually verifies at the NEW epoch while the
// previous one no longer does. The HMAC is NOT mocked here: the response is run through the real
// parseIngestToken, so this proves the rotation produces a working credential rather than a string.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  bumpIngestTokenEpoch: vi.fn(async () => 1),
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "owner-login") }));

import { POST } from "./route";
import { bumpIngestTokenEpoch, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { ingestToken, parseIngestToken } from "@/lib/integrations/ingest-token";

const mockBump = vi.mocked(bumpIngestTokenEpoch);
const mockDbConfigured = vi.mocked(isDbConfigured);
const mockRole = vi.mocked(requireOrgRole);
const mockOrigin = vi.mocked(requireSameOrigin);
const mockAudit = vi.mocked(recordOrgAudit);

function mkReq(body: unknown): Request {
  return new Request("http://localhost/api/integrations/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbConfigured.mockReturnValue(true);
  mockBump.mockResolvedValue(1);
  mockRole.mockResolvedValue(null);
  mockOrigin.mockReturnValue(null);
  mockAudit.mockResolvedValue(true);
});

describe("POST /api/integrations/token — rotation", () => {
  it("returns a token that verifies at the NEW epoch, while the previous one no longer does", async () => {
    mockBump.mockResolvedValue(4);
    const res = await POST(mkReq({ org: "acme", rotate: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { token: string; epoch: number };
    expect(data.epoch).toBe(4);
    // Real HMAC verification of the exact string the owner will paste into their exporter.
    expect(parseIngestToken(data.token)).toEqual({ slug: "acme", epoch: 4 });
    expect(data.token).not.toBe(ingestToken("acme", 3));
  });

  it("lower-cases the org before bumping + minting (slug canonicalization)", async () => {
    const res = await POST(mkReq({ org: "ACME", rotate: true }));
    expect(mockBump).toHaveBeenCalledWith("acme");
    expect(parseIngestToken(((await res.json()) as { token: string }).token)).toEqual({ slug: "acme", epoch: 1 });
  });

  it("audits the rotation with the acting login and the new epoch", async () => {
    await POST(mkReq({ org: "acme", rotate: true }));
    expect(mockAudit).toHaveBeenCalledWith("integrations.token.rotate", "acme", { epoch: 1 }, "owner-login");
  });
});

describe("guards", () => {
  it("requires the owner role", async () => {
    mockRole.mockResolvedValue(new Response(JSON.stringify({ error: "nope" }), { status: 403 }) as never);
    const res = await POST(mkReq({ org: "acme", rotate: true }));
    expect(res.status).toBe(403);
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin POST before any state changes", async () => {
    mockOrigin.mockReturnValue(new Response(JSON.stringify({ error: "cross-origin" }), { status: 403 }) as never);
    const res = await POST(mkReq({ org: "acme", rotate: true }));
    expect(res.status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("requires the explicit rotate flag, so a stray POST can't revoke a fleet's telemetry", async () => {
    const res = await POST(mkReq({ org: "acme" }));
    expect(res.status).toBe(400);
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("400s a missing org", async () => {
    expect((await POST(mkReq({ rotate: true }))).status).toBe(400);
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("503s without a database instead of returning a 'new' token that revokes nothing", async () => {
    mockDbConfigured.mockReturnValue(false);
    const res = await POST(mkReq({ org: "acme", rotate: true }));
    expect(res.status).toBe(503);
    expect(mockBump).not.toHaveBeenCalled();
  });

  it("404s an unknown org (bump reports no row)", async () => {
    mockBump.mockResolvedValue(null);
    const res = await POST(mkReq({ org: "ghost", rotate: true }));
    expect(res.status).toBe(404);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
