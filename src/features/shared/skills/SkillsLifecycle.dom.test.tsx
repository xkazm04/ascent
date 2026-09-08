// @vitest-environment jsdom
//
// The tab's first sight, pinned in the DOM: the reuse matrix and the use-over-time track render as
// graphics with an accessible equivalent, and the two absences stay visibly different — a hatched
// cell for "this org has never measured a skill event" and a void lane for "nothing was recorded
// since the last use". A picture that lost that difference would be indistinguishable from success.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkillsLifecycle } from "./SkillsLifecycle";
import type { SkillUsage } from "@/lib/org/skill-usage";
import type { SkillRow } from "@/lib/db";

function skill(o: Partial<SkillRow>): SkillRow {
  return {
    id: "s1",
    name: "pr-review",
    description: "",
    content: "",
    category: "workflow",
    tags: [],
    frontmatter: {} as SkillRow["frontmatter"],
    version: 1,
    contentHash: "",
    downloadCount: 2,
    adoptionCount: 1,
    origin: "hosted",
    registryPath: null,
    registryVersion: null,
    createdBy: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...o,
  };
}

function usage(o: Partial<SkillUsage>): SkillUsage {
  return {
    skillId: "s1",
    verdict: "dormant",
    state: "abandoned",
    lastUsedAt: "2026-08-01T00:00:00.000Z",
    lastUsedType: "download",
    daysSinceUse: 38,
    useCount: 2,
    invokes: 0,
    eventCount: 2,
    anchorAt: "2026-07-01T00:00:00.000Z",
    ageDays: 69,
    windowDays: 30,
    ...o,
  } as SkillUsage;
}

describe("SkillsLifecycle", () => {
  it("renders nothing for an empty library — the table's empty state owns that reader", () => {
    const { container } = render(<SkillsLifecycle skills={[]} usage={{}} fleetSize={3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on two graphics, each with a generated accessible name", () => {
    render(<SkillsLifecycle skills={[skill({})]} usage={{ s1: usage({}) }} fleetSize={4} />);
    expect(screen.getByRole("img", { name: /Reuse per skill/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Skill use over time/ })).toBeTruthy();
  });

  it("the silence after a last use is a VOID lane, not a zero-height bar", () => {
    const { container } = render(<SkillsLifecycle skills={[skill({})]} usage={{ s1: usage({}) }} fleetSize={4} />);
    const drawn = [...container.querySelectorAll("[data-segment]")].map((n) => n.getAttribute("data-segment"));
    // The observed span is painted; the silence draws no rect at all — the dotted ground is the mark.
    expect(drawn).toContain("measured");
    expect(drawn).not.toContain("missing");
    expect(container.querySelector("[data-ground]")).toBeTruthy();
  });

  it("an org that has measured nothing gets a hatch, never the same mark as a measured absence", () => {
    const { container } = render(
      <SkillsLifecycle
        skills={[skill({ adoptionCount: 0, downloadCount: 0 })]}
        usage={{
          s1: usage({ state: "unmeasured", verdict: "dormant", lastUsedAt: null, lastUsedType: null, daysSinceUse: null }),
        }}
        fleetSize={4}
      />,
    );
    const drawn = [...container.querySelectorAll("[data-segment]")].map((n) => n.getAttribute("data-segment"));
    expect(drawn).toContain("not-judged");
    // Its accessible equivalent says so in words as well as in paint.
    expect(screen.getAllByText(/no skill events recorded in this org/).length).toBeGreaterThan(0);
  });

  it("carries a legend for the states actually present, and no others", () => {
    render(<SkillsLifecycle skills={[skill({})]} usage={{ s1: usage({}) }} fleetSize={4} />);
    // "Measured" also names cells in each chart's sr-only equivalent — the legend is the visible half
    // of the same vocabulary, so presence is the claim; "Superseded" is in neither.
    expect(screen.getAllByText("Measured").length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Superseded")).toHaveLength(0);
  });

  it("names the cut when it draws fewer skills than the library holds", () => {
    const many = Array.from({ length: 13 }, (_, i) => skill({ id: `s${i}`, name: `s${i}`, adoptionCount: i }));
    render(<SkillsLifecycle skills={many} usage={{}} fleetSize={20} />);
    expect(screen.getByText(/top 10 of 13 by reach/)).toBeTruthy();
  });
});
