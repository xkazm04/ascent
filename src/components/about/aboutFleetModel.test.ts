// /about X-Ray + ROI panes over the real scanned public fleet (card about-1, MC-B6 ceiling). The model is
// pure: the server page fetches the cached public gallery, this reduces it, and the client panes render.
// Registry: public-claim-provenance / degraded-never-claims-live - below LIVE_MIN current-rubric repos the
// panes stay the labelled illustration, never a padded live count.

import { describe, it, expect } from "vitest";
import { projectedGain } from "@/lib/scoring/projections";
import { overallScoreFor } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import { LIVE_MIN, fleetCaption, fleetFrom, projectFleet } from "./aboutFleetModel";
import { galleryOf as gallery, liveCard as card } from "./aboutFleet.fixture";

const twelve = Array.from({ length: 12 }, (_, i) => card(i));

describe("fleetFrom - live only on a real, current corpus", () => {
  it("null gallery -> the 40-cell illustration", () => {
    const f = fleetFrom(null);
    expect(f.mode).toBe("illustrative");
    expect(f.cells).toHaveLength(40);
    expect(fleetCaption({ mode: f.mode, n: f.cells.length, newest: f.newest })).toBe(
      "Illustrative · 40 sample repos, not customer data",
    );
  });

  it("12 current-rubric cards -> live, one cell per card carrying the card's own facts", () => {
    const f = fleetFrom(gallery(twelve));
    expect(f.mode).toBe("live");
    expect(f.cells).toHaveLength(12);
    f.cells.forEach((c, i) =>
      expect(c).toEqual({
        name: twelve[i]!.fullName,
        score: twelve[i]!.overall,
        segment: twelve[i]!.posture,
        href: twelve[i]!.href,
      }),
    );
    expect(f.newest).toBe("2026-10-21T08:00:00.000Z");
  });

  it("fewer than LIVE_MIN current cards never claims live", () => {
    expect(LIVE_MIN).toBe(6);
    expect(fleetFrom(gallery(twelve.slice(0, LIVE_MIN - 1))).mode).toBe("illustrative");
  });

  it("stale-rubric cards are excluded BEFORE the threshold is applied", () => {
    const mixed = [
      ...twelve.slice(0, LIVE_MIN - 1),
      ...twelve.slice(6).map((c) => ({ ...c, currentRubric: false })),
    ];
    expect(mixed.length).toBeGreaterThanOrEqual(LIVE_MIN);
    expect(fleetFrom(gallery(mixed)).mode).toBe("illustrative");
    const live = fleetFrom(gallery([...twelve.slice(0, 6), { ...twelve[7]!, currentRubric: false }]));
    expect(live.mode).toBe("live");
    expect(live.cells.map((c) => c.name)).not.toContain(twelve[7]!.fullName);
  });

  it("live segments are the postures present in the data, in the model's order", () => {
    const f = fleetFrom(gallery(twelve.map((c) => ({ ...c, posture: c.posture === "manual" ? "ai-native" : c.posture }))));
    expect(f.segments.map((s) => s.id)).toEqual(["ai-native", "ungoverned"]);
    expect(f.segments[0]!.label).toBe("AI-Native");
  });
});

describe("projectFleet - the engine's weighting, never a demo constant", () => {
  it("no targets -> next === base === card.overall, zero promotions and zero gain", () => {
    const p = projectFleet(twelve, {});
    p.rows.forEach((r, i) => {
      expect(r.base).toBe(twelve[i]!.overall);
      expect(r.next).toBe(r.base);
      expect(r.promoted).toBe(false);
    });
    expect(p.promotions).toBe(0);
    expect(p.avgGain).toBe(0);
    expect(p.affected).toBe(0);
  });

  it("{ D2: 100 } agrees with projectedGain row for row (the backlog's '+N pts · unlocks LX')", () => {
    const p = projectFleet(twelve, { D2: 100 });
    twelve.forEach((c, i) => {
      const dims = Object.entries(c.dimensions).map(([id, score]) => ({ id, score: score! }));
      const g = projectedGain(dims, c.archetype, "D2");
      expect(p.rows[i]!.next).toBe(c.overall + g.points);
      expect(p.rows[i]!.promoted).toBe(g.unlocks !== null);
    });
    expect(p.rows.some((r) => r.next > r.base)).toBe(true);
  });

  it("a target below the current score never lowers it", () => {
    const p = projectFleet(twelve, { D2: 0, D3: 0, D1: 0 });
    for (const r of p.rows) expect(r.next).toBe(r.base);
  });

  it("an unknown archetype weighs like the org lens (weightsFor's fallback), never a throw", () => {
    const c = card(1, { archetype: "library" });
    const scored = Object.entries(c.dimensions).map(([id, score]) => ({ id: id as DimensionId, score: score! }));
    const p = projectFleet([{ ...c, overall: overallScoreFor(scored, "org") }], { D2: 100 });
    const raised = scored.map((d) => (d.id === "D2" ? { ...d, score: 100 } : d));
    expect(p.rows[0]!.next).toBe(overallScoreFor(raised, "org"));
  });
});

describe("fleetCaption", () => {
  it("live names the corpus and its freshness, with no demo or not-customer-data wording", () => {
    const text = fleetCaption({ mode: "live", n: 12, newest: "2026-10-20T09:30:00.000Z" });
    expect(text).toBe("Live · 12 public repos scanned by Ascent · newest 2026-10-20");
    expect(text).not.toMatch(/demo weighting|not customer data/i);
    expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
