// OTLP/JSON metrics mapping (Claude Code telemetry push path). Pins the git-URL → owner/name extraction
// and that a realistic ExportMetricsServiceRequest folds into one measured record per (repo, day) with
// tokens summed, cost → cents, sessions counted, and seats = distinct users. A resource with no
// git.repository is dropped (can't attribute to a repo).

import { describe, it, expect } from "vitest";
import { parseOtlpMetrics, repoFromGitAttr, resolveGitRepo, type OtlpMetricsBody } from "./otlp";

/** parseOtlpMetrics now reports skips alongside the records; most cases only care about the records. */
const recordsOf = (body: OtlpMetricsBody, fallback: number) => parseOtlpMetrics(body, fallback).records;

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

    const recs = recordsOf(body, FALLBACK);
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
    const recs = recordsOf(body, FALLBACK);
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
    expect(recordsOf(body, FALLBACK)).toEqual([]);
  });

  it("uses fallbackMs when a datapoint has no timestamp, bucketed to that UTC day", () => {
    const body: OtlpMetricsBody = {
      resourceMetrics: [
        { resource: { attributes: [{ key: "git.repository", value: { stringValue: "vercel/next.js" } }] },
          scopeMetrics: [{ metrics: [{ name: "claude_code.cost.usage", sum: { dataPoints: [{ asDouble: 2 }] } }] }] },
      ],
    };
    const recs = recordsOf(body, FALLBACK);
    expect(recs).toHaveLength(1);
    expect(recs[0]!.periodStart.getTime()).toBe(FALLBACK);
    expect(recs[0]!.costCents).toBe(200);
  });

  it("never throws on empty / malformed bodies", () => {
    expect(recordsOf({}, FALLBACK)).toEqual([]);
    expect(recordsOf({ resourceMetrics: [] }, FALLBACK)).toEqual([]);
    expect(recordsOf({ resourceMetrics: [{}] }, FALLBACK)).toEqual([]);
  });
});

describe("resolveGitRepo — non-GitHub remotes are reported, never silently dropped", () => {
  it("resolves GitHub remotes and bare owner/name", () => {
    expect(resolveGitRepo("https://github.com/vercel/next.js.git")).toEqual({ repo: "vercel/next.js" });
    expect(resolveGitRepo("vercel/next.js")).toEqual({ repo: "vercel/next.js" });
  });

  it("names the unsupported host for a GitLab / Bitbucket / self-hosted remote", () => {
    expect(resolveGitRepo("https://gitlab.com/group/proj.git")).toEqual({ reason: "unsupported-host", host: "gitlab.com" });
    expect(resolveGitRepo("git@bitbucket.org:team/repo.git")).toEqual({ reason: "unsupported-host", host: "bitbucket.org" });
    expect(resolveGitRepo("ssh://git@git.internal.acme.dev:2222/platform/api.git")).toMatchObject({
      reason: "unsupported-host",
      host: "git.internal.acme.dev",
    });
  });

  it("distinguishes 'no attribute at all' from 'a remote we can't map'", () => {
    expect(resolveGitRepo(undefined)).toEqual({ reason: "no-repo-attr", host: "" });
    expect(resolveGitRepo("   ")).toEqual({ reason: "no-repo-attr", host: "" });
    expect(resolveGitRepo("not a repo")).toMatchObject({ reason: "unsupported-host" });
  });
});

describe("parseOtlpMetrics — skip reporting", () => {
  const day = Date.UTC(2026, 6, 1);
  const dp = (n: number) => ({ asInt: String(n), timeUnixNano: String(day * 1e6) });
  const resource = (gitAttr: string | null, metrics: { name: string; count: number }[]) => ({
    resource: { attributes: gitAttr === null ? [] : [{ key: "git.repository", value: { stringValue: gitAttr } }] },
    scopeMetrics: [
      { metrics: metrics.map((m) => ({ name: m.name, sum: { dataPoints: Array.from({ length: m.count }, (_, i) => dp(i + 1)) } })) },
    ],
  });

  it("reports zero skips for a clean export", () => {
    const r = parseOtlpMetrics({ resourceMetrics: [resource("vercel/next.js", [{ name: "claude_code.token.usage", count: 3 }])] }, FALLBACK);
    expect(r.received).toBe(3);
    expect(r.skipped).toEqual({ "unknown-metric": 0, "no-repo-attr": 0, "unsupported-host": 0 });
    expect(r.unsupportedHosts).toEqual([]);
    expect(r.records).toHaveLength(1);
  });

  it("counts datapoints of metrics outside the allowlist (reported, still not stored)", () => {
    const r = parseOtlpMetrics(
      {
        resourceMetrics: [
          resource("vercel/next.js", [
            { name: "claude_code.token.usage", count: 2 },
            { name: "claude_code.lines_of_code.count", count: 4 },
            { name: "some.other.metric", count: 1 },
          ]),
        ],
      },
      FALLBACK,
    );
    expect(r.received).toBe(7);
    expect(r.skipped["unknown-metric"]).toBe(5);
    // Non-goal: widening the allowlist. The value must NOT have been stored.
    expect(r.records[0]!.tokens).toBe(3); // 1 + 2 from the token metric only
  });

  it("counts every datapoint under a resource with no git.repository", () => {
    const r = parseOtlpMetrics({ resourceMetrics: [resource(null, [{ name: "claude_code.token.usage", count: 6 }])] }, FALLBACK);
    expect(r.received).toBe(6);
    expect(r.skipped["no-repo-attr"]).toBe(6);
    expect(r.records).toEqual([]);
  });

  it("counts a non-GitHub remote as unsupported-host and NAMES the host", () => {
    const r = parseOtlpMetrics(
      {
        resourceMetrics: [
          resource("https://gitlab.com/group/proj.git", [{ name: "claude_code.token.usage", count: 4 }]),
          resource("git@bitbucket.org:team/repo.git", [{ name: "claude_code.cost.usage", count: 1 }]),
          resource("vercel/next.js", [{ name: "claude_code.token.usage", count: 2 }]),
        ],
      },
      FALLBACK,
    );
    expect(r.received).toBe(7);
    expect(r.skipped["unsupported-host"]).toBe(5);
    expect(r.unsupportedHosts.sort()).toEqual(["bitbucket.org", "gitlab.com"]);
    expect(r.records).toHaveLength(1); // the GitHub one still lands
  });

  it("received always equals stored-capable + skipped datapoints (no datapoint goes uncounted)", () => {
    const r = parseOtlpMetrics(
      {
        resourceMetrics: [
          resource(null, [{ name: "claude_code.token.usage", count: 3 }]),
          resource("https://gitlab.com/g/p.git", [{ name: "claude_code.token.usage", count: 2 }]),
          resource("vercel/next.js", [
            { name: "claude_code.token.usage", count: 4 },
            { name: "claude_code.unknown", count: 1 },
          ]),
        ],
      },
      FALLBACK,
    );
    const totalSkipped = Object.values(r.skipped).reduce((a, b) => a + b, 0);
    expect(r.received).toBe(10);
    expect(totalSkipped).toBe(6); // 3 no-attr + 2 host + 1 unknown-metric
  });
});
