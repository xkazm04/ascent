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

  it("names each repo that does not point here, with the foreign remote or the exact line to paste", () => {
    const { container } = render(
      <RegistryFleetSync
        slug="acme"
        view={fleetView({
          reposTotal: 5,
          reposPointing: 1,
          reposSynced30d: 1,
          unswept: 2,
          roster: [
            { repoFullName: "acme/api", state: "elsewhere", remote: "other/registry" },
            { repoFullName: "acme/cli", state: "no-manifest" },
            { repoFullName: "acme/web", state: "pointing" },
          ],
          adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 },
        })}
      />,
    );
    expect(meter(container, "Pointing")?.getAttribute("data-state")).toBe("measured");
    const api = container.querySelector('[data-roster-repo="acme/api"]')!;
    expect(api.textContent).toContain("acme/api");
    expect(api.textContent).toContain("points at other/registry");
    const cli = container.querySelector('[data-roster-repo="acme/cli"]')!;
    expect(cli.textContent).toContain("acme/cli");
    expect(cli.querySelector("code[data-pointer-line]")?.textContent).toBe("registry.remote: github:acme/ai-registry");
    expect(container.querySelector('[data-roster-repo="acme/web"]')).toBeNull();
    expect(container.textContent).not.toMatch(/—/);
  });

  it("measured pointing with no adoption does not promise a scan that hashes .claude/skills", () => {
    const { container } = render(
      <RegistryFleetSync
        slug="acme"
        view={fleetView({ reposTotal: 5, reposPointing: 3, reposSynced30d: 2, adoption: { inSync: 0, stale: 0, diverged: 0, localOnly: 0 } })}
      />,
    );
    expect(container.textContent).not.toContain("the next scan of each repo hashes its .claude/skills");
    expect(container.textContent).toMatch(/not measured/i);
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
