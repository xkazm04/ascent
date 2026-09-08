// @vitest-environment jsdom
//
// The marks the digest draws instead of the sentences it used to print. Each case follows one
// demoted sentence to the shape that now carries it, and — more important — pins the shape the
// digest must be UNABLE to draw: a numeral where there was no measurement.
//
// The digest is also the one org surface that leaves the product. Where a caveat still belongs in
// the pasted markdown (which has no legend and no hover), that divergence is deliberate and is
// asserted in digest-markdown.test.ts, not here.

import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { digestFixture } from "./digest.fixture";
import { DigestDimensions } from "./DigestDimensions";
import { DigestFollowups } from "./DigestFollowups";
import { DigestActions } from "./DigestActions";
import { DigestHeadline } from "./DigestHeadline";
import { DigestMovement } from "./DigestMovement";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

describe("DigestDimensions — 'an em dash is a missing measurement, not a zero'", () => {
  it("draws no bar and prints no numeral for an unmeasured dimension", () => {
    const { container } = render(<DigestDimensions dims={digestFixture().dims} />);
    const row = container.querySelector('[data-row="D4"]')!;

    expect(row.getAttribute("data-state")).toBe("missing");
    expect(row.querySelector("[data-delta-bar]")).toBeNull();
    expect(row.querySelector("[data-void]")).not.toBeNull();
    // the delta lane of that row carries no number at all — not an em dash sitting in a column of numbers
    expect(row.textContent).not.toMatch(/[+\-−]\d/);
  });

  it("draws the noise band once, so a within-noise hold is legible without the words", () => {
    const { container } = render(<DigestDimensions dims={digestFixture().dims} />);
    expect(container.querySelectorAll("[data-noise-band]")).toHaveLength(1);
    expect(screen.queryByText("flat (within noise)")).not.toBeInTheDocument();
  });

  it("keeps both readings in the screen-reader table the geometry is built from", () => {
    render(<DigestDimensions dims={digestFixture().dims} />);
    expect(screen.getByRole("rowheader", { name: /D3 Context Engineering/ }).parentElement).toHaveTextContent(
      /within the noise band/,
    );
    expect(screen.getByRole("rowheader", { name: /D4 Security Posture/ }).parentElement).toHaveTextContent(
      /No measurement/,
    );
  });
});

describe("DigestFollowups — 'dismissals are counted beside the closes, never folded into them'", () => {
  it("draws the dismissals as their own segment in the `decided` state", () => {
    const { container } = render(<DigestFollowups slug="acme" followups={digestFixture().followups} />);
    const dismissed = container.querySelector('[data-seg="dismissed"]')!;

    expect(dismissed.getAttribute("data-state")).toBe("decided");
    expect(container.querySelector('[data-seg="closed"]')).not.toBeNull();
    expect(dismissed.querySelector("title")?.textContent).toMatch(/never folded into them/);
  });

  it("voids the opened track when nothing pre-dates the window, instead of drawing a 0", () => {
    const base = digestFixture().followups!;
    const { container } = render(
      <DigestFollowups slug="acme" followups={{ ...base, opened: 0, openedRows: [], openedMeasurable: false }} />,
    );
    const opened = container.querySelector('[data-seg="opened"]')!;

    expect(opened.getAttribute("data-state")).toBe("missing");
    expect(opened.querySelector("rect")).toBeNull();
    expect(opened.querySelector("[data-void]")).not.toBeNull();
    // the column's own zero state keeps the reason in words — the reader has no mark to read
    expect(screen.getByText(/nothing to diff the latest gaps against/)).toBeInTheDocument();
  });
});

describe("DigestActions — reach is drawn, and the ranking basis is disclosed rather than asserted", () => {
  it("draws a void, not a short bar, where a move has no projected points", () => {
    const { container } = render(<DigestActions actions={digestFixture().actions} />);
    const third = container.querySelector('[data-rank="3"]')!;

    expect(third.getAttribute("data-points-state")).toBe("missing");
    expect(third.querySelector("[data-pts]")).toBeNull();
    expect(third.querySelector("[data-void]")).not.toBeNull();
    // reach is still measured and still drawn: the absence is only in the projection
    expect(third.querySelector("[data-reach]")).not.toBeNull();
  });

  it("carries the real ranking rule on the header, not the one the old description claimed", () => {
    render(<DigestActions actions={digestFixture().actions} />);
    expect(screen.getByRole("button", { name: "Why: ranking basis" })).toBeInTheDocument();
    expect(screen.queryByText(/Ranked by projected fleet gain/)).not.toBeInTheDocument();
  });

  it("still leads with the sentence the markdown export leads with", () => {
    render(<DigestActions actions={digestFixture().actions} />);
    expect(screen.getByText(/Roll out the test gate to 4 repositories/)).toBeInTheDocument();
  });
});

describe("DigestHeadline — the cohort a delta is measured over is drawn, not narrated", () => {
  it("nests scanned and compared inside the fleet", () => {
    const { container } = render(<DigestHeadline headline={digestFixture().headline} />);
    expect(container.querySelector("[data-cohort]")).not.toBeNull();
    expect(container.querySelector("[data-never-scanned]")).not.toBeNull();
    expect(screen.getByRole("img", { name: /10 of 12 scanned/ })).toBeInTheDocument();
  });

  it("draws the cohort as a void — never a 0 — when no repository has a baseline", () => {
    const h = digestFixture().headline;
    const { container } = render(
      <DigestHeadline headline={{ ...h, cohortSize: null, dOverall: null, dAdoption: null, dRigor: null }} />,
    );
    expect(container.querySelector("[data-cohort]")).toBeNull();
    expect(container.querySelector("[data-cohort-void] [data-void]")).not.toBeNull();
    expect(screen.queryByText(/compared/)).not.toBeInTheDocument();
  });
});

describe("DigestMovement — 'crossed the noise band' is the band, drawn", () => {
  it("plots every mover clear of the shaded band and keeps its report link", () => {
    const { container } = render(<DigestMovement movement={digestFixture().movement} />);
    expect(container.querySelector("[data-noise-band]")).not.toBeNull();
    expect(container.querySelectorAll("[data-mover]")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "api" })).toHaveAttribute("href", "/report/acme/api");
    expect(screen.queryByText(/crossed the noise band between the two ends/)).not.toBeInTheDocument();
  });

  it("keeps a failed read and a quiet week apart", () => {
    render(<DigestMovement movement={null} />);
    expect(screen.getByText(/could not be read this week/)).toBeInTheDocument();

    render(<DigestMovement movement={{ gainers: [], regressers: [], compared: 8 }} />);
    expect(screen.getByText(/No repository moved beyond the noise band/)).toBeInTheDocument();
  });
});
