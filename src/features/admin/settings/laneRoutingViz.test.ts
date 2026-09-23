// The words and marks of the lane-routing card (llm-provider-abstraction#B, challenge-2026-09-23):
// the "N of 5" summary, the per-state cell labels, and the "moves" diff between now and a preview.

import { describe, it, expect } from "vitest";
import { routeLanes, type LaneFacts } from "@/lib/llm/lane-routes";
import { laneCell, laneRoutingView, laneSummaryLine } from "./laneRoutingViz";

const GEMINI = { engine: "gemini", model: "gemini-3.8-flash" } as const;
const OPENROUTER = { state: "active", kind: "openrouter", model: "anthropic/claude-sonnet-4" } as const;
const facts = (over: Partial<LaneFacts> = {}): LaneFacts => ({
  byom: { state: "inactive" },
  platform: { scan: GEMINI, text: GEMINI },
  briefingEnabled: true,
  ...over,
});
const row = (rows: ReturnType<typeof routeLanes>, lane: string) => rows.find((r) => r.lane === lane)!;

describe("laneSummaryLine", () => {
  it("reads '3 of 5 lanes run on your provider' under an active OpenRouter BYOM", () => {
    expect(laneSummaryLine(routeLanes(facts({ byom: OPENROUTER })))).toBe("3 of 5 lanes run on your provider");
  });

  it("names the platform when no BYOM is on, and the blocked lanes when it cannot be resolved", () => {
    expect(laneSummaryLine(routeLanes(facts()))).toBe("5 of 5 lanes run on the platform provider");
    expect(laneSummaryLine(routeLanes(facts({ byom: { state: "unresolvable" } })))).toMatch(/^2 of 5 lanes blocked/);
  });
});

describe("laneCell", () => {
  it("labels the no-engine floors by what each lane falls back to, and a mock scan as deterministic", () => {
    const rows = routeLanes(facts({ platform: { scan: { engine: "mock", model: "deterministic-rubric" }, text: null } }));
    expect(laneCell(row(rows, "memory")).text).toBe("No engine: deterministic heuristic");
    expect(laneCell(row(rows, "laneSummary")).text).toBe("No engine: derived list kept");
    expect(laneCell(row(rows, "scans")).text).toBe("mock (deterministic)");
  });

  it("labels the briefing switch, the fail-closed lanes, and a running engine with whose account", () => {
    expect(laneCell(row(routeLanes(facts({ briefingEnabled: false })), "briefing")).text).toBe(
      "Off: BRIEFING_NARRATIVE unset, template paragraph",
    );
    const blocked = routeLanes(facts({ byom: { state: "unresolvable" } }));
    expect(laneCell(row(blocked, "scans")).text).toBe("Blocked: fails closed, no platform fallback");
    expect(laneCell(row(blocked, "briefing")).text).toBe("Template paragraph: your provider cannot be resolved");
    const on = laneCell(row(routeLanes(facts({ byom: OPENROUTER })), "athena"));
    expect(on).toMatchObject({ text: "openrouter", model: "anthropic/claude-sonnet-4", account: "Your account" });
  });
});

describe("laneRoutingView", () => {
  it("with a preview, marks exactly scans, athena and briefing as moving, and flags the two that stay", () => {
    const view = laneRoutingView({ current: routeLanes(facts()), preview: routeLanes(facts({ byom: OPENROUTER })) });
    expect(view.rows.filter((r) => r.moves).map((r) => r.lane)).toEqual(["scans", "athena", "briefing"]);
    expect(view.rows.filter((r) => r.bypassesByom).map((r) => r.lane)).toEqual(["memory", "laneSummary"]);
    expect(view.previewSummary).toBe("3 of 5 lanes run on your provider");
  });

  it("with no preview there is no second column and nothing moves", () => {
    const view = laneRoutingView({ current: routeLanes(facts()), preview: null });
    expect(view.rows.every((r) => r.next === null && !r.moves)).toBe(true);
    expect(view.previewSummary).toBeNull();
  });
});
