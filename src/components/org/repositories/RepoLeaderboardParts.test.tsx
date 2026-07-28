// @vitest-environment jsdom
//
// G6-18: the header select-all checkbox only set `checked={allSelected}`, so a partial selection
// rendered as fully unchecked — indistinguishable from "none selected". `indeterminate` is a DOM
// property, not an HTML attribute, so it can only be observed on the actual `HTMLInputElement`, not via
// `toHaveAttribute`. This pins the DOM property directly across all three selection states.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LeaderboardHead } from "./RepoLeaderboardParts";

function renderHead(props: { allSelected: boolean; indeterminate: boolean }) {
  const { container } = render(
    <table>
      <thead>
        <LeaderboardHead
          hasSegments
          allSelected={props.allSelected}
          indeterminate={props.indeterminate}
          onToggleAll={vi.fn()}
          sort={null}
          onCycle={vi.fn()}
        />
      </thead>
    </table>,
  );
  return container.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

describe("LeaderboardHead select-all checkbox", () => {
  it("is neither checked nor indeterminate when nothing is selected", () => {
    const checkbox = renderHead({ allSelected: false, indeterminate: false });
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(false);
  });

  it("sets the indeterminate DOM property (not just an attribute) for a partial selection", () => {
    const checkbox = renderHead({ allSelected: false, indeterminate: true });
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(true);
  });

  it("is checked and not indeterminate once every row is selected", () => {
    const checkbox = renderHead({ allSelected: true, indeterminate: false });
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
  });
});
