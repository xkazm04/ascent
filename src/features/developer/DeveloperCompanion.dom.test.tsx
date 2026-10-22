// @vitest-environment jsdom
// The Developer home renders the v2 composition (masthead + Frames).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeveloperCompanion } from "./DeveloperCompanion";
import { emptyDeveloperView } from "@/lib/org/developer-view";

describe("DeveloperCompanion", () => {
  it("renders the v2 masthead", () => {
    const { container } = render(<DeveloperCompanion view={emptyDeveloperView("ada")} slug="acme" />);
    expect(container.querySelector('[data-role="developer-v2"]')).not.toBeNull();
    expect(container.querySelector('[data-kit="masthead"]')).not.toBeNull();
  });
});
