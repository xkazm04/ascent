// @vitest-environment jsdom
//
// Two behaviors copy/logic tests can't reach: (1) the live preview must request a NON-canonical badge
// URL so it isn't tallied as a real README impression (the default level/flat preview IS the canonical
// path the origin counts), and (2) the Copy button must only claim "Copied!" when the clipboard write
// actually resolves — never over a rejected/absent clipboard, where the old code lied.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BadgeGenerator } from "./BadgeGenerator";

function setClipboard(value: { writeText?: (t: string) => Promise<void> } | undefined) {
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

function typeRepo(repo: string) {
  fireEvent.change(screen.getByLabelText("Repository"), { target: { value: repo } });
}

afterEach(() => {
  vi.restoreAllMocks();
  setClipboard(undefined);
});

describe("BadgeGenerator preview URL (does not inflate badge-reach analytics)", () => {
  it("requests the preview badge with an inert preview=1 param, while the copyable snippet stays canonical", () => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");

    // The <img> the user sees is the app's OWN image → must be marked customized so the tally skips it.
    const img = screen.getByRole("img", { name: "Ascent maturity" });
    const src = img.getAttribute("src") ?? "";
    expect(src).toContain("/api/badge/facebook/react");
    expect(src).toContain("preview=1");

    // The snippet real READMEs embed must remain the CANONICAL (countable) URL — no preview marker.
    const snippet = document.querySelector("pre")?.textContent ?? "";
    expect(snippet).toContain("/api/badge/facebook/react");
    expect(snippet).not.toContain("preview=1");
  });
});

// usage-metering-public-badge 2026-07-16 #1: a bare ?gate=1 evaluates an undisclosed
// archetype-dependent DEFAULT policy the badge author never chose (and which silently changes with
// the detected archetype). The generator must pin an explicit min_level and say what "pass" means.
describe("BadgeGenerator gate badge (explicit, disclosed policy)", () => {
  it("the gate snippet always carries an explicit min_level (default L3) and states the pass bar", () => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");
    fireEvent.click(screen.getByRole("button", { name: "gate" }));

    const snippet = document.querySelector("pre")?.textContent ?? "";
    expect(snippet).toContain("gate=1");
    expect(snippet).toContain("min_level=L3"); // never a bare ?gate=1 against an undisclosed default
    // The disclosure line names the bar (the chip button also reads "L3", hence getAllByText).
    expect(screen.getByText(/Pass means/i)).toBeInTheDocument();
    expect(screen.getAllByText("L3").length).toBeGreaterThanOrEqual(2); // chip + disclosure
  });

  it("picking a different pass bar updates the URL and the disclosure line", () => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");
    fireEvent.click(screen.getByRole("button", { name: "gate" }));
    fireEvent.click(screen.getByRole("button", { name: "L4" }));

    const snippet = document.querySelector("pre")?.textContent ?? "";
    expect(snippet).toContain("min_level=L4");
    expect(snippet).not.toContain("min_level=L3");
  });

  it("non-gate badges carry no min_level (the policy knob is gate-only)", () => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");

    const snippet = document.querySelector("pre")?.textContent ?? "";
    expect(snippet).not.toContain("min_level");
    expect(screen.queryByText(/Pass means/i)).toBeNull();
  });
});

describe("BadgeGenerator copy button (no success theater)", () => {
  beforeEach(() => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");
  });

  it("shows 'Copied!' only after the clipboard write RESOLVES, with the canonical snippet", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copied!" })).toBeInTheDocument();
    // The clipboard receives the canonical snippet, never the preview=1 variant.
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0]![0] as string;
    expect(written).toContain("/api/badge/facebook/react");
    expect(written).not.toContain("preview=1");
  });

  it("shows 'Copy failed' (not 'Copied!') and a manual-copy hint when writeText rejects", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied!" })).toBeNull();
    expect(screen.getByText(/select the snippet above and copy it manually/i)).toBeInTheDocument();
  });

  it("shows 'Copy failed' when the clipboard API is absent (insecure-context / plain HTTP)", async () => {
    setClipboard(undefined); // navigator.clipboard is undefined

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeInTheDocument();
    expect(screen.getByText(/copy it manually/i)).toBeInTheDocument();
  });
});
