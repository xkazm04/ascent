// @vitest-environment jsdom
//
// The accretion graphic. FAILS BEFORE: the component did not exist and both facts it draws were
// clauses in a 293-character SectionHeader description ("Nothing is written until you apply a
// proposal, and applying supersedes the members rather than deleting them").
//
// What is pinned: members are `superseded` and carry a real strikethrough rule; the summary is
// `declared` — dashed outline, no fill — until it is applied and becomes `decided`; a family larger
// than the fold still states its TRUE member count; and the sr-only table says the same thing the
// geometry does.

import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MergeCluster } from "./MergeCluster";
import { DECLARED_DASH } from "@/components/org/viz";

// The kit's charts read `prefers-reduced-motion` through `useSyncExternalStore`; jsdom has no
// matchMedia. Stub it to the REDUCED branch so entrance transitions are skipped and the geometry is
// asserted in its settled state — the same stub every viz `.dom.test.tsx` uses.
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

const labels = (n: number) => Array.from({ length: n }, (_, i) => `note ${i}`);

describe("MergeCluster", () => {
  it("draws every member superseded, with a strikethrough rule across it", () => {
    const { container } = render(<MergeCluster memberCount={3} memberLabels={labels(3)} />);
    const members = container.querySelectorAll('[data-member]');
    expect(members).toHaveLength(3);
    for (const m of members) expect(m.getAttribute("data-state")).toBe("superseded");
    expect(container.querySelectorAll("[data-strike]")).toHaveLength(3);
  });

  it("draws the summary DECLARED — dashed, unfilled — while it is only proposed", () => {
    const { container } = render(<MergeCluster memberCount={3} memberLabels={labels(3)} />);
    const summary = container.querySelector("[data-summary]")!;
    expect(summary.getAttribute("data-state")).toBe("declared");
    expect(summary.getAttribute("stroke-dasharray")).toBe(DECLARED_DASH);
    expect(summary.getAttribute("fill")).toBe("none");
  });

  it("promotes the summary to DECIDED once a person applies it", () => {
    const { container } = render(<MergeCluster memberCount={3} memberLabels={labels(3)} applied />);
    const summary = container.querySelector("[data-summary]")!;
    expect(summary.getAttribute("data-state")).toBe("decided");
    expect(summary.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("says the TRUE member count even when it can only draw the first few", () => {
    const { container, getByRole } = render(
      <MergeCluster memberCount={40} memberLabels={labels(40)} />,
    );
    expect(container.querySelectorAll("[data-member]").length).toBeLessThan(40);
    expect(getByRole("img").getAttribute("aria-label")).toContain("40 memories");
    expect(container.textContent).toContain("+34 more");
  });

  it("carries an sr-only equivalent built from the same states as the geometry", () => {
    const { container } = render(<MergeCluster memberCount={3} memberLabels={labels(3)} />);
    const table = container.querySelector("table.sr-only")!;
    expect(table.textContent).toContain("3 member memories");
    expect(table.textContent).toContain("Superseded");
    expect(table.textContent).toContain("Declared");
  });

  it("degrades to a drawable diagram when the member rows could not be joined", () => {
    // memberIds outnumbering the joined member rows is a real case (a row moved underneath us);
    // the diagram must still render rather than divide by an empty list.
    const { getByRole } = render(<MergeCluster memberCount={5} memberLabels={[]} />);
    expect(getByRole("img")).toBeTruthy();
  });
});
