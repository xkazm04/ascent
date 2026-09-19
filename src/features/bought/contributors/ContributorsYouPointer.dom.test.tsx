// @vitest-environment jsdom
//
// Direction 4 — "withheld" is not "you have no commits".
//
// Below the naming floor getContributorInsights empties `insights.contributors`, so the panel's
// roster test is false for EVERY viewer, the org's top committer included. The strip used to answer
// that with "No commits attributed to <you>", which asserts an absence the data never established.
// These pin both branches at the render layer, where the reader actually meets the claim.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContributorsYouStrip } from "./ContributorsYouPointer";
import { CHAMPION_MIN_POP } from "@/lib/org/champions";

describe("ContributorsYouStrip", () => {
  it("above the floor, a viewer genuinely off the roster is told so", () => {
    render(<ContributorsYouStrip slug="acme" viewerLogin="octo" namingAllowed />);
    expect(screen.getByText(/No commits attributed to/i)).toBeTruthy();
    expect(screen.queryByText(/withheld/i)).toBeNull();
  });

  it("below the floor, says attribution is withheld and the commits still count — never 'no commits'", () => {
    const { container } = render(<ContributorsYouStrip slug="acme" viewerLogin="octo" namingAllowed={false} />);
    const text = container.textContent ?? "";
    expect(text).toMatch(new RegExp(`Individual attribution is withheld below ${CHAMPION_MIN_POP} contributors`));
    expect(text).toMatch(/still count in the totals above/i);
    expect(text).not.toMatch(/No commits attributed/i);
  });

  it("below the floor with no known login, keeps the suppression claim without naming anyone", () => {
    const { container } = render(<ContributorsYouStrip slug="acme" viewerLogin={null} namingAllowed={false} />);
    expect(container.textContent ?? "").toMatch(/Individual attribution is withheld/);
    expect(container.textContent ?? "").not.toMatch(/No commits attributed/i);
  });

  it("keeps the developer destination in every branch", () => {
    for (const naming of [true, false]) {
      const { container, unmount } = render(
        <ContributorsYouStrip slug="acme" viewerLogin="octo" namingAllowed={naming} />,
      );
      expect(container.querySelector('a[href*="developer"]')).toBeTruthy();
      unmount();
    }
  });
});
