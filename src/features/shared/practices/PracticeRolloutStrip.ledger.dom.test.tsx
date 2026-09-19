// @vitest-environment jsdom
//
// What the rollout library absorbed from the retired PracticeLedger (2026-09-16): every practice (no
// cap of eight), grouped by dimension, the counts column beside the stage cells, the Authored/Mined
// source, a row that opens the practice, and a source filter.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { OrgPractice } from "@/lib/db";
import type { PracticeRollout } from "./practiceRows";
import { buildPracticeRows } from "./practiceRows";
import { groupReadout, rolloutGroups } from "./practiceRolloutGroups";

const { PracticeRolloutStrip } = await import("./PracticeRolloutStrip");

const practice = (id: string, dimId: string, over: Partial<OrgPractice> = {}): OrgPractice => ({
  id,
  label: `Practice ${id}`,
  dimId,
  what: `What ${id} does`,
  starter: [],
  total: 10,
  strongCount: 5,
  exemplar: null,
  gapRepos: [],
  gapRepoRefs: [],
  ...over,
});

const EMPTY: PracticeRollout = {
  playbooksAdopted: 0,
  adoptingRepos: 0,
  playbookLift: null,
  playbookMeasured: 0,
  prsOpen: 0,
  prsMerged: 0,
  practiceLift: null,
  practiceLiftSources: 0,
};

const playbook = { id: "pb1", title: "Review rota", dimId: "D6", summary: "Two reviewers on every PR" } as never;

function rows() {
  const mined = Array.from({ length: 10 }, (_, i) => practice(`p${i}`, i % 2 === 0 ? "D3" : "D1"));
  mined[0] = practice("p0", "D3", { prs: { open: 2, merged: 1, lift: 4 }, gapRepos: ["a", "b"], exemplar: { name: "x", fullName: "o/x", score: 90 } });
  mined[1] = practice("p1", "D1", { total: 0, strongCount: 0 });
  return buildPracticeRows(mined, [playbook], { pb1: { repos: 3, appliedRepos: ["o/a", "o/b", "o/c"], lift: null, measured: 0 } }, 20);
}

describe("PracticeRolloutStrip — the merged ledger", () => {
  it("lists every practice, grouped by dimension in D-order", () => {
    const { container } = render(<PracticeRolloutStrip rollout={EMPTY} rows={rows()} fleetSize={20} />);
    expect(container.querySelectorAll("[data-row]")).toHaveLength(11);
    expect([...container.querySelectorAll("[data-group]")].map((g) => g.getAttribute("data-group"))).toEqual(["D1", "D3", "D6"]);
    expect(screen.getByText("11 practices · 20 repos")).toBeTruthy();
  });

  it("carries the ledger's facts beside the stage cells: description, source, counts and motion", () => {
    const { container } = render(<PracticeRolloutStrip rollout={EMPTY} rows={rows()} fleetSize={20} />);
    const row = container.querySelector('[data-row="mined:p0"]') as HTMLElement;
    expect(within(row).getByText("What p0 does")).toBeTruthy();
    expect(within(row).getByText("Mined")).toBeTruthy();
    expect(within(row).getByText("5/10")).toBeTruthy();
    expect(within(row).getByText("2 could adopt")).toBeTruthy();
    expect(within(row).getByText("2 in flight")).toBeTruthy();
    expect(within(row).getByText("1 landed")).toBeTruthy();
    expect(within(container.querySelector('[data-row="authored:pb1"]') as HTMLElement).getByText("Authored")).toBeTruthy();
    // A never-assessed practice says so in words, never "0/0".
    expect(within(container.querySelector('[data-row="mined:p1"]') as HTMLElement).getByText("not assessed")).toBeTruthy();
  });

  it("opens the practice from its row, and anchors mined rows for the deep links", () => {
    const onOpen = vi.fn();
    const { container } = render(<PracticeRolloutStrip rollout={EMPTY} rows={rows()} fleetSize={20} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Practice p0" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0].key).toBe("mined:p0");
    expect(container.querySelector("#practice-p0")).not.toBeNull();
    expect(container.querySelector('[data-row="authored:pb1"]')!.id).toBe("");
  });

  it("filters by source without losing the grouping", () => {
    const { container } = render(<PracticeRolloutStrip rollout={EMPTY} rows={rows()} fleetSize={20} />);
    fireEvent.click(screen.getByRole("button", { name: "Authored" }));
    expect(container.querySelectorAll("[data-row]")).toHaveLength(1);
    expect(screen.getByText("1 of 11 practices · 20 repos")).toBeTruthy();
  });

  it("names every stage cell for assistive tech, including the ones that print nothing", () => {
    render(<PracticeRolloutStrip rollout={EMPTY} rows={rows()} fleetSize={20} />);
    expect(screen.getByRole("img", { name: "Practice p1 — Assessed: Not judged" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Practice p2 — Adopted: Measured 50" })).toBeTruthy();
  });
});

describe("rolloutGroups", () => {
  it("averages only MEASURED adoption, never a declared application", () => {
    const groups = rolloutGroups(rows(), 20);
    const d1 = groups.find((g) => g.dimId === "D1")!;
    expect(d1.assessed).toBe(4); // p1 was never assessed, so it backs nothing
    expect(d1.adopted).toBe(50);
    const d6 = groups.find((g) => g.dimId === "D6")!;
    expect(d6.adopted).toBeNull();
    expect(groupReadout(d6)).toBe("1 practice");
    expect(groupReadout(d1)).toBe("5 practices · 50% adopted across 4 assessed");
  });
});
