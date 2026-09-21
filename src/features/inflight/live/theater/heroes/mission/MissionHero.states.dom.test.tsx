// @vitest-environment jsdom
//
// The Mission hero's honest end states: reduced motion and a frozen (stale) clock render the final
// frame and nothing moves; a quiet lane LOOKS quiet; paused / idle / no-runner slots say so in words and
// never render an empty frame; paused repos surface as rows with their reason.

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LoopPulse } from "@/lib/local/runner-types";
import { DEMO_EPOCH, fixtureLane, fixturePulse, fixturePulseAt, fixtureRunner } from "../../theaterFixture";
import { MissionHero } from "../MissionHero";

const at = (s: number) => DEMO_EPOCH + s * 1000;
const iso = (ms: number) => new Date(ms).toISOString();
const hero = (pulse: LoopPulse, now: number, reducedMotion = false) => <MissionHero pulse={pulse} now={now} reducedMotion={reducedMotion} />;

describe("MissionHero — end states", () => {
  it("reduced motion: every figure at its true value, no entrance start state, no transitions", () => {
    const { container, rerender } = render(hero(fixturePulseAt(at(40)), at(40), true));
    rerender(hero(fixturePulseAt(at(58)), at(58), true));
    // Content-bearing degradation: the chips that arrived are simply there, fully drawn.
    const chips = [...container.querySelectorAll<HTMLElement>("[data-chip]")];
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c.style.transform === "" || c.style.transform === "none").toBe(true);
    const fill = container.querySelector<SVGElement>("[data-ring-fill]")!;
    expect(fill.getAttribute("style") ?? "").not.toMatch(/transition/);
    expect(container.querySelector(".animate-fade-up")).toBeNull();
  });

  it("a stale pulse (frozen clock) renders the same frame twice — nothing pretends to move", () => {
    const pulse = fixturePulseAt(at(95));
    const { container, rerender } = render(hero(pulse, at(97), true));
    const before = container.innerHTML;
    rerender(hero(pulse, at(97), true));
    expect(container.innerHTML).toBe(before);
    expect(screen.getByRole("list", { name: "Summary" })).toHaveTextContent("1:37 of 4:00 used");
  });

  it("a quiet lane looks quiet: grey phase word, the silence in words, no activity glow", () => {
    const now = at(600);
    const lane = fixtureLane({
      phase: "agent-quiet",
      startedAt: iso(at(300)),
      deadlineAt: iso(at(1800)),
      phaseSince: iso(at(320)),
      heartbeatAt: iso(at(360)),
      tail: [{ at: iso(at(360)), kind: "read", path: "src/a.ts", tool: "Read", note: null }],
    });
    const { container } = render(hero(fixturePulse({ at: iso(now), lanes: [lane] }), now));
    const band = container.querySelector<HTMLElement>("[data-lane]")!;
    expect(band).toHaveAttribute("data-quiet", "true");
    expect(within(band).getByText("Still working")).toHaveClass("text-slate-400");
    expect(within(band).getByText("quiet for 4m")).toBeInTheDocument();
  });
});

describe("MissionHero — no lane at work", () => {
  it("paused on the session limit: the reason and when it resumes, never an empty frame", () => {
    const now = at(95);
    render(hero(fixturePulseAt(now, "paused-session"), now));
    const empty = document.querySelector<HTMLElement>("[data-mission-empty]")!;
    expect(within(empty).getByText("No lane at work")).toBeInTheDocument();
    expect(within(empty).getByText(/Paused on the session limit/)).toBeInTheDocument();
    expect(within(empty).getByText(/resumes · in 2 h/)).toBeInTheDocument();
  });

  it("idle: the resting repo is a row with its wake time and what waits to merge", () => {
    const now = at(95);
    render(hero(fixturePulseAt(now, "idle"), now));
    const rows = screen.getByRole("list", { name: "The rest of the fleet" });
    expect(within(rows).getByText("kp")).toBeInTheDocument();
    expect(within(rows).getByText(/Resting after 2 dry runs · wakes/)).toBeInTheDocument();
    expect(within(rows).getByText("3 commits to merge")).toBeInTheDocument();
  });

  it("a finished lane past its Landed moment clears from a band to a row", () => {
    const now = at(600);
    const lane = fixtureLane({ phase: "done", startedAt: iso(at(300)), tail: [] });
    const latest = [{ at: iso(at(540)), repo: lane.repo, kind: "landed" as const, headline: "kp landed 2 fixes" }];
    render(hero(fixturePulse({ at: iso(now), lanes: [lane], latest }), now));
    expect(document.querySelector("[data-lane]")).toBeNull();
    const row = document.querySelector<HTMLElement>(`[data-row="lane:${lane.laneId}"]`)!;
    expect(within(row).getByText(/^Landed · \d\d:\d\d$/)).toHaveClass("text-success-soft");
    expect(within(row).getByText("kp landed 2 fixes")).toBeInTheDocument();
  });

  it("no runner: says so", () => {
    render(hero(fixturePulseAt(at(95), "none"), at(95)));
    expect(screen.getByText("No runner is reporting")).toBeInTheDocument();
  });

  it("a paused repo shows its reason and note in amber", () => {
    const runner = fixtureRunner({
      repos: [{ repo: "acme/api", baseBranch: "main", paused: "branch-conflict", pausedUntil: null, note: "src/app.ts conflicts", failureStreak: 0, dryStreak: 0, lastMergeInSha: null, lastLandedSha: null, aheadOfBase: null }],
    });
    render(hero(fixturePulse({ runner }), DEMO_EPOCH));
    const row = document.querySelector<HTMLElement>('[data-row="paused:acme/api"]')!;
    expect(within(row).getByText("Paused — the runner branch conflicts with its base")).toHaveClass("text-amber-300");
    expect(within(row).getByText("src/app.ts conflicts")).toBeInTheDocument();
  });
});
