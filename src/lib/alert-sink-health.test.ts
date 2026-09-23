// @vitest-environment node
//
// Sink health from the AlertEvent ledger alone (fleet-alerts-digests#B). The rows already say, per
// alert, whether it left and why not; this pins the arithmetic that turns them into "is my sink
// working, since when, and what was lost", and the rule for which rows a resend may re-send.

import { describe, it, expect } from "vitest";
import { ALERT_BODY_CAP, isResendable, sinkHealth, sinkHealthLine, toHistoryEvent, type SinkHealthRow } from "./alert-sink-health";

function row(over: Partial<SinkHealthRow> & { createdAt: string }): SinkHealthRow {
  return { kind: "digest", delivered: false, suppressedReason: null, ...over };
}
const failed = (createdAt: string, kind = "digest") => row({ createdAt, kind, suppressedReason: "dispatch-failed" });
const delivered = (createdAt: string) => row({ createdAt, delivered: true });
const cooldown = (createdAt: string) => row({ createdAt, kind: "regression", suppressedReason: "cooldown" });
const noSink = (createdAt: string) => row({ createdAt, suppressedReason: "no-sink" });

describe("sinkHealth", () => {
  it("two failures since the last delivery: failing since the OLDER failure, both unsent", () => {
    const h = sinkHealth([
      failed("2026-09-22T13:00:00.000Z"),
      failed("2026-09-15T13:00:00.000Z"),
      delivered("2026-09-08T13:00:00.000Z"),
    ]);
    expect(h).toMatchObject({
      state: "failing",
      consecutiveFailures: 2,
      failingSince: "2026-09-15T13:00:00.000Z",
      lastDeliveredAt: "2026-09-08T13:00:00.000Z",
      unsent: 2,
      exact: true,
    });
  });

  it("a cooldown or an ineligible (control-unmeasurable) row neither counts as a failure nor breaks the streak", () => {
    const h = sinkHealth([
      failed("2026-09-22T00:00:00.000Z"),
      cooldown("2026-09-21T00:00:00.000Z"),
      row({ createdAt: "2026-09-20T00:00:00.000Z", kind: "control", suppressedReason: null }),
      failed("2026-09-19T00:00:00.000Z"),
      delivered("2026-09-18T00:00:00.000Z"),
    ]);
    expect(h.state).toBe("failing");
    expect(h.consecutiveFailures).toBe(2);
    expect(h.failingSince).toBe("2026-09-19T00:00:00.000Z");
    expect(h.unsent).toBe(2);
  });

  it("'nothing was attempted' and 'every attempt failed' are distinguishable from the rows alone", () => {
    expect(sinkHealth([noSink("2026-09-22T00:00:00.000Z"), noSink("2026-09-15T00:00:00.000Z")])).toMatchObject({
      state: "unconfigured",
      consecutiveFailures: 0,
      unsent: 2,
    });
    expect(sinkHealth([])).toMatchObject({ state: "no-attempts", consecutiveFailures: 0, unsent: 0, failingSince: null });
    expect(sinkHealth([cooldown("2026-09-22T00:00:00.000Z"), delivered("2026-09-21T00:00:00.000Z")])).toMatchObject({
      state: "healthy",
      consecutiveFailures: 0,
      lastDeliveredAt: "2026-09-21T00:00:00.000Z",
    });
  });

  it("guard: a failed TEST send marks the sink failing but is not an alert that went unsent", () => {
    const h = sinkHealth([failed("2026-09-22T00:00:00.000Z", "test"), delivered("2026-09-21T00:00:00.000Z")]);
    expect(h).toMatchObject({ state: "failing", consecutiveFailures: 1, unsent: 0 });
  });

  it("guard: a streak that runs off the end of a full window says its start is a lower bound", () => {
    const h = sinkHealth([failed("2026-09-22T00:00:00.000Z"), failed("2026-09-15T00:00:00.000Z")], { windowFull: true });
    expect(h.exact).toBe(false);
    expect(sinkHealthLine(h)).toBe("Failing since at least 2026-09-15. 2 alerts not delivered.");
  });
});

describe("sinkHealthLine", () => {
  it("reads the failing state as one plain sentence pair", () => {
    const h = sinkHealth([failed("2026-09-22T13:00:00Z"), failed("2026-09-15T13:00:00Z")]);
    expect(sinkHealthLine(h)).toBe("Failing since 2026-09-15. 2 alerts not delivered.");
    expect(sinkHealthLine(sinkHealth([failed("2026-09-22T13:00:00Z")]))).toBe(
      "Failing since 2026-09-22. 1 alert not delivered.",
    );
  });

  it("guard: a quiet org gets no line, a healthy one gets its last delivery", () => {
    expect(sinkHealthLine(sinkHealth([]))).toBeNull();
    expect(sinkHealthLine(sinkHealth([delivered("2026-09-21T08:00:00Z")]))).toBe("Sink healthy. Last delivered 2026-09-21.");
  });
});

describe("isResendable / toHistoryEvent", () => {
  const base = {
    id: "e1",
    kind: "digest",
    severity: "info",
    repoFullName: null,
    title: "Weekly digest",
    delivered: false,
    sinkKind: "webhook",
    suppressedReason: "dispatch-failed",
    createdAt: "2026-09-15T13:00:00.000Z",
    body: "Your fleet this week",
  };

  it("a failed or never-sent alert with an intact stored body is resendable", () => {
    expect(isResendable(base)).toBe(true);
    expect(isResendable({ ...base, suppressedReason: "no-sink" })).toBe(true);
  });

  it("delivered, deliberately suppressed, test, empty or possibly-truncated rows are not", () => {
    expect(isResendable({ ...base, delivered: true, suppressedReason: null })).toBe(false);
    expect(isResendable({ ...base, suppressedReason: "cooldown" })).toBe(false);
    expect(isResendable({ ...base, suppressedReason: null })).toBe(false);
    expect(isResendable({ ...base, kind: "test" })).toBe(false);
    expect(isResendable({ ...base, body: "" })).toBe(false);
    expect(isResendable({ ...base, body: "x".repeat(ALERT_BODY_CAP) })).toBe(false);
    expect(isResendable({ ...base, body: "x".repeat(ALERT_BODY_CAP - 1) })).toBe(true);
  });

  it("the wire row carries the flag and never the body", () => {
    const out = toHistoryEvent(base);
    expect(out.resendable).toBe(true);
    expect("body" in out).toBe(false);
    expect(out.title).toBe("Weekly digest");
  });
});
