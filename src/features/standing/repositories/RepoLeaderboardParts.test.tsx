// @vitest-environment jsdom
//
// G6-18: the header select-all checkbox only set `checked={allSelected}`, so a partial selection
// rendered as fully unchecked — indistinguishable from "none selected". `indeterminate` is a DOM
// property, not an HTML attribute, so it can only be observed on the actual `HTMLInputElement`, not via
// `toHaveAttribute`. This pins the DOM property directly across all three selection states.

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { FreshnessCell, LeaderboardHead, relAge } from "./RepoLeaderboardParts";

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

// The two-speed freshness cell (moonshot #10). The invariant worth a test is the honest null: a repo
// nobody has probed must read "—", never a stand-in age, and the two speeds must stay separable —
// controls fresh while the score is stale is the NORMAL state of a two-speed fleet, not an anomaly.
describe("FreshnessCell", () => {
  // Anchored to the REAL clock, not a written date. `FreshnessCell` renders an age against
  // `Date.now()`, so a pinned `now` makes every fixture drift: this suite was written with
  // 2026-08-30T12:00Z and its "one hour ago" control had aged into "2d" by the next morning,
  // failing a `/Controls \d+h/` assertion that had nothing wrong with it. A fixture expressed as a
  // distance from now is the only kind this component can be asserted against.
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("renders an em dash for an absent timestamp rather than inventing an age", () => {
    const { container } = render(<FreshnessCell f={{ scoredAt: null, controlsAt: null, queued: false }} />);
    expect(container.textContent).toContain("Scored —");
    expect(container.textContent).toContain("Controls —");
  });

  it("shows a stale score beside fresh controls — the whole point of the two lanes", () => {
    const { container } = render(
      <FreshnessCell f={{ scoredAt: ago(7 * 86_400_000), controlsAt: ago(3_600_000), queued: false }} />,
    );
    // Both are present and distinct; neither is collapsed into a single "last updated".
    expect(container.textContent).toMatch(/Scored \d+d/);
    expect(container.textContent).toMatch(/Controls \d+h/);
  });

  it("tags a repo with owed work as queued, so a truncated run reads as pending, not lost", () => {
    const { container } = render(<FreshnessCell f={{ scoredAt: ago(3_600_000), controlsAt: null, queued: true }} />);
    expect(container.textContent).toContain("queued");
  });

  it("relAge refuses an unparseable stamp instead of rendering NaN", () => {
    expect(relAge("not-a-date")).toBeNull();
    expect(relAge(null)).toBeNull();
    expect(relAge(ago(90 * 60_000), now)).toBe("2h");
  });
});
