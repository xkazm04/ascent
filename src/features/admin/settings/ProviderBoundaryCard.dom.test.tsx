// @vitest-environment jsdom
//
// The view model is proved without a DOM in providerBoundaryViz.test.ts. What this file adds is the
// part that can only be checked once the SVG exists: that the OpenRouter boundary void survives into
// the document as NOTHING DRAWN, that the accessible equivalent says so in words, and that the
// warning the matrix replaced is still on the form where the key is pasted.

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProviderBoundaryCard } from "./ProviderBoundaryCard";
import { OpenRouterByomSettings } from "./OpenRouterByomSettings";
import { PROVIDER_AXIS_HINT } from "./providerBoundaryViz";

const card = (planAllowed = true) => render(<ProviderBoundaryCard config={null} planAllowed={planAllowed} />);
const cell = (row: string, axis: string) => document.querySelector(`[data-cell="${row}:${axis}"]`)!;

describe("ProviderBoundaryCard — the void is real in the DOM", () => {
  it("draws no mark at all in OpenRouter's boundary cell", () => {
    card();
    const g = cell("openrouter", "Boundary");
    expect(g.getAttribute("data-state")).toBe("missing");
    // The frame is drawn so the cell is locatable; the MARK is what must be absent.
    expect(g.querySelector("[data-mark]")).toBeNull();
    expect(g.querySelector("[data-score]")).toBeNull();
  });

  it("draws Bedrock's boundary as a solid mark in the very same column", () => {
    card();
    const g = cell("bedrock", "Boundary");
    expect(g.getAttribute("data-state")).toBe("measured");
    expect(g.querySelector("[data-mark]")).not.toBeNull();
  });

  it("hatches — not voids — the platform row, because unknown is not the same as no", () => {
    card();
    const g = cell("ascent", "Boundary");
    expect(g.getAttribute("data-state")).toBe("not-judged");
    expect(g.querySelector("[data-mark]")).not.toBeNull();
  });

  it("says all three readings in the accessible equivalent, from the same states the geometry uses", () => {
    card();
    const img = screen.getByRole("img", { name: /Where each provider runs inference/i });
    const label = img.getAttribute("aria-label")!;
    expect(label).toMatch(/OpenRouter — Boundary: no measurement/i);
    expect(label).toMatch(/Bedrock — Boundary: measured/i);
    expect(label).toMatch(/Ascent — Boundary: not judged/i);
    expect(label).toMatch(/an empty cell has no measurement and is not a zero/i);
  });

  it("offers the demoted paragraphs on the axis, reachable by keyboard rather than always on screen", () => {
    card();
    const why = screen.getByRole("button", { name: "Why: Boundary" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(why);
    expect(screen.getByRole("note").textContent).toBe(PROVIDER_AXIS_HINT.Boundary);
  });
});

describe("the boundary warning is kept, not demoted", () => {
  it("still states NOT in-boundary on the form that stores the OpenRouter key", () => {
    // §2.1's escape clause: a sentence may stay when demoting it would make it quieter, and this is
    // the one sentence that should change whether an owner pastes a key at all. It is now a marked
    // caution on the form rather than the tail of a 190-character header lede.
    render(<OpenRouterByomSettings slug="acme" initial={null} planAllowed encryptionConfigured />);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/not in-boundary/i);
    expect(note.textContent).toMatch(/third-party upstream/i);
    expect(note.textContent).toMatch(/repository file samples/i);
    // …and it sits above the key field, not below it.
    const key = screen.getByPlaceholderText("sk-or-…");
    expect(note.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
