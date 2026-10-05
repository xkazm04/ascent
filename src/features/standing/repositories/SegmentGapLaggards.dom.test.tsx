// @vitest-environment jsdom
//
// The gap, made actionable — and the two honesty rules that bound the action.
//
// WATCHED vs TAGGED: POST /api/org/scan intersects its request with the watch list (repositories-segments
// #2, the rule SegmentActions states in its button label), so a Rescan offered on a tagged-but-unwatched
// repo would promise a scan the route drops. Here that decides whether the control is rendered at all.
// NOT SCORED is not ZERO: a repo whose latest scan carries no row for the dimension is listed under its
// own heading with no number, never ranked at 0 at the top of a worst-first list.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// RepoRescanButton is a client island that calls useRouter; the app router is not mounted under jsdom.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SegmentGapLaggards } from "./SegmentGapLaggards";
import { distributionRows } from "./segmentViz";
import type { SegmentComparison, SegmentSummary } from "@/lib/db";

const pt = (fullName: string, overall: number, dims: Record<string, number>) => ({
  fullName,
  overall,
  dims: Object.entries(dims).map(([dimId, score]) => ({ dimId, score })),
});

const side = (name: string, points: ReturnType<typeof pt>[], mean: number | null): SegmentSummary =>
  ({
    id: name,
    name,
    repoCount: points.length,
    scannedCount: points.length,
    avgOverall: mean,
    avgAdoption: 55,
    avgRigor: 65,
    posture: mean === null ? null : "balanced",
    dimAverages: [],
    points,
  }) as SegmentSummary;

// d5: Platform means 40 (30, 50, and one repo with no d5 row), Legacy means 72.
const A = side("Platform", [pt("acme/a-one", 40, { d5: 30 }), pt("acme/a-two", 60, { d5: 50 }), pt("acme/a-three", 80, {})], 60);
const B = side("Legacy", [pt("acme/b-one", 70, { d5: 64 }), pt("acme/b-two", 90, { d5: 80 })], 80);

const d5Row = () =>
  distributionRows(
    { a: A, b: B, deltas: { overall: -20, adoption: null, rigor: null }, dimDeltas: [{ dimId: "d5", a: 40, b: 72, delta: -32 }] } as SegmentComparison,
    (d) => d.toUpperCase(),
  )[1]!;

const watchedAll = new Set(["acme/a-one", "acme/a-two", "acme/a-three"]);

describe("SegmentGapLaggards", () => {
  it("names the trailing side's repos worst-first, each with its OWN score on that dimension", () => {
    const { container } = render(
      <SegmentGapLaggards org="acme" side={d5Row().a} metricLabel="D5" watched={watchedAll} schedulable />,
    );
    const names = [...container.querySelectorAll("[data-laggard]")].map((li) => li.getAttribute("data-laggard"));
    expect(names).toEqual(["acme/a-one", "acme/a-two"]); // 30 before 50
    expect(screen.getByText("30")).toBeTruthy();
    expect(screen.getByText("50")).toBeTruthy();
    // Each row is a way INTO the repo, not just a label.
    expect(screen.getByRole("link", { name: "acme/a-one" }).getAttribute("href")).toBe("/report/acme/a-one");
  });

  it("a repo with no row for the dimension is listed as NOT SCORED and never rendered as a 0", () => {
    const { container } = render(
      <SegmentGapLaggards org="acme" side={d5Row().a} metricLabel="D5" watched={watchedAll} schedulable />,
    );
    expect(screen.getByText("not scored on this dimension")).toBeTruthy();
    expect(container.querySelector('[data-unscored="acme/a-three"]')).toBeTruthy();
    // It is NOT in the ranked list, and no 0 was printed anywhere.
    expect(container.querySelector('[data-laggard="acme/a-three"]')).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
    // It still gets a report link: unscored is a repo to go look at, not a row to hide.
    expect(screen.getByRole("link", { name: "acme/a-three" })).toBeTruthy();
  });

  it("offers Rescan for a WATCHED repo and the report link only for a tagged-but-unwatched one", () => {
    render(
      <SegmentGapLaggards org="acme" side={d5Row().a} metricLabel="D5" watched={new Set(["acme/a-one"])} schedulable />,
    );
    // The watched repo gets the existing one-click control (RepoRescanButton), by its own accessible name.
    expect(screen.getByRole("button", { name: "Rescan acme/a-one" })).toBeTruthy();
    // The unwatched one gets no scan control at all — the route would drop the request.
    expect(screen.queryByRole("button", { name: "Rescan acme/a-two" })).toBeNull();
    expect(screen.getByRole("link", { name: "acme/a-two" })).toBeTruthy();
    expect(screen.getByText("tagged, not watched")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the leaderboard's GitHub-App gate rather than minting a second scan path", () => {
    render(<SegmentGapLaggards org="acme" side={d5Row().a} metricLabel="D5" watched={watchedAll} schedulable={false} />);
    const btn = screen.getByRole("button", { name: "Rescan acme/a-one" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getAllByText("Rescanning requires the GitHub App.").length).toBeGreaterThan(0);
  });

  it("states that the list is a head when the side is longer than it shows", () => {
    const wide = side(
      "Wide",
      Array.from({ length: 9 }, (_, i) => pt(`acme/r${i}`, 50, { d5: i * 5 })),
      50,
    );
    const row = distributionRows(
      { a: wide, b: B, deltas: { overall: null, adoption: null, rigor: null }, dimDeltas: [{ dimId: "d5", a: 20, b: 72, delta: -52 }] } as SegmentComparison,
      (d) => d,
    )[1]!;
    const { container } = render(<SegmentGapLaggards org="acme" side={row.a} metricLabel="d5" watched={new Set()} schedulable />);
    expect(container.querySelectorAll("[data-laggard]")).toHaveLength(5);
    expect(screen.getByText(/weakest on d5 \(5 of 9\)/)).toBeTruthy();
  });

  it("a side with nothing measured on the metric says so instead of rendering an empty list", () => {
    const bare = side("Bare", [], null);
    const row = distributionRows(
      { a: bare, b: B, deltas: { overall: null, adoption: null, rigor: null }, dimDeltas: [{ dimId: "d5", a: null, b: 72, delta: null }] } as SegmentComparison,
      (d) => d,
    )[1]!;
    render(<SegmentGapLaggards org="acme" side={row.a} metricLabel="d5" watched={new Set()} schedulable />);
    expect(screen.getByText("Bare has no repo scored on d5.")).toBeTruthy();
  });
});
