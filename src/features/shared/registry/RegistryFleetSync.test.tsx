// @vitest-environment jsdom
//
// Pointing and 30d-sync are R5. Until that pass the loader omits the counts; this panel must hatch
// those meters and print no 0/N, because a zero would mean "we looked and nobody points".

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HATCH_ID } from "@/components/org/viz";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import type { RegistryView } from "@/lib/org/registry-view";
import { RegistryFleetSync } from "./RegistryFleetSync";

function fleetView(fleet: RegistryView["fleet"]): RegistryView {
  const base = fixtureRegistryView("acme", "indexed")!;
  return { ...base, fleet };
}

const meter = (container: HTMLElement, label: string) => container.querySelector(`[data-fleet-meter="${label}"]`);

describe("RegistryFleetSync — pointing/synced before R5", () => {
  it("hatches pointing and synced when the adoption pass has not run, and prints no 0/N", () => {
    const { container } = render(
      <RegistryFleetSync
        slug="acme"
        view={fleetView({ reposTotal: 34, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 } })}
      />,
    );
    const pointing = meter(container, "Pointing")!;
    const synced = meter(container, "Synced 30d")!;
    expect(pointing.getAttribute("data-state")).toBe("not-judged");
    expect(synced.getAttribute("data-state")).toBe("not-judged");
    expect(pointing.querySelector("[data-mark]")?.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(synced.querySelector("[data-mark]")?.getAttribute("fill")).toBe(`url(#${HATCH_ID})`);
    expect(pointing.textContent).not.toMatch(/0\s*%/);
    expect(synced.textContent).not.toMatch(/0\s*%/);
    expect(pointing.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
    expect(synced.textContent).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  it("prints pointing/synced counts once a real pass supplied them", () => {
    const { container } = render(<RegistryFleetSync slug="acme" view={fixtureRegistryView("acme", "indexed")!} />);
    expect(meter(container, "Pointing")?.getAttribute("data-state")).toBe("measured");
    expect(meter(container, "Synced 30d")?.getAttribute("data-state")).toBe("measured");
    expect(meter(container, "Pointing")?.textContent).toMatch(/27\/34/);
    expect(meter(container, "Synced 30d")?.textContent).toMatch(/22\/27/);
  });

  it("a measured empty fleet is 0%, not a hatch — 0 means we looked", () => {
    const { container } = render(
      <RegistryFleetSync
        slug="acme"
        view={fleetView({
          reposTotal: 34,
          reposPointing: 0,
          reposSynced30d: 0,
          adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 },
        })}
      />,
    );
    expect(meter(container, "Pointing")?.getAttribute("data-state")).toBe("measured");
    expect(meter(container, "Synced 30d")?.getAttribute("data-state")).toBe("measured");
    expect(meter(container, "Pointing")?.textContent).toMatch(/0\/34/);
    expect(meter(container, "Pointing")?.querySelector("[data-mark]")).toBeNull();
  });
});
