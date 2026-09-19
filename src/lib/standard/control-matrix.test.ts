import { describe, expect, it } from "vitest";
import {
  buildControlMatrix,
  collapseFindings,
  detectControlRegressions,
  sinceFor,
  type ConformanceReportRow,
} from "./control-matrix";

function report(over: Partial<ConformanceReportRow> = {}): ConformanceReportRow {
  return {
    id: "r1",
    repoFullName: "acme/api",
    headSha: "abc1234",
    score: 80,
    fails: 0,
    warns: 1,
    unchecked: 0,
    scored: 5,
    specVersion: "0.3.0",
    runShape: "plain",
    summaryOnly: false,
    reportedAt: "2026-06-10T00:00:00.000Z",
    findings: [
      { check: "control.prepush.lint", level: "pass", message: "" },
      { check: "guardrail.never-commit", level: "pass", message: "" },
    ],
    ...over,
  };
}

describe("collapseFindings", () => {
  it("takes the worst level when one run repeats a check id — it cannot manufacture a pass", () => {
    const m = collapseFindings([
      { check: "capability.test.run", level: "pass", message: "ok" },
      { check: "capability.test.run", level: "fail", message: "boom" },
    ]);
    expect(m.get("capability.test.run")).toEqual({ level: "fail", message: "boom" });
  });
});

describe("sinceFor", () => {
  it("returns the oldest report still carrying the current level", () => {
    expect(
      sinceFor([
        { level: "fail", reportedAt: "2026-06-10T00:00:00.000Z" },
        { level: "fail", reportedAt: "2026-06-09T00:00:00.000Z" },
        { level: "pass", reportedAt: "2026-06-08T00:00:00.000Z" },
      ]),
    ).toBe("2026-06-09T00:00:00.000Z");
  });

  it("is NULL when the whole window is one level — an unknown start is never printed as a date", () => {
    expect(
      sinceFor([
        { level: "pass", reportedAt: "2026-06-10T00:00:00.000Z" },
        { level: "pass", reportedAt: "2026-06-09T00:00:00.000Z" },
      ]),
    ).toBeNull();
    expect(sinceFor([])).toBeNull();
    expect(sinceFor([{ level: "pass", reportedAt: "2026-06-10T00:00:00.000Z" }])).toBeNull();
  });
});

describe("buildControlMatrix", () => {
  it("uses the newest report per repo and groups each check by family + subject", () => {
    const m = buildControlMatrix([
      report({ id: "old", reportedAt: "2026-06-01T00:00:00.000Z" }),
      report({
        id: "new",
        reportedAt: "2026-06-10T00:00:00.000Z",
        findings: [{ check: "control.prepush.lint", level: "fail", message: "not wired" }],
      }),
    ]);
    expect(m.rows).toHaveLength(1);
    const row = m.rows[0]!;
    expect(row.reportedAt).toBe("2026-06-10T00:00:00.000Z");
    expect(row.checks).toEqual([
      {
        check: "control.prepush.lint",
        family: "control",
        subject: "lint",
        level: "fail",
        since: "2026-06-10T00:00:00.000Z",
        message: "not wired",
      },
    ]);
    expect(m.totals["control.prepush.lint"]).toEqual({ pass: 0, warn: 0, fail: 1, unchecked: 0, repos: 1 });
  });

  it("a summary-only report yields NO green cells — an old reporter is not a clean one", () => {
    const m = buildControlMatrix([report({ summaryOnly: true, findings: [] })]);
    expect(m.rows[0]!.summaryOnly).toBe(true);
    expect(m.rows[0]!.checks).toEqual([]);
    expect(m.checks).toEqual([]);
    // Nothing is counted for it either: it contributes to no per-check total.
    expect(m.totals).toEqual({});
  });

  it("counts each check across repos without letting an unreported check read as a pass", () => {
    const m = buildControlMatrix([
      report({ repoFullName: "acme/a" }),
      report({ repoFullName: "acme/b", findings: [{ check: "control.prepush.lint", level: "warn", message: "" }] }),
    ]);
    expect(m.totals["control.prepush.lint"]).toEqual({ pass: 1, warn: 1, fail: 0, unchecked: 0, repos: 2 });
    // acme/b never reported guardrail.never-commit, so its column counts ONE repo, not two.
    expect(m.totals["guardrail.never-commit"]!.repos).toBe(1);
  });
});

describe("detectControlRegressions", () => {
  const withFindings = (level: "pass" | "warn" | "fail" | "unchecked", id = "n") =>
    report({ id, findings: [{ check: "control.prepush.scan-secrets", level, message: "" }] });

  it("fires on pass→fail and warn→fail", () => {
    expect(detectControlRegressions(withFindings("pass", "p"), withFindings("fail"))).toEqual([
      { check: "control.prepush.scan-secrets", from: "pass", to: "fail" },
    ]);
    expect(detectControlRegressions(withFindings("warn", "p"), withFindings("fail"))).toHaveLength(1);
  });

  it("does NOT fire on unchecked→fail: an environment that started checking has not regressed", () => {
    expect(detectControlRegressions(withFindings("unchecked", "p"), withFindings("fail"))).toEqual([]);
  });

  it("does not fire on a brand-new check, on a non-fail, or across a summary-only report", () => {
    expect(detectControlRegressions(report({ findings: [] }), withFindings("fail"))).toEqual([]);
    expect(detectControlRegressions(withFindings("pass", "p"), withFindings("warn"))).toEqual([]);
    expect(detectControlRegressions(null, withFindings("fail"))).toEqual([]);
    expect(detectControlRegressions(report({ summaryOnly: true }), withFindings("fail"))).toEqual([]);
  });
});
