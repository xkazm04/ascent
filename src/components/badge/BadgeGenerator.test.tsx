// @vitest-environment jsdom
//
// Two behaviors copy/logic tests can't reach: (1) the live preview must request a NON-canonical badge
// URL so it isn't tallied as a real README impression (the default level/flat preview IS the canonical
// path the origin counts), and (2) the Copy button must only claim "Copied!" when the clipboard write
// actually resolves — never over a rejected/absent clipboard, where the old code lied.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BadgeGenerator } from "./BadgeGenerator";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

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

// G5-28: the client's `parseRepo` must reject exactly what the server's `validName` rejects (both now
// share `validRepoNamePart` from @/lib/badge) — a name that passes here but fails server-side used to
// produce a snippet whose badge always rendered "unknown".
describe("BadgeGenerator repo validation (agrees with the server's name grammar)", () => {
  it("rejects a leading-dot repo segment (owner/.git) with the invalid-repo message, no snippet", () => {
    render(<BadgeGenerator />);
    typeRepo("owner/.git");

    expect(screen.getByText(/enter a valid repository/i)).toBeInTheDocument();
    const snippet = document.querySelector("pre")?.textContent ?? "";
    expect(snippet).toContain("enter a repository");
  });

  it("rejects a consecutive-dot repo segment (owner/a..b)", () => {
    render(<BadgeGenerator />);
    typeRepo("owner/a..b");

    expect(screen.getByText(/enter a valid repository/i)).toBeInTheDocument();
  });

  it("still accepts a legitimate dotted repo name (owner/node.js)", () => {
    render(<BadgeGenerator />);
    typeRepo("owner/node.js");

    expect(screen.queryByText(/enter a valid repository/i)).toBeNull();
    const img = screen.getByRole("img", { name: "Ascent maturity" });
    expect(img.getAttribute("src") ?? "").toContain("/api/badge/owner/node.js");
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

// embed-snippet-unpinned-rubric: the snippet must pin the RUBRIC it was copied under, exactly as it
// already pins the gate's min_level. Unpinned, a later rubric revision makes the badge in someone's
// README restate a verdict under a bar its author never saw — a claim they never made, and are never
// told about. The pin is what lets the endpoint disclose the change instead of silently restating it.
describe("BadgeGenerator rubric pin (the snippet's meaning contract)", () => {
  it("pins the current rubric on every snippet kind, and says what the pin does", () => {
    render(<BadgeGenerator />);
    typeRepo("facebook/react");

    const snippetOf = () => document.querySelector("pre")?.textContent ?? "";
    expect(snippetOf()).toContain(`rubric=${SCORING_RUBRIC_VERSION}`); // level (the default)

    fireEvent.click(screen.getByRole("button", { name: "score" }));
    expect(snippetOf()).toContain(`rubric=${SCORING_RUBRIC_VERSION}`);

    fireEvent.click(screen.getByRole("button", { name: "gate" }));
    expect(snippetOf()).toContain(`rubric=${SCORING_RUBRIC_VERSION}`);
    expect(snippetOf()).toContain("min_level=L3"); // the pre-existing pin is untouched

    // The visitor is told what they are pasting, in the same place they copy it.
    expect(screen.getByText(/pinned to scoring rubric/i)).toBeInTheDocument();
  });
});
