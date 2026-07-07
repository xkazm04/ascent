// OTLP/JSON metrics mapping (Claude Code telemetry push path). Pins the git-URL → owner/name extraction
// and that a realistic ExportMetricsServiceRequest folds into one measured record per (repo, day) with
// tokens summed, cost → cents, sessions counted, and seats = distinct users. A resource with no
// git.repository is dropped (can't attribute to a repo).

import { describe, it, expect } from "vitest";
import { parseOtlpMetrics, repoFromGitAttr, type OtlpMetricsBody } from "./otlp";

const FALLBACK = Date.UTC(2026, 6, 5); // 2026-07-05

describe("repoFromGitAttr", () => {
  it("extracts owner/name from https, ssh, .git, and bare forms", () => {
    expect(repoFromGitAttr("https://github.com/vercel/next.js.git")).toBe("vercel/next.js");
    expect(repoFromGitAttr("git@github.com:vercel/next.js.git")).toBe("vercel/next.js");
    expect(repoFromGitAttr("https://github.com/vercel/next.js")).toBe("vercel/next.js");
    expect(repoFromGitAttr("vercel/next.js")).toBe("vercel/next.js");
  });
  it("returns null for junk / empty", () => {
    expect(repoFromGitAttr(undefined)).toBeNull();
    expect(repoFromGitAttr("not a repo")).toBeNull();
    expect(repoFromGitAttr("")).toBeNull();
  });
});

/** A resource block for `repo`, carrying token+cost+session datapoints at day `dayMs`. */
function resourceMetrics(repo: string, user: string, dayMs: number, tokens: number, costUsd: number, sessions: number) {
  const t = String(dayMs * 1e6); // ms → ns
  return {
    resource: { attributes: [
      { key: "git.repository", value: { stringValue: `https://github.com/${repo}.git` } },
      { key: "user.email", value: { stringValue: user } },
    ] },
    scopeMetrics: [
      { metrics: [
        { name: "claude_code.token.usage", sum: { dataPoints: [{ asInt: String(tokens), timeUnixNano: t }] } },
        { name: "claude_code.cost.usage", sum: { dataPoints: [{ asDouble: costUsd, timeUnixNano: t }] } },
        { name: "claude_code.session.count", sum: { dataPoints: [{ asInt: String(sessions), timeUnixNano: t }] } },
      ] },
    ],
  };
}

describe("parseOtlpMetrics", () => {
  it("folds one repo's datapoints into a measured record (tokens summed, cost→cents, seats=distinct users)", () => {
    const day = Date.UTC(2026, 6, 1);
    const body: OtlpMetricsBody = {
      resourceMetrics: [
        resourceMetrics("vercel/next.js", "a@ex.com", day, 12000, 3.5, 2),
        resourceMetrics("vercel/next.js", "b@ex.com", day, 8000, 1.25, 1), // same repo+day, different user
      ],
    };

    const recs = parseOtlpMetrics(body, FALLBACK);
    expect(recs).toHaveLength(1);
    const r = recs[0]!;
    expect(r.source).toBe("claude-code");
    expect(r.scope).toBe("repo");
    expect(r.scopeKey).toBe("vercel/next.js");
    expect(r.fidelity).toBe("measured");
    expect(r.tokens).toBe(20000); // 12000 + 8000
    expect(r.costCents).toBe(475); // (3.5 + 1.25) * 100
    expect(r.sessions).toBe(3); // 2 + 1
    expect(r.seats).toBe(2); // distinct users a@, b@
    expect(r.periodStart.getTime()).toBe(day);
  });

  it("separates records by repo and by day", () => {
    const d1 = Date.UTC(2026, 6, 1);
    const d2 = Date.UTC(2026, 6, 2);
    const body: OtlpMetricsBody = {
      resourceMetrics: [
        resourceMetrics("vercel/next.js", "a@ex.com", d1, 1000, 1, 1),
        resourceMetrics("vercel/next.js", "a@ex.com", d2, 2000, 2, 1),
        resourceMetrics("vercel/turbo", "a@ex.com", d1, 500, 0.5, 1),
      ],
    };
    const recs = parseOtlpMetrics(body, FALLBACK);
    expect(recs).toHaveLength(3);
    expect(recs.filter((r) => r.scopeKey === "vercel/next.js")).toHaveLength(2);
  });

  it("drops resources with no git.repository (can't attribute to a repo)", () => {
    const body: OtlpMetricsBody = {
      resourceMetrics: [
        { resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] },
          scopeMetrics: [{ metrics: [{ name: "claude_code.token.usage", sum: { dataPoints: [{ asInt: "999" }] } }] }] },
      ],
    };
    expect(parseOtlpMetrics(body, FALLBACK)).toEqual([]);
  });

  it("uses fallbackMs when a datapoint has no timestamp, bucketed to that UTC day", () => {
    const body: OtlpMetricsBody = {
      resourceMetrics: [
        { resource: { attributes: [{ key: "git.repository", value: { stringValue: "vercel/next.js" } }] },
          scopeMetrics: [{ metrics: [{ name: "claude_code.cost.usage", sum: { dataPoints: [{ asDouble: 2 }] } }] }] },
      ],
    };
    const recs = parseOtlpMetrics(body, FALLBACK);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.periodStart.getTime()).toBe(FALLBACK);
    expect(recs[0]!.costCents).toBe(200);
  });

  it("never throws on empty / malformed bodies", () => {
    expect(parseOtlpMetrics({}, FALLBACK)).toEqual([]);
    expect(parseOtlpMetrics({ resourceMetrics: [] }, FALLBACK)).toEqual([]);
    expect(parseOtlpMetrics({ resourceMetrics: [{}] }, FALLBACK)).toEqual([]);
  });
});
