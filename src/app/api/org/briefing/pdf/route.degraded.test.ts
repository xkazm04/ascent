// robustness-4/-5 on the PDF route: a thrown read is a server fault (503, reported), never a user-facing
// fact ("unknown scope" / "no scans"); best-effort degrades leave a door. Sibling of route.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
// respondError reports via its own cause contract; model that without the Sentry/after plumbing.
vi.mock("@/lib/api/respond", () => ({
  reportHandledError: report,
  respondError: (status: number, message: string, opts: { cause?: unknown } = {}) => {
    if (opts.cause !== undefined) report(opts.cause, { status, message });
    return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null) }));
vi.mock("@/lib/org/briefing", () => ({ buildExecBriefing: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock("@/lib/org/briefing-narrative", () => ({ attachBriefingNarrative: vi.fn(async (b: unknown) => b) }));
vi.mock("@/lib/db", () => ({
  getOrgBranding: vi.fn(),
  getCreditState: vi.fn(),
  getTechGroupIdByKey: vi.fn(),
  isDbConfigured: vi.fn(() => true),
}));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn() }));
vi.mock("@/lib/net/logo-fetch", () => ({ resolveSafeLogoDataUri: vi.fn(async (u: string) => u) }));
vi.mock("@/lib/pdf/briefing-document", () => ({ BriefingDocument: () => null }));

import { GET } from "./route";
import { buildExecBriefing } from "@/lib/org/briefing";
import { getOrgBranding, getCreditState, getTechGroupIdByKey } from "@/lib/db";
import { renderToBuffer } from "@react-pdf/renderer";

const BRIEFING = { org: "acme", generatedOn: "2026-06-18", periodTitle: "Last 90 days" };
const boom = new Error("db down");
const get = (q = "") => GET(new Request(`http://localhost/api/org/briefing/pdf?org=acme${q}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildExecBriefing).mockResolvedValue(BRIEFING as never);
  vi.mocked(getTechGroupIdByKey).mockResolvedValue(null);
  vi.mocked(getOrgBranding).mockResolvedValue({ logoUrl: "https://cdn.example/logo.png" } as never);
  vi.mocked(getCreditState).mockResolvedValue({ plan: "team" } as never);
  vi.mocked(renderToBuffer).mockResolvedValue(Buffer.from("%PDF-1.7"));
});

describe("briefing PDF route — failed reads are not user-facing facts", () => {
  it("answers 503 try-again (not 404 'Unknown tech-stack scope') when the scope read FAILS, and reports it", async () => {
    vi.mocked(getTechGroupIdByKey).mockRejectedValue(boom);
    const res = await get("&stack=frontend");
    expect(res.status).toBe(503);
    const { error } = await res.json();
    expect(error).toMatch(/try again/i);
    expect(error).not.toMatch(/unknown/i);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ status: 503 }));
    expect(buildExecBriefing).not.toHaveBeenCalled(); // still fails closed: never the whole-org briefing
  });

  it("still answers 404 'Unknown tech-stack scope' when the read RETURNED none", async () => {
    const res = await get("&stack=gone");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Unknown tech-stack scope/);
    expect(report).not.toHaveBeenCalled();
  });

  it("reports a thrown build with a 503 body and does not call it 'no scans'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(buildExecBriefing).mockRejectedValue(boom);
    const res = await get();
    expect(res.status).toBe(503);
    expect(report).toHaveBeenCalledWith(boom, expect.objectContaining({ status: 503 }));
  });
});

describe("briefing PDF route — best-effort degrades reach a door", () => {
  it("renders unbranded, warns and reports when branding and credit reads fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getOrgBranding).mockRejectedValue(boom);
    vi.mocked(getCreditState).mockRejectedValue(boom);
    expect((await get()).status).toBe(200);
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("briefing pdf branding failed");
    expect(warned).toContain("briefing pdf credit state failed");
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("warns and reports when the branded render fails and the unbranded retry rescues it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(renderToBuffer).mockRejectedValueOnce(boom).mockResolvedValueOnce(Buffer.from("%PDF-1.7"));
    expect((await get()).status).toBe(200);
    expect(String(warn.mock.calls[0]?.[0])).toContain("branded render");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
  });
});
