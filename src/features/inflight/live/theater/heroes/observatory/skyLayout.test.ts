// The sky's geometry: seats that read (at-work bodies on the ring's ends, labels clear of each other
// and of every body), stable seats that change only when the set does, and a comet tail whose
// particles sit by ORDER, cool by AGE, and never reach the next body behind.

import { describe, expect, it } from "vitest";
import type { LaneActivity } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse } from "../../theaterFixture";
import { emptyMemory, foldPulse, type SeenActivity } from "./skyMemory";
import { skyModel } from "./skyModel";
import { layoutSky, fitPath } from "./skyLayout";
import { inside, overlaps, pointOn, skyFrame } from "./skyEllipse";
import { cometTail, fade, tailRoom } from "./skyTail";
import { seatSignature } from "./useSky";
import { FADE_HALF_LIFE_MS, TAIL_STEP } from "./skyConstants";

const f = skyFrame({ w: 1920, h: 785 });
const iso = (s: number) => new Date(DEMO_EPOCH + s * 1000).toISOString();
const seen = (s: number, kind: LaneActivity["kind"] = "read"): SeenActivity => ({ at: iso(s), kind, path: `f${s}`, tool: null, note: null, key: `k${s}`, fresh: false });

function sky(active: string[], waiting: string[] = []) {
  const lanes = active.map((r) => fixtureLane({ laneId: `lane-${r}`, repo: `acme/${r}` }));
  const p = fixturePulse({ lanes, waiting: waiting.map((w) => `acme/${w}`), latest: [] });
  const model = skyModel(p, foldPulse(emptyMemory(DEMO_EPOCH), p, DEMO_EPOCH), DEMO_EPOCH);
  return { model, layout: layoutSky(f, model) };
}

describe("layoutSky", () => {
  it("seats two lanes at work on opposite ends of the inner ring, labels outward", () => {
    const { layout } = sky(["kp", "systedo"], ["web"]);
    const xs = ["acme/kp", "acme/systedo"].map((r) => pointOn(f, 0, layout.seats.get(r)!.deg).x);
    expect(Math.min(...xs)).toBeLessThan(f.cx);
    expect(Math.max(...xs)).toBeGreaterThan(f.cx);
    for (const l of layout.labels.filter((x) => x.repo !== "acme/web")) {
      const body = pointOn(f, 0, layout.seats.get(l.repo)!.deg);
      expect(l.anchor).toBe(body.x > f.cx ? "start" : "end");
    }
  });

  it("keeps every label inside the sky, clear of every other label and of other bodies", () => {
    const { layout } = sky(["a", "b", "c", "d", "e"], ["w1", "w2", "w3", "w4"]);
    const { labels, seats } = layout;
    for (const l of labels) {
      expect(l.box.x).toBeGreaterThanOrEqual(0);
      expect(l.box.x + l.box.w).toBeLessThanOrEqual(f.w);
      expect(l.box.y + l.box.h).toBeLessThanOrEqual(f.skyH);
    }
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(overlaps(labels[i]!.box, labels[j]!.box)).toBe(false);
    for (const [repo, s] of seats) {
      if (s.ring === 0) continue;
      for (const l of labels.filter((x) => x.repo !== repo)) expect(inside(pointOn(f, s.ring, s.deg), l.box)).toBe(false);
    }
  });

  it("gives a repo the same seat for the same sky, and moves seats only when the set changes", () => {
    const one = sky(["kp", "systedo"], ["web"]).layout.seats;
    expect(seatSignature(sky(["kp", "systedo"], ["web"]).layout.seats)).toBe(seatSignature(one));
    expect(seatSignature(sky(["kp", "systedo", "web"]).layout.seats)).not.toBe(seatSignature(one));
  });

  it("trims a long path from the front, keeping the file name", () => {
    expect(fitPath("src/scoring/claims.ts")).toBe("src/scoring/claims.ts");
    const long = fitPath("packages/web/src/components/cases/CaseForm.tsx");
    expect(long).toMatch(/^…\/.*cases\/CaseForm\.tsx$/);
    expect(long.length).toBeLessThanOrEqual(27);
  });
});

describe("cometTail", () => {
  const now = DEMO_EPOCH + 100_000;

  it("puts the newest event at the head and spaces the rest by order, not age", () => {
    const tail = cometTail(f, 0, 400, [seen(10), seen(90), seen(99, "edit")], "edit", now);
    expect(tail.particles.map((p) => p.key)).toEqual(["k99", "k90", "k10"]);
    expect(tail.particles[0]!.kind).toBe("edit");
    const head = pointOn(f, 0, 0);
    const d = tail.particles.map((p) => Math.hypot(p.x - head.x, p.y - head.y));
    expect(d[0]!).toBeLessThan(d[1]!);
    expect(d[1]!).toBeLessThan(d[2]!);
  });

  it("cools every particle by its age, halving each half-life, and drops the cold ones", () => {
    expect(fade(0)).toBe(1);
    expect(fade(FADE_HALF_LIFE_MS)).toBeCloseTo(0.5);
    const tail = cometTail(f, 0, 400, [seen(-400), seen(40), seen(100)], "read", now);
    expect(tail.particles.map((p) => p.key)).toEqual(["k100", "k40"]);
    expect(tail.particles[1]!.glow).toBeCloseTo(0.5);
    expect(tail.heat).toBe(1);
  });

  it("never reaches the next body behind it", () => {
    const events = Array.from({ length: 28 }, (_, i) => seen(i + 70));
    const room = tailRoom(f, 40, [-40]);
    const tail = cometTail(f, 40, room, events, "read", now);
    expect(tail.particles.length).toBeLessThan(28);
    expect(tail.particles.length).toBeLessThanOrEqual(Math.floor(room / TAIL_STEP) + 1);
    expect(cometTail(f, 0, 0, events, "read", now).particles).toHaveLength(0);
  });
});
