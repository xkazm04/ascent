// @vitest-environment jsdom
//
// Four absences this page used to render identically, pinned apart. Each one is about the viewer
// THEMSELF, which is why they matter more here than anywhere else on the dashboard:
//
//   withheld       your rows exist and the snapshot suppressed them (population under the floor)
//   absent         the snapshot was read and you are genuinely not in it
//   not shared     you never sent this count — no number exists, and it is not a zero
//   no denominator no commits for an AI share to be a share OF, vs a measured 0%

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CareShapeRow } from "./CareShapeRow";
import { CareSessionShape } from "./CareSessionShape";
import { DeveloperActivityStrip } from "./DeveloperActivityStrip";
import { emptyDeveloperView, type DeveloperView } from "@/lib/org/developer-view";

const BAND = { p25: 4, p50: 10, p75: 20 };

function view(over: Partial<DeveloperView> = {}): DeveloperView {
  return { ...emptyDeveloperView("ada"), ...over };
}

const swatch = (c: HTMLElement, prefix: string) => c.querySelector(`svg[aria-label^="${prefix}"]`);

describe("CareShapeRow — a shared zero is not an unshared field", () => {
  it("plots a measured 0 against the band, with a `you` marker", () => {
    const { container } = render(
      <CareShapeRow field="sessionsPerWeek" value={0} shared band={BAND} gap="no-band" />,
    );
    expect(container.textContent).toContain("0");
    expect(container.querySelector("[data-you]")).not.toBeNull();
    expect(container.textContent).not.toContain("not shared");
  });

  it("draws a void with NO numeral for a field that was never shared", () => {
    const { container } = render(
      <CareShapeRow field="sessionsPerWeek" value={0} shared={false} band={BAND} gap="no-band" />,
    );
    expect(container.textContent).toContain("not shared");
    expect(swatch(container, "No measurement")).not.toBeNull();
    // The whole point: no number is printed, so nothing here can be misread as a measured zero.
    expect(container.querySelector("[data-you]")).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("tells `comparison off` (your decision) apart from `no band yet` (nothing to compare to)", () => {
    const off = render(<CareShapeRow field="planModePct" value={62} shared gap="comparison-off" />);
    expect(off.container.textContent).toContain("comparison off");
    expect(swatch(off.container, "Decided by a human")).not.toBeNull();

    const thin = render(<CareShapeRow field="planModePct" value={62} shared gap="no-band" />);
    expect(thin.container.textContent).toContain("no band yet");
    expect(swatch(thin.container, "Not judged")).not.toBeNull();
    // Both still print YOUR number — it is the comparison that is absent, not the measurement.
    expect(thin.container.textContent).toContain("62%");
  });
});

describe("CareSessionShape — which gap the rows inherit", () => {
  it("reads a null orgBands as comparison off, not as thin data", () => {
    const { container } = render(
      <CareSessionShape personal={view({ shape: { ...emptyDeveloperView().shape, sessionsPerWeek: 9 }, sharedFields: ["sessionsPerWeek"], orgBands: null })} />,
    );
    expect(container.textContent).toContain("comparison off");
    expect(container.textContent).not.toContain("no band yet");
  });

  it("reads an empty band map as comparison on with nothing to compare to", () => {
    const { container } = render(
      <CareSessionShape personal={view({ shape: { ...emptyDeveloperView().shape, sessionsPerWeek: 9 }, sharedFields: ["sessionsPerWeek"], orgBands: {} })} />,
    );
    expect(container.textContent).toContain("no band yet");
    expect(container.textContent).not.toContain("comparison off");
  });
});

describe("DeveloperActivityStrip — four reasons `activity` is null", () => {
  it("hatches a suppression and says the numbers exist", () => {
    const { container } = render(<DeveloperActivityStrip view={view({ activityState: "withheld" })} slug="acme" />);
    expect(container.textContent).toContain("Withheld");
    expect(container.textContent).toContain("Your commits exist");
    expect(swatch(container, "Not judged")).not.toBeNull();
  });

  it("voids a genuine absence, and never calls it withheld", () => {
    const { container } = render(<DeveloperActivityStrip view={view({ activityState: "absent" })} slug="acme" />);
    expect(container.textContent).toContain("No commits attributed to");
    expect(container.textContent).not.toContain("Withheld");
    expect(swatch(container, "No measurement")).not.toBeNull();
  });

  it("distinguishes an unreadable snapshot from both", () => {
    const { container } = render(<DeveloperActivityStrip view={view({ activityState: "unreadable" })} slug="acme" />);
    expect(container.textContent).toContain("could not be read");
    expect(container.textContent).not.toContain("No commits attributed to");
  });

  it("invites a signed-out reader instead of reporting an absence about them", () => {
    const { container } = render(
      <DeveloperActivityStrip view={{ ...emptyDeveloperView(null) }} slug="acme" />,
    );
    expect(container.textContent).toContain("Sign in");
  });
});

describe("CareShareBar — a measured 0% is not a missing denominator", () => {
  const activity = (over: Partial<NonNullable<DeveloperView["activity"]>>) => ({
    commits: 40,
    aiCommits: 0,
    aiShare: 0,
    repos: 2,
    lastActiveAt: null,
    champion: false,
    ...over,
  });

  it("draws the empty track and prints the measured zero", () => {
    const { container } = render(
      <DeveloperActivityStrip view={view({ activityState: "measured", activity: activity({}) })} slug="acme" />,
    );
    expect(container.textContent).toContain("0%");
    expect(container.querySelector('svg[role="img"][aria-label^="AI-attributed share"]')).not.toBeNull();
    // 0 of 40 → the track is there, the fill is not.
    expect(container.querySelector("[data-fill]")).toBeNull();
  });

  it("draws no bar at all when there are no commits to take a share of", () => {
    const { container } = render(
      <DeveloperActivityStrip view={view({ activityState: "measured", activity: activity({ commits: 0, repos: 0 }) })} slug="acme" />,
    );
    expect(container.textContent).toContain("no commits to take a share of");
    expect(container.textContent).not.toContain("0%");
    expect(swatch(container, "No measurement")).not.toBeNull();
  });

  it("fills the track for a real share", () => {
    const { container } = render(
      <DeveloperActivityStrip view={view({ activityState: "measured", activity: activity({ aiCommits: 26, aiShare: 65 }) })} slug="acme" />,
    );
    expect(container.querySelector("[data-fill]")).not.toBeNull();
    expect(container.textContent).toContain("65%");
  });
});
