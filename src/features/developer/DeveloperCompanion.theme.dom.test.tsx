// @vitest-environment jsdom
// Prism picks the v2 composition (masthead + Frames); Altimeter (the default) keeps the notebook column.
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeveloperCompanion } from "./DeveloperCompanion";
import { emptyDeveloperView } from "@/lib/org/developer-view";

describe("DeveloperCompanion theme", () => {
  it("renders the v2 masthead under Prism", () => {
    const { container } = render(<DeveloperCompanion view={emptyDeveloperView("ada")} slug="acme" theme="prism" />);
    expect(container.querySelector('[data-role="developer-v2"]')).not.toBeNull();
    expect(container.querySelector('[data-kit="masthead"]')).not.toBeNull();
  });

  it("keeps the v1 column under Altimeter and by default", () => {
    const { container } = render(<DeveloperCompanion view={emptyDeveloperView("ada")} slug="acme" />);
    expect(container.querySelector('[data-role="developer-v2"]')).toBeNull();
    expect(container.textContent).toContain("private to you");
  });
});
