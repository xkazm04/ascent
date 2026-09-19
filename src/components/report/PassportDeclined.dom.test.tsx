// @vitest-environment jsdom
//
// The report's "declined by choice" strip disagreed with the fleet's DeclinedList about the same repo:
// it ignored `needsReconfirm`/`reconfirmReason`, so a decline the overlay had deliberately re-surfaced
// (finding changed kind / hardened / aged past the window) rendered here as settled and struck through
// while the fleet table showed it as open. It also said "declined" with no author, though a decline is a
// decision record — who, what, when.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PassportDeclined } from "./PassportDeclined";
import type { DeclinedByChoice } from "@/lib/types";

const settled: DeclinedByChoice = {
  path: "productionReadiness.observability",
  label: "Observability",
  reason: "internal cron worker",
  blocker: "Zero observability: no error tracking, logs or metrics detected.",
  at: "2026-01-05",
  by: "alice",
};

const resurfaced: DeclinedByChoice = {
  path: "productionReadiness.security",
  label: "Security scanning",
  blocker: "No dependency/secret/SAST scanning.",
  at: "2024-01-05",
  by: "bob",
  needsReconfirm: true,
  reconfirmReason: "This gap hardened since it was accepted (severity warn -> block).",
};

describe("PassportDeclined (report hero strip)", () => {
  it("names the author and the date of each decision", () => {
    render(<PassportDeclined declined={[settled]} />);
    const strip = screen.getByTestId("passport-declined");
    expect(strip).toHaveTextContent("by alice on 2026-01-05");
  });

  it("says UNKNOWN for a decline recorded before authorship was captured — never a fabricated author", () => {
    render(<PassportDeclined declined={[{ ...settled, by: undefined }]} />);
    expect(screen.getByTestId("passport-declined")).toHaveTextContent("by unknown");
  });

  it("renders a RE-SURFACED decline as open, with its reason — the way the fleet list does", () => {
    render(<PassportDeclined declined={[resurfaced]} />);
    const strip = screen.getByTestId("passport-declined");
    expect(strip).toHaveTextContent("needs re-confirmation");
    expect(strip).toHaveTextContent("hardened since it was accepted");
    expect(strip).toHaveTextContent("still an open blocker");
    // The blocker is NOT struck through: it is still open.
    const blocker = Array.from(strip.querySelectorAll("span")).find((el) => el.textContent === resurfaced.blocker)!;
    expect(blocker.className).not.toContain("line-through");
  });

  it("still strikes through a blocker whose decline stands", () => {
    const { container } = render(<PassportDeclined declined={[settled]} />);
    const blocker = Array.from(container.querySelectorAll("span")).find((el) => el.textContent === settled.blocker)!;
    expect(blocker.className).toContain("line-through");
  });

  it("renders nothing when nothing is declined", () => {
    const { container } = render(<PassportDeclined declined={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
