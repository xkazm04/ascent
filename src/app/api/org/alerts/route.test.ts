// @vitest-environment node
//
// POST /api/org/alerts — the threshold half of the sink config.
//
// WHY THIS FILE EXISTS: the route advertises `overallDrop` and `dimensionDrop` as independently
// optional and gates on `"overallDrop" in body || "dimensionDrop" in body`, but parsed an ABSENT key
// to the same `null` an explicit clear produces — so a documented one-sided update silently reset the
// other threshold to the default. The popover always posts both fields, which is exactly why nothing
// caught it: the only client in the repo never exercises the shape the API promises.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getOrgAlertThresholds: vi.fn(async () => ({ overallDrop: 7, dimensionDrop: 22 })),
  setOrgAlertThresholds: vi.fn(async (_org: string, t: unknown) => t),
  getOrgAlertWebhook: vi.fn(async () => null),
  setOrgAlertWebhook: vi.fn(async (_org: string, url: string | null) => url),
  getAlertsWatermark: vi.fn(async () => null),
  getOrgMovementSince: vi.fn(async () => null),
  listAlertEvents: vi.fn(async () => []),
  markAlertsSeen: vi.fn(async () => true),
  recordOrgAudit: vi.fn(async () => undefined),
  recordAlertEvent: vi.fn(async () => true),
}));
vi.mock("@/lib/db/alert-events", () => ({ getAlertEventForResend: vi.fn(async () => null) }));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "octocat") }));
vi.mock("@/lib/alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/alerts")>()),
  dispatchAlert: vi.fn(async () => true),
}));

import { GET, POST } from "./route";
import {
  getOrgAlertThresholds,
  getOrgAlertWebhook,
  listAlertEvents,
  recordAlertEvent,
  recordOrgAudit,
  setOrgAlertThresholds,
} from "@/lib/db";
import { getAlertEventForResend } from "@/lib/db/alert-events";
import { requireOrgRole } from "@/lib/authz";
import { dispatchAlert } from "@/lib/alerts";

const mockGet = vi.mocked(getOrgAlertThresholds);
const mockSet = vi.mocked(setOrgAlertThresholds);

function post(body: unknown): Request {
  return new Request("https://ascent.test/api/org/alerts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/org/alerts — thresholds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ overallDrop: 7, dimensionDrop: 22 });
    mockSet.mockImplementation(async (_org, t) => t);
  });

  it("a one-sided update leaves the OTHER threshold exactly as stored", async () => {
    await POST(post({ org: "acme", overallDrop: 9 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 9, dimensionDrop: 22 });
  });

  it("…in the other direction too", async () => {
    await POST(post({ org: "acme", dimensionDrop: 30 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 7, dimensionDrop: 30 });
  });

  it("an EXPLICIT null still clears that field back to the default", async () => {
    await POST(post({ org: "acme", overallDrop: null }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: null, dimensionDrop: 22 });
  });

  it("both fields present is a straight write — and costs no extra read", async () => {
    await POST(post({ org: "acme", overallDrop: 4, dimensionDrop: 12 }));
    expect(mockSet).toHaveBeenCalledWith("acme", { overallDrop: 4, dimensionDrop: 12 });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range value without writing anything", async () => {
    const res = await POST(post({ org: "acme", overallDrop: 0 }));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/alerts: test send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dispatchAlert).mockResolvedValue(true);
  });

  it("a test send to the stored mailto: sink writes exactly one AlertEvent row, kind test", async () => {
    vi.mocked(getOrgAlertWebhook).mockResolvedValue("mailto:ops@acme.test");
    const res = await POST(post({ org: "acme", test: true }));
    expect(await res.json()).toMatchObject({ ok: true, delivered: true });
    expect(dispatchAlert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ webhookUrl: "mailto:ops@acme.test", org: "acme" }),
    );
    expect(recordAlertEvent).toHaveBeenCalledTimes(1);
    expect(recordAlertEvent).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ kind: "test", sinkKind: "email", delivered: true }),
    );
  });
});

// ── fleet-alerts-digests#B: sink health on history=1, and the admin resend ─────────────────────────

function get(query: string): Request {
  return new Request(`https://ascent.test/api/org/alerts?${query}`);
}

