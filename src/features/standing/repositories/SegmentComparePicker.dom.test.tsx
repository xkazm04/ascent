// @vitest-environment jsdom
//
// repositories-segments #2: the A-vs-B compare picker must not let the SAME segment be chosen on both
// sides (comparing a slice to itself is a meaningless all-zero diff). The already-picked segment is
// DISABLED in the other dropdown.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/org/acme/repositories",
  useSearchParams: () => new URLSearchParams("tab=segments"),
}));

import { SegmentComparePicker } from "./SegmentComparePicker";

const OPTIONS = [
  { id: "s1", name: "platform" },
  { id: "s2", name: "mobile" },
  { id: "s3", name: "legacy" },
];

beforeEach(() => vi.clearAllMocks());

/** The <option> for `name` inside the given <select> (aria-label). */
function optionIn(selectLabel: string, name: string): HTMLOptionElement {
  const select = screen.getByLabelText(selectLabel);
  return within(select).getByRole("option", { name }) as HTMLOptionElement;
}

describe("SegmentComparePicker — can't pick the same segment on both sides (#2)", () => {
  it("disables B's option equal to A, and A's option equal to B", () => {
    render(<SegmentComparePicker options={OPTIONS} a="s1" b="s2" />);

    // B can't re-select A's segment (platform).
    expect(optionIn("Segment B", "platform").disabled).toBe(true);
    // A can't re-select B's segment (mobile).
    expect(optionIn("Segment A", "mobile").disabled).toBe(true);

    // The other, free options stay selectable.
    expect(optionIn("Segment B", "legacy").disabled).toBe(false);
    expect(optionIn("Segment A", "legacy").disabled).toBe(false);
    expect(optionIn("Segment A", "platform").disabled).toBe(false); // A's own value
  });

  it("with B = whole fleet (null), nothing in A is disabled", () => {
    render(<SegmentComparePicker options={OPTIONS} a="s1" b={null} />);
    for (const name of ["platform", "mobile", "legacy"]) {
      expect(optionIn("Segment A", name).disabled).toBe(false);
    }
    // The "Whole fleet" default remains available on B.
    expect(optionIn("Segment B", "Whole fleet").disabled).toBe(false);
  });
});
