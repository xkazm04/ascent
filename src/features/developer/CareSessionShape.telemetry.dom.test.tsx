// @vitest-environment jsdom
//
// The private session shape filled from the viewer's OWN agent telemetry (backlog develop-2026-09-17
// row 27). A measured value prints; it is never drawn against an org band, and the row says why
// ("yours only") rather than borrowing the share path's "comparison off", which would claim the
// viewer shared something and switched comparison off.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CareSessionShape } from "./CareSessionShape";
import { DeveloperHome } from "./DeveloperHome";
import { emptyDeveloperView, type DeveloperView } from "@/lib/org/developer-view";

function measured(sessionsPerWeek: number | null, sessions: number): DeveloperView {
  const v = emptyDeveloperView("ada");
  v.shape.sessionsPerWeek = sessionsPerWeek;
  v.ownTelemetry = { source: "claude-code", sessions, fields: ["sessionsPerWeek"] };
  return v;
}

describe("CareSessionShape: a value measured from your own telemetry", () => {
  it("prints the number and marks it yours only, never as a shared count with comparison off", () => {
    const { container } = render(<CareSessionShape personal={measured(2.8, 12)} />);
    expect(container.textContent).toContain("2.8");
    expect(container.textContent).toContain("yours only");
    expect(container.textContent).not.toContain("comparison off");
    // No band is drawn, even if one existed: the scope is not the share contract's.
    expect(container.querySelector("[data-you]")).toBeNull();
  });

  it("names too few sessions without a numeral below the floor", () => {
    const { container } = render(<CareSessionShape personal={measured(null, 3)} />);
    const row = container.querySelector(".grid")?.firstElementChild?.textContent ?? "";
    expect(row).toContain("too few sessions");
    expect(row).not.toMatch(/\d/);
  });

  it("guard: the other six fields still read nothing shared yet", () => {
    const { container } = render(<CareSessionShape personal={measured(2.8, 12)} />);
    expect(container.textContent?.match(/nothing shared yet/g)).toHaveLength(6);
  });

  it("guard: an unmeasured view renders every field as nothing shared yet", () => {
    const { container } = render(<CareSessionShape personal={emptyDeveloperView("ada")} />);
    expect(container.textContent?.match(/nothing shared yet/g)).toHaveLength(7);
    expect(container.textContent).not.toContain("yours only");
  });
});

describe("DeveloperHome: own telemetry is something of yours", () => {
  it("does not offer Preview-as once your own sessions have landed", () => {
    render(<DeveloperHome view={measured(2.8, 12)} slug="acme" />);
    expect(screen.queryByText("Preview as")).toBeNull();
  });

  it("guard: still offers Preview-as on a truly empty view", () => {
    render(<DeveloperHome view={emptyDeveloperView("ada")} slug="acme" />);
    expect(screen.getByText("Preview as")).toBeInTheDocument();
  });
});
