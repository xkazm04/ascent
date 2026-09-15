// @vitest-environment jsdom
//
// The Weekly digest tab renders what the model measured — including the parts it could NOT measure.
// This file is the PAGE contract: the fixed window, the two header actions, the provenance that
// travels with the numbers, and the empty state. The MARKS that carry what the header sentences used
// to say — the noise band, the void rows, the dismissed segment — are pinned in DigestViz.dom.test.tsx.
//
// The model and the serializer are mocked (WP1 owns their bodies): this file is about the PAGE's
// presentation contract against the wire shape in digest-types.ts, not about the numbers.

import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { digestFixture } from "./digest.fixture";

const { mockBuild, mockMarkdown } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
  mockMarkdown: vi.fn(() => "# Weekly digest\n"),
}));

vi.mock("@/lib/org/digest", () => ({ buildWeeklyDigest: mockBuild }));
vi.mock("@/lib/org/digest-markdown", () => ({ weeklyDigestMarkdown: mockMarkdown }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { DigestTab } = await import("./DigestTab");

async function renderTab(digest: unknown) {
  mockBuild.mockResolvedValue(digest);
  return render(await DigestTab({ slug: "acme", sp: {} }));
}

describe("DigestTab", () => {
  it("heads the page with the fixed window and the two header actions", async () => {
    await renderTab(digestFixture());

    expect(screen.getByText("Weekly digest")).toBeInTheDocument();
    expect(screen.getByText(/2026-08-26 → 2026-09-01/)).toBeInTheDocument();
    // The copy chip's accessible name is distinct from its visible label (several chips can share a page).
    expect(screen.getByRole("button", { name: "Copy the weekly digest as markdown" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Full briefing" })).toHaveAttribute("href", "/org/acme?tab=executive");
  });

  it("renders every dimension, and prints no numeral for the one the week could not measure", async () => {
    const { container } = await renderTab(digestFixture());

    for (const label of ["Testing", "Documentation", "Context Engineering", "Security Posture"]) {
      // the chart's own screen-reader table, built from the same rows the geometry is
      expect(screen.getByRole("rowheader", { name: new RegExp(label) })).toBeInTheDocument();
    }
    // The three presentations are now three marks (DigestViz.dom.test.tsx owns their details); what
    // this page-level case pins is that the unmeasured one reaches the page as a void, so no cell in
    // a column of numbers can carry a stand-in glyph for it.
    const unmeasured = container.querySelector('[data-row="D4"]')!;
    expect(unmeasured.getAttribute("data-state")).toBe("missing");
    expect(unmeasured.querySelector("[data-delta-bar]")).toBeNull();
  });

  it("gives rank 1 the recommended-next-move block", async () => {
    await renderTab(digestFixture());

    expect(screen.getByText("Recommended next move")).toBeInTheDocument();
    expect(screen.getByText(/Roll out the test gate to 4 repositories/)).toBeInTheDocument();
  });

  it("draws the cohort the deltas were measured over, nested inside the coverage", async () => {
    await renderTab(digestFixture());

    // The sentence this replaces held three nested populations: the org, the scanned part of it, and
    // the part of THAT with a scan on both ends. The strip nests them and its accessible name says so.
    expect(
      screen.getByRole("img", { name: /10 of 12 scanned.*8 scanned on both sides of the week/ }),
    ).toBeInTheDocument();
    // The pasted markdown keeps the full sentence — a recipient in Slack has no strip and no chip.
    expect(screen.getByRole("button", { name: "Why: delta cohort" })).toBeInTheDocument();
  });

  it("prints the not-measurable sentence instead of a zero when nothing pre-dates the window", async () => {
    const base = digestFixture();
    await renderTab(
      digestFixture({
        followups: { ...base.followups!, opened: 0, openedRows: [], openedMeasurable: false },
      }),
    );

    expect(screen.getByText(/Not measurable this week/)).toBeInTheDocument();
    expect(screen.getByText(/nothing to diff the latest gaps against/)).toBeInTheDocument();
  });

  it("carries the provenance caveats onto the page rather than swallowing them", async () => {
    await renderTab(digestFixture());

    expect(screen.getByText(/14 scans finished in this window/)).toBeInTheDocument();
    expect(screen.getByText(/mock engine/)).toBeInTheDocument();
    expect(screen.getByText(/Follow-up history for 1 repository was unreadable/)).toBeInTheDocument();
  });

  it("shows the empty state and no digest sections when nothing has been scanned", async () => {
    await renderTab(null);

    // The guard behind this state is `hasFleetGrade`, which is STRICTLY stronger than the
    // `scannedCount === 0` it replaced: a fleet of nothing but mock floors is scanned and ungraded,
    // and the old copy told such a team it had no repositories at all.
    expect(screen.getByText(/No fleet grade for this week yet/)).toBeInTheDocument();
    expect(screen.getByText(/scored by a live engine/)).toBeInTheDocument();
    expect(screen.queryByText("Recommended next move")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy the weekly digest as markdown" })).not.toBeInTheDocument();
  });
});
