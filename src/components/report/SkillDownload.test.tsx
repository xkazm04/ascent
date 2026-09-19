// @vitest-environment jsdom
//
// The report-header onboarding-skill control. Three things are load-bearing and pinned here:
//
// 1. The DEFAULT pill must stay a plain one-click download with NO selection params — the picker is
//    additive, and a regression that leaked a partial `?dims=` into the default link would silently
//    narrow every maintainer's skill (and the generation-history record it dedups on).
// 2. The picker's download link must encode the chosen dimensions in the exact `?dims=D2,D9` contract
//    the route validates. The route 400s on an unknown id, so a drifted client contract is a broken
//    download, not a degraded one. Opening the picker pre-checks the auto-picked weak set, so that
//    encoding is present on open (not only after a click).
// 3. Reset restores the auto-picked set, never `[]`. An empty box used to mean "Ascent picks" with no
//    `?dims=`; that silent default is gone from the chooser.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { DimensionResult } from "@/lib/types";
import { lastRunLine, SkillDownload } from "./SkillDownload";

const DIMS = [
  { id: "D1", name: "Agent guidance", score: 90 },
  { id: "D2", name: "Test coverage", score: 45 },
  { id: "D9", name: "Security", score: 55 },
] as unknown as DimensionResult[];

const href = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href") ?? "";

function openChooser() {
  fireEvent.click(screen.getByRole("button", { name: "Choose tracks" }));
}

function stubOutcomes(last: { verifiedDelta: number | null; trackIds: string[] } | null) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).toContain("view=outcomes");
    expect(url).toContain("repo=");
    return new Response(JSON.stringify({ last }), { status: 200 });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  stubOutcomes(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lastRunLine — G4 honest nulls", () => {
  it("renders +N for a measured positive delta", () => {
    expect(lastRunLine({ verifiedDelta: 4, trackIds: ["D2", "D9"] })).toBe(
      "last run: +4 overall after tracks D2, D9",
    );
  });

  it("renders an em-dash when verifiedDelta is null, never 0", () => {
    const line = lastRunLine({ verifiedDelta: null, trackIds: ["D2"] });
    expect(line).toBe("last run: — overall after tracks D2");
    expect(line).not.toMatch(/: 0 /);
    expect(line).not.toContain("+0");
  });

  it("keeps a measured 0 as 0 — that is a real delta, not an absence", () => {
    expect(lastRunLine({ verifiedDelta: 0, trackIds: ["D2"] })).toBe("last run: 0 overall after tracks D2");
  });
});

describe("SkillDownload", () => {
  it("keeps the default pill a bare download — no dims param", () => {
    render(<SkillDownload repoParam="acme/api@abc123" dimensions={DIMS} />);
    const link = href(/Onboarding skill/);
    expect(link).toBe("/api/report/skill?repo=acme%2Fapi%40abc123");
    expect(link).not.toContain("dims");
  });

  it("pre-checks auto-picked tracks on open and encodes them as ?dims=D2,D9", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    openChooser();

    expect(screen.getByRole("checkbox", { name: /D2/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D9/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D1/ })).not.toBeChecked();
    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi&dims=D2%2CD9");
  });

  it("offers a refinement pick on an ALREADY-STRONG dimension (the point of the multiselect)", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    openChooser();
    fireEvent.click(screen.getByRole("checkbox", { name: /D1/ })); // D1 scores 90 — not a gap
    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi&dims=D2%2CD9%2CD1");
  });

  it("Reset restores the auto-picked set, not an empty selection", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    openChooser();
    fireEvent.click(screen.getByRole("checkbox", { name: /D2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /D1/ }));
    expect(screen.getByRole("checkbox", { name: /D2/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D1/ })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByRole("checkbox", { name: /D2/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D9/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D1/ })).not.toBeChecked();
    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi&dims=D2%2CD9");
  });

  it("re-seeds the auto-picked set every time the chooser opens", () => {
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    openChooser();
    fireEvent.click(screen.getByRole("checkbox", { name: /D1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    openChooser();
    expect(screen.getByRole("checkbox", { name: /D1/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D2/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /D9/ })).toBeChecked();
    expect(href(/Download SKILL.md/)).toBe("/api/report/skill?repo=acme%2Fapi&dims=D2%2CD9");
  });

  it("renders only the plain pill (no picker) when the report carries no dimensions", () => {
    render(<SkillDownload repoParam="acme/api" />);
    expect(screen.getByRole("link", { name: /Onboarding skill/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose tracks" })).toBeNull();
  });

  it("renders last run +4 overall after tracks from a measured outcome", async () => {
    stubOutcomes({ verifiedDelta: 4, trackIds: ["D2", "D9"] });
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    expect(await screen.findByTestId("skill-last-run")).toHaveTextContent(
      "last run: +4 overall after tracks D2, D9",
    );
    expect(href(/Onboarding skill/)).not.toContain("view=outcomes");
  });

  it("renders an em-dash when verifiedDelta is null, never a fabricated 0", async () => {
    stubOutcomes({ verifiedDelta: null, trackIds: ["D2"] });
    render(<SkillDownload repoParam="acme/api" dimensions={DIMS} />);
    const line = await screen.findByTestId("skill-last-run");
    expect(line).toHaveTextContent("last run: — overall after tracks D2");
    expect(line.textContent).not.toMatch(/: 0 /);
    expect(line.textContent).not.toContain("+0");
  });
});
