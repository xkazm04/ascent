// Pins the spend-that-lands-nowhere reconciliation (card providers-1): the buckets, the hidden
// share, the one-shot scan plan, the unknown-is-not-zero state, and the Claude ladder reading it.
import { describe, expect, it } from "vitest";
import {
  clearLine,
  hiddenLine,
  reconcile,
  remedyText,
  scanDisclosure,
  scanLabel,
  scanPlan,
  type AttributionWire,
} from "./attributionReconcileModel";
import { connectionLadder, spendLadder } from "./integrationLadder";
import { emptyIntegrations } from "./integrationModel";

const base = { deliverySet: [] as string[], fleet: [] as string[], gitlabConnected: false };

describe("reconcile", () => {
  it("buckets landed and outside-fleet spend and computes the hidden share", () => {
    const rec = reconcile({
      ...base,
      measured: [
        { repo: "acme/x", costCents: 4000 },
        { repo: "acme/y", costCents: 1000 },
      ],
      deliverySet: ["acme/x"],
      fleet: ["acme/x"],
    });
    expect(rec.landed).toEqual(["acme/x"]);
    expect(rec.outsideFleet).toEqual(["acme/y"]);
    expect(rec.hiddenCostCents).toBe(1000);
    expect(rec.hiddenShare).toBe(0.2);
    expect(rec.state).toBe("hidden");
    expect(hiddenLine(rec)).toBe("$10.00 of $50.00 measured spend (20%) lands on 1 repository AI delivery cannot show.");
  });

  it("joins case-folded, the same lower-case join Delivery uses", () => {
    const rec = reconcile({ ...base, measured: [{ repo: "Acme/X", costCents: 500 }], deliverySet: ["acme/x"], fleet: ["acme/x"] });
    expect(rec.landed).toEqual(["Acme/X"]);
    expect(rec.outsideFleet).toEqual([]);
    expect(rec.state).toBe("clear");
    expect(clearLine(rec)).toContain("lands on 1 repository AI delivery shows");
  });

  it("separates a fleet repo with no PR signals (rescan) from one outside the fleet (add)", () => {
    const rec = reconcile({
      ...base,
      measured: [
        { repo: "acme/z", costCents: 300 },
        { repo: "acme/q", costCents: 200 },
      ],
      fleet: ["acme/z"],
    });
    expect(rec.inFleetNoSignals).toEqual(["acme/z"]);
    expect(rec.rows.find((r) => r.repo === "acme/z")?.action).toBe("rescan");
    expect(rec.rows.find((r) => r.repo === "acme/q")?.action).toBe("add");
    expect(remedyText("rescan")).not.toBe(remedyText("add"));
    expect(scanPlan("acme", rec.rows)?.request.repos).toEqual(["acme/q"]);
  });

  it("plans a one-shot scan, most hidden cost first, and discloses the count; nothing outside means no plan", () => {
    const rec = reconcile({
      ...base,
      measured: [
        { repo: "acme/y", costCents: 100 },
        { repo: "acme/w", costCents: 900 },
      ],
    });
    expect(rec.outsideFleet.sort()).toEqual(["acme/w", "acme/y"]);
    const plan = scanPlan("acme", rec.rows);
    expect(plan?.request).toMatchObject({ org: "acme", repos: ["acme/w", "acme/y"], watch: false, schedule: "off" });
    expect(plan?.scans).toBe(2);
    expect(scanLabel(plan!)).toBe("Scan 2 repositories");
    expect(scanDisclosure(plan!)).toContain("2 in all");
    expect(scanDisclosure(plan!)).toContain("not watched and not scheduled");
    expect(scanPlan("acme", reconcile({ ...base, measured: [{ repo: "acme/x", costCents: 1 }], deliverySet: ["acme/x"] }).rows)).toBeNull();
  });

  it("says nothing about hidden spend when no measured repo rows exist (unknown is not zero)", () => {
    const rec = reconcile({ ...base, measured: [] });
    expect(rec.state).toBe("none");
    expect(rec.hiddenShare).toBeNull();
    expect(hiddenLine(rec)).toBeNull();
    expect(clearLine(rec)).toBeNull();
  });

  it("holds a GitLab repo back until a GitLab installation is stored", () => {
    const measured = [{ repo: "gitlab:group/p", costCents: 700 }];
    const off = reconcile({ ...base, measured });
    expect(off.outsideFleet).toEqual(["gitlab:group/p"]);
    expect(off.rows[0]?.action).toBe("connect-gitlab");
    expect(remedyText("connect-gitlab")).toContain("Connect GitLab first");
    expect(scanPlan("acme", off.rows)).toBeNull();
    const on = reconcile({ ...base, measured, gitlabConnected: true });
    expect(scanPlan("acme", on.rows)?.request.repos).toEqual(["gitlab:group/p"]);
  });

  it("writes no em dash into any line it renders", () => {
    const rec = reconcile({ ...base, measured: [{ repo: "acme/y", costCents: 1000 }] });
    const plan = scanPlan("acme", rec.rows)!;
    const copy = [hiddenLine(rec), scanLabel(plan), scanDisclosure(plan), remedyText("add"), remedyText("rescan"), remedyText("connect-gitlab")];
    for (const text of copy) expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});

describe("connection ladder reads the reconciliation", () => {
  function claudeData(attribution: AttributionWire | undefined) {
    const data = emptyIntegrations("acme");
    data.ingestToken = "asc_otel.acme.secret";
    data.statuses = [
      { source: "claude-code", lastReceived: new Date().toISOString(), repos: 2, costCents: 5000, tokens: 1, seats: 0, sessions: 0, measured: true, attribution },
    ];
    return data;
  }
  const wire = (deliverySet: string[]): AttributionWire => ({
    windowTitle: "Last 90 days",
    measured: [
      { repo: "acme/a", costCents: 3000 },
      { repo: "acme/b", costCents: 2000 },
    ],
    deliverySet,
    fleet: [],
    gitlabConnected: false,
  });

  it("does not call attribution reached when Delivery cannot show either repo", () => {
    const data = claudeData(wire([]));
    const landed = connectionLadder(data, "claude-code").find((s) => s.key === "landed")!;
    expect(landed.state).toBe("current");
    expect(landed.detail).toContain("$50.00");
    expect(landed.detail).toContain("AI delivery cannot show");
    expect(spendLadder(data).find((s) => s.key === "repo")?.state).toBe("current");
  });

  it("still calls it reached when a measured repo lands on Delivery", () => {
    const data = claudeData(wire(["acme/a"]));
    expect(connectionLadder(data, "claude-code").find((s) => s.key === "landed")?.state).toBe("reached");
    expect(spendLadder(data).find((s) => s.key === "repo")?.state).toBe("reached");
  });

  it("keeps the repo-count reading when no reconciliation was read", () => {
    const data = claudeData(undefined);
    expect(connectionLadder(data, "claude-code").find((s) => s.key === "landed")?.state).toBe("reached");
  });
});
