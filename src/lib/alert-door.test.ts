// @vitest-environment node
//
// The alert delivery door (src/lib/alert-door.ts): one place that reads the sink, resolves it, claims
// a slot, dispatches and writes the history row. These cases pin the two halves the call sites used to
// restate by hand: the suppressedReason table (`alertOutcome`, pure) and the claim/release/record
// sequence (`deliverAlert`), including the one outcome that most needs a row: delivery failed AND the
// window claim could not be released.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getOrgAlertWebhook: vi.fn(async () => null as string | null),
  recordAlertEvent: vi.fn(async () => true),
}));
vi.mock("@/lib/db/scans-audit", () => ({
  claimOrgAuditOnce: vi.fn(async () => ({ claimed: true, id: "clm_1" })),
  releaseAuditClaim: vi.fn(async () => {}),
}));
vi.mock("@/lib/alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/alerts")>()),
  dispatchAlert: vi.fn(async () => true),
}));

import { alertOutcome, deliverAlert, readAlertSink } from "./alert-door";
import { getOrgAlertWebhook, recordAlertEvent } from "@/lib/db";
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";
import { __resetRegressionCooldowns, dispatchAlert } from "@/lib/alerts";

const mockWebhook = vi.mocked(getOrgAlertWebhook);
const mockRecord = vi.mocked(recordAlertEvent);
const mockClaim = vi.mocked(claimOrgAuditOnce);
const mockRelease = vi.mocked(releaseAuditClaim);
const mockDispatch = vi.mocked(dispatchAlert);

const MSG = { text: "hello", blocks: [] };

beforeEach(() => {
  vi.clearAllMocks();
  __resetRegressionCooldowns();
  mockWebhook.mockResolvedValue(null);
  mockRecord.mockResolvedValue(true);
  mockClaim.mockResolvedValue({ claimed: true, id: "clm_1" } as never);
  mockRelease.mockResolvedValue(undefined);
  mockDispatch.mockResolvedValue(true);
  vi.stubEnv("ALERT_WEBHOOK_URL", "https://global.example/hook");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("alertOutcome: the one suppressedReason table", () => {
  it("a sink that could not be READ is sink-unreadable, never no-sink", () => {
    expect(alertOutcome({ sinkUnreadable: true })).toBe("sink-unreadable");
  });
  it("an alert that was never eligible carries no reason", () => {
    expect(alertOutcome({ eligible: false })).toBeNull();
  });
  it("no resolvable sink is no-sink", () => {
    expect(alertOutcome({ resolved: null })).toBe("no-sink");
  });
  it("a resolved sink with a lost claim is cooldown", () => {
    expect(alertOutcome({ resolved: "https://hooks.example/acme", claimed: false })).toBe("cooldown");
  });
  it("a claimed send that did not land is dispatch-failed", () => {
    expect(alertOutcome({ claimed: true, dispatched: false })).toBe("dispatch-failed");
  });
  it("a delivered alert carries no reason", () => {
    expect(alertOutcome({ dispatched: true })).toBeNull();
  });
});

describe("deliverAlert: the durable window claim", () => {
  it("dispatch fails and the release rejects: the release error surfaces AND the digest row is still written", async () => {
    mockDispatch.mockResolvedValue(false);
    mockRelease.mockRejectedValue(new Error("release blew up"));
    const errors: string[] = [];
    const out = await deliverAlert({
      org: "acme",
      sink: { ok: true, value: "https://hooks.example/acme" },
      kind: "digest",
      severity: "info",
      title: "Weekly fleet digest",
      claim: { window: { action: "org.digest.sent", since: new Date("2026-09-14T00:00:00Z"), meta: {} } },
      onReleaseError: (err) => errors.push(err instanceof Error ? err.message : String(err)),
      build: () => MSG,
    });
    expect(out.delivered).toBe(false);
    expect(mockRelease).toHaveBeenCalledWith("clm_1");
    expect(errors).toEqual(["release blew up"]);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ kind: "digest", delivered: false, suppressedReason: "dispatch-failed", sinkKind: "webhook" }),
    );
  });

  it("a window another run already owns: no dispatch, no row, claimed:false", async () => {
    mockClaim.mockResolvedValue({ claimed: false, id: null } as never);
    const out = await deliverAlert({
      org: "acme",
      sink: { ok: true, value: "https://hooks.example/acme" },
      kind: "digest",
      severity: "info",
      title: "Weekly fleet digest",
      claim: { window: { action: "org.digest.sent", since: new Date(), meta: {} } },
      build: () => MSG,
    });
    expect(out).toMatchObject({ delivered: false, claimed: false, recorded: false });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("deliverAlert: the sink read", () => {
  it("a thrown lookup never reaches the global fallback: no dispatch, sink-unreadable row", async () => {
    mockWebhook.mockRejectedValue(new Error("db connection reset"));
    const out = await deliverAlert({ org: "acme", kind: "regression", severity: "warning", title: "t", build: () => MSG });
    expect(out.outcome).toBe("sink-unreadable");
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ delivered: false, suppressedReason: "sink-unreadable", sinkKind: null }),
    );
  });

  it("guard: a genuine null column still rides the global sink, and sinkKind names the RESOLVED channel", async () => {
    vi.stubEnv("ALERT_WEBHOOK_URL", "mailto:ops@operator.example");
    const out = await deliverAlert({ org: "acme", kind: "regression", severity: "warning", title: "t", build: () => MSG });
    expect(out.delivered).toBe(true);
    expect(mockDispatch).toHaveBeenCalledWith(MSG, expect.objectContaining({ webhookUrl: null, org: "acme" }));
    expect(mockRecord).toHaveBeenCalledWith("acme", expect.objectContaining({ sinkKind: "email", delivered: true }));
  });

  it("readAlertSink: no org reads nothing and is a clean null", async () => {
    expect(await readAlertSink(undefined)).toEqual({ ok: true, value: null });
    expect(mockWebhook).not.toHaveBeenCalled();
  });

  it("an ineligible alert reads no sink and claims nothing, but still records", async () => {
    const out = await deliverAlert({
      org: "acme",
      eligible: false,
      kind: "control",
      severity: "info",
      title: "t",
      claim: { cooldown: ["acme/api::c1"] },
      build: () => MSG,
    });
    expect(out.outcome).toBeNull();
    expect(mockWebhook).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith("acme", expect.objectContaining({ delivered: false, suppressedReason: null }));
  });

  it("a rejecting dispatch is a dispatch-failed row, never a throw", async () => {
    mockWebhook.mockResolvedValue("https://hooks.example/acme");
    mockDispatch.mockRejectedValue(new Error("boom"));
    const out = await deliverAlert({ org: "acme", kind: "regression", severity: "warning", title: "t", build: () => MSG });
    expect(out).toMatchObject({ delivered: false, outcome: "dispatch-failed" });
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});
