// @vitest-environment jsdom
//
// The rendered half of the guarantee. `careLedgerRows.test.ts` pins the row model; this pins that the
// model reaches the DOM as an actual absence — no `[data-mark]` element inside any never-sent cell,
// at any sharing state, so a reader who does not trust the copy can inspect the picture instead.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { CarePrivacyLedger } from "./CarePrivacyLedger";
import { SHARING_LEDGER_OFF, type DeveloperView } from "@/lib/org/developer-view";

type Setup = DeveloperView["setup"];

const setup = (sharing: Setup["sharing"]): Setup => ({
  mentorInstalled: true,
  hookInstalled: true,
  lastShareAt: null,
  sharing,
});

const NEVER_IDS = ["transcript-text", "prompts-diffs-file-contents", "per-person-rows-in-org-mode"];

const ALL_SHARED: Setup["sharing"] = SHARING_LEDGER_OFF.map((r) => ({ ...r, shared: true }));

describe("CarePrivacyLedger", () => {
  it("draws every never-sent cell as a void, with no mark, on both axes", () => {
    const { container } = render(<CarePrivacyLedger setup={setup(SHARING_LEDGER_OFF)} />);
    for (const id of NEVER_IDS) {
      for (const axis of ["Sent", "Switch"]) {
        const cell = container.querySelector(`[data-cell="${id}:${axis}"]`);
        expect(cell?.getAttribute("data-state"), `${id}:${axis}`).toBe("missing");
        // The absence IS the encoding — a void draws nothing where a mark would be.
        expect(cell?.querySelector("[data-mark]"), `${id}:${axis}`).toBeNull();
      }
    }
  });

  it("SEEDED VIOLATION: every row flipped to shared cannot put a mark in a never-sent cell", () => {
    const { container } = render(<CarePrivacyLedger setup={setup(ALL_SHARED)} />);
    for (const id of NEVER_IDS) {
      for (const axis of ["Sent", "Switch"]) {
        expect(container.querySelector(`[data-cell="${id}:${axis}"] [data-mark]`), `${id}:${axis}`).toBeNull();
      }
    }
    // …while a switchable row DID light up, so the test is proving a guard, not an empty render.
    expect(container.querySelector('[data-cell="session-counts-30d:Sent"] [data-mark]')).not.toBeNull();
  });

  it("tells a switch left off apart from a row with no switch", () => {
    const { container } = render(<CarePrivacyLedger setup={setup(SHARING_LEDGER_OFF)} />);
    const off = container.querySelector('[data-cell="session-counts-30d:Switch"]');
    expect(off?.getAttribute("data-state")).toBe("decided");
    expect(off?.querySelector("[data-mark]")).not.toBeNull();
    expect(container.querySelector('[data-cell="transcript-text:Switch"] [data-mark]')).toBeNull();
  });

  it("never prints a value inside a void cell", () => {
    const { container } = render(<CarePrivacyLedger setup={setup(ALL_SHARED)} />);
    for (const id of NEVER_IDS) {
      expect(container.querySelector(`[data-cell="${id}:Sent"] [data-score]`), id).toBeNull();
    }
  });

  it("states the never-sent count as a unit rather than a hand-typed number", () => {
    const { getByText } = render(<CarePrivacyLedger setup={setup(SHARING_LEDGER_OFF)} />);
    expect(getByText(/8 fields · 3 with no switch at all/)).toBeTruthy();
  });

  it("keeps an honest empty state when the mentor has never run", () => {
    const { container, getByText } = render(<CarePrivacyLedger setup={setup([])} />);
    expect(getByText(/never run here/)).toBeTruthy();
    expect(container.querySelector("[data-cell]")).toBeNull();
  });
});