const ACME_FAILED_DIGEST = {
  id: "acme-1",
  kind: "digest",
  severity: "info",
  repoFullName: null,
  title: "Weekly digest",
  delivered: false,
  sinkKind: "webhook",
  suppressedReason: "dispatch-failed",
  createdAt: "2026-09-15T13:00:00.000Z",
  body: "Your fleet this week: 3 repos moved.",
};

describe("GET /api/org/alerts?history=1: health beside the events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrgRole).mockResolvedValue(null);
  });

  it("returns { events, health }; resendable only for an intact failed/no-sink body; never the body", async () => {
    vi.mocked(listAlertEvents).mockResolvedValue([
      { ...ACME_FAILED_DIGEST, id: "e3", createdAt: "2026-09-22T13:00:00.000Z" },
      { ...ACME_FAILED_DIGEST, id: "e2", body: "x".repeat(2000) },
      { ...ACME_FAILED_DIGEST, id: "e1", delivered: true, suppressedReason: null, createdAt: "2026-09-08T13:00:00.000Z" },
    ] as never);
    const res = await GET(get("org=acme&history=1"));
    const data = await res.json();
    expect(data.health).toMatchObject({ state: "failing", consecutiveFailures: 2, unsent: 2 });
    expect(data.health.failingSince).toBe("2026-09-15T13:00:00.000Z");
    expect(data.events.map((e: { id: string; resendable: boolean }) => [e.id, e.resendable])).toEqual([
      ["e3", true],
      ["e2", false],
      ["e1", false],
    ]);
    expect(JSON.stringify(data)).not.toContain("Your fleet this week");
    // Member-readable: the viewer gate, never the admin one.
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "viewer");
    expect(requireOrgRole).not.toHaveBeenCalledWith("acme", "admin");
  });
});

describe("POST /api/org/alerts { resend }", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOrgRole).mockResolvedValue(null);
    vi.mocked(dispatchAlert).mockResolvedValue(true);
    vi.mocked(getOrgAlertWebhook).mockResolvedValue("https://hooks.slack.com/services/T/B/acme");
    // Org-constrained like the real reader: a row is found only by id AND the gated org.
    vi.mocked(getAlertEventForResend).mockImplementation(async (org: string, id: string) =>
      org === "acme" && id === "acme-1" ? { ...ACME_FAILED_DIGEST } : null,
    );
  });

  it("gate-then-constrain: another org's event id is simply not found (404), nothing dispatched", async () => {
    const res = await POST(post({ org: "acme", resend: "beta-7" }));
    expect(res.status).toBe(404);
    expect(getAlertEventForResend).toHaveBeenCalledWith("acme", "beta-7");
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(recordOrgAudit).not.toHaveBeenCalled();
  });

  it("re-sends the stored text as a NEW row with the same kind and title, and audits it once", async () => {
    const res = await POST(post({ org: "acme", resend: "acme-1" }));
    expect(await res.json()).toMatchObject({ ok: true, delivered: true });
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(dispatchAlert).mock.calls[0]!;
    expect(message.text).toContain("Your fleet this week: 3 repos moved.");
    expect(recordAlertEvent).toHaveBeenCalledTimes(1);
    expect(recordAlertEvent).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ kind: "digest", title: "Weekly digest", delivered: true }),
    );
    expect(recordOrgAudit).toHaveBeenCalledTimes(1);
    expect(recordOrgAudit).toHaveBeenCalledWith(
      "org.alerts.resend",
      "acme",
      expect.objectContaining({ eventId: "acme-1", kind: "digest" }),
      "octocat",
    );
  });

  it("an admin denial is a 403 with no dispatch and no lookup", async () => {
    vi.mocked(requireOrgRole).mockImplementation(async (_org: string, role?: string) =>
      role === "admin" ? (Response.json({ error: "forbidden" }, { status: 403 }) as never) : null,
    );
    const res = await POST(post({ org: "acme", resend: "acme-1" }));
    expect(res.status).toBe(403);
    expect(getAlertEventForResend).not.toHaveBeenCalled();
    expect(dispatchAlert).not.toHaveBeenCalled();
  });

  it("guard: a row that is not resendable (delivered) is refused with 409, nothing dispatched", async () => {
    vi.mocked(getAlertEventForResend).mockResolvedValue({ ...ACME_FAILED_DIGEST, delivered: true, suppressedReason: null });
    const res = await POST(post({ org: "acme", resend: "acme-1" }));
    expect(res.status).toBe(409);
    expect(dispatchAlert).not.toHaveBeenCalled();
  });
});
