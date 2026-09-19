// @vitest-environment jsdom
//
// Preview-as is an invitation, not an overlay on a real absence. `activity: null` used to make
// withheld and unreadable look like "nothing of yours has landed here yet", which is false:
// withheld means the numbers exist, unreadable means we could not read them. The chrome is
// gated on a true empty view (`absent` / `signed-out` plus the empty-care checks).

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { DeveloperHome } from "./DeveloperHome";
import { emptyDeveloperView, type DeveloperView } from "@/lib/org/developer-view";

function view(over: Partial<DeveloperView> = {}): DeveloperView {
  return { ...emptyDeveloperView("ada"), ...over };
}

const PREVIEW_KICKER = "Preview as";
const PREVIEW_INVITE = "Nothing of yours has landed here yet";

describe("DeveloperHome — Preview-as only on a true empty view", () => {
  it("hides the preview chrome when activity is withheld", () => {
    const { container } = render(<DeveloperHome view={view({ activityState: "withheld" })} slug="acme" />);
    expect(container.textContent).not.toContain(PREVIEW_KICKER);
    expect(container.textContent).not.toContain(PREVIEW_INVITE);
    expect(container.textContent).toContain("Withheld");
  });

  it("hides the preview chrome when the snapshot is unreadable", () => {
    const { container } = render(<DeveloperHome view={view({ activityState: "unreadable" })} slug="acme" />);
    expect(container.textContent).not.toContain(PREVIEW_KICKER);
    expect(container.textContent).not.toContain(PREVIEW_INVITE);
    expect(container.textContent).toContain("could not be read");
  });

  it("still offers Preview-as when the viewer is genuinely absent", () => {
    const { container } = render(<DeveloperHome view={view({ activityState: "absent" })} slug="acme" />);
    expect(container.textContent).toContain(PREVIEW_KICKER);
    expect(container.textContent).toContain(PREVIEW_INVITE);
  });

  it("still offers Preview-as when nobody is signed in", () => {
    const { container } = render(<DeveloperHome view={emptyDeveloperView(null)} slug="acme" />);
    expect(container.textContent).toContain(PREVIEW_KICKER);
    expect(container.textContent).toContain(PREVIEW_INVITE);
  });
});
