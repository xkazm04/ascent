// Sweep door: a BYOM credential resolution failure still falls to the deterministic template (never
// retrying on the platform provider: that is the fail-closed design) but is no longer swallowed unseen.

import { describe, it, expect, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
const boom = new Error("byom credentials unresolvable");
vi.mock("@/lib/llm/text-org", () => ({ resolveTextRunnerForOrg: async () => { throw boom; } }));

import { writeBriefingNarrative } from "./briefing-narrative";
import type { ExecBriefing } from "./briefing";

describe("narrative runner resolution", () => {
  it("falls back to the template, warns, and reports", async () => {
    vi.stubEnv("BRIEFING_NARRATIVE", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const b = {
      org: "acme", periodTitle: "p", generatedOn: "2026-10-01",
      maturity: { overall: 60, levelId: "L3", levelName: "Managed", adoption: 50, rigor: 55 },
      coverage: { scanned: 1, total: 1 }, realScoredCount: 1, mockCount: 0, engineMix: [], movement: { up: 0, down: 0, compared: 0 },
      valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
      benchmark: null, strengths: [], risks: [], security: null, topGainers: [], topRegressions: [], goals: [], recommendations: [],
    } as unknown as ExecBriefing;
    const text = await writeBriefingNarrative(b);
    expect(text.length).toBeGreaterThan(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("narrative runner resolution");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
    vi.unstubAllEnvs();
  });
});
