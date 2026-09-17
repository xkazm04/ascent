// @vitest-environment node
//
// The Integrations catalog is a promise: Available bullets must be facts ingest actually stores.
// FAIL-BEFORE: putting "Per-user sessions, lines, commits, PRs" or "Admin Usage/Cost totals
// (optional, next)" back on the Claude row makes listedBulletsLackingConsumer() non-empty.

import { describe, expect, it } from "vitest";
import { parseOtlpMetrics } from "./otlp";
import { PROVIDERS } from "./providers";

const claude = PROVIDERS.find((p) => p.id === "claude-code")!;

/** Capability copy → the ingest path that persists it. A listed bullet missing from this map lacks a consumer. */
const CLAUDE_AVAILABLE_CONSUMERS: Record<string, "otlp-metrics-repo"> = {
  "Per-repo tokens & cost (OTel git.repository)": "otlp-metrics-repo",
};

function listedBulletsLackingConsumer(capabilities: string[]): string[] {
  return capabilities.filter((c) => !(c in CLAUDE_AVAILABLE_CONSUMERS));
}

describe("Claude Available catalog capabilities", () => {
  it("is the available Claude Code row", () => {
    expect(claude).toBeDefined();
    expect(claude.status).toBe("available");
  });

  it("lists per-repo tokens & cost, which Test+metrics actually store", () => {
    expect(claude.capabilities).toEqual(["Per-repo tokens & cost (OTel git.repository)"]);
  });

  it("does not advertise per-user sessions/lines/commits/PRs or Admin Usage totals", () => {
    const listed = claude.capabilities.join("\n");
    expect(listed).not.toMatch(/Per-user sessions, lines, commits, PRs/);
    expect(listed).not.toMatch(/Admin Usage\/Cost totals/);
  });

  it("has 0 listed bullets without a consumer", () => {
    expect(listedBulletsLackingConsumer(claude.capabilities)).toEqual([]);
  });

  it("otlp metrics persist per-repo tokens and cost from git.repository", () => {
    const recs = parseOtlpMetrics(
      {
        resourceMetrics: [
          {
            resource: { attributes: [{ key: "git.repository", value: { stringValue: "https://github.com/acme/api.git" } }] },
            scopeMetrics: [
              {
                metrics: [
                  { name: "claude_code.token.usage", sum: { dataPoints: [{ asInt: "40" }] } },
                  { name: "claude_code.cost.usage", sum: { dataPoints: [{ asDouble: 1.25 }] } },
                ],
              },
            ],
          },
        ],
      },
      Date.UTC(2026, 8, 1),
    ).records;
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      source: "claude-code",
      scope: "repo",
      scopeKey: "acme/api",
      tokens: 40,
      costCents: 125,
      fidelity: "measured",
    });
  });
});
