// @vitest-environment jsdom
//
// The Weekly digest tab renders what the model measured — including the parts it could NOT measure.
// These cases pin the three presentations a leadership update most often flattens into each other:
// a real move, a within-noise hold ("flat (within noise)"), and a missing measurement ("—", never a
// zero); plus the "opened" column's unmeasurable state, which must be a sentence rather than a 0.
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
  render(await DigestTab({ slug: "acme", sp: {} }));
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

  it("renders every dimension, with the flat and unmeasured bands worded apart", async () => {
    await renderTab(digestFixture());

    for (const label of ["Testing", "Documentation", "Context Engineering", "Security Posture"]) {
      expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
    }
    // A within-noise hold is a MEASUREMENT that did not move…
    expect(screen.getByText("flat (within noise)")).toBeInTheDocument();
    // …and an unmeasured dimension is an em dash, not a zero. (getAllByText: the em dash is the whole
    // text of that cell, which is what distinguishes it from em dashes inside longer sentences.)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("gives rank 1 the recommended-next-move block", async () => {
    await renderTab(digestFixture());

    expect(screen.getByText("Recommended next move")).toBeInTheDocument();
    expect(screen.getByText(/Roll out the test gate to 4 repositories/)).toBeInTheDocument();
  });

  it("states the cohort the deltas were measured over, and the coverage", async () => {
    await renderTab(digestFixture());

    expect(
      screen.getByText(/measured over 8 repositories scanned on both sides of the week \(\+2 onboarded, 1 departed\)/),
    ).toBeInTheDocument();
    expect(screen.getByText(/10\/12 repositories scanned/)).toBeInTheDocument();
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

    expect(screen.getByText(/No scanned repositories yet/)).toBeInTheDocument();
    expect(screen.queryByText("Recommended next move")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy the weekly digest as markdown" })).not.toBeInTheDocument();
  });
});
