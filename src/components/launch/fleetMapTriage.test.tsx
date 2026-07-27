// @vitest-environment jsdom
//
// The fleet map's triage residuals — five seams where the map showed a STATE but never explained it.
// Each block below pins the explanation, because in every case the silent version was visually
// indistinguishable from a different (and wrong) reading of the same pixels.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet } from "./FleetMapChrome";
import { FleetHeader } from "./FleetMap.Header";
import { TriageControls } from "./FleetMap.TriageControls";
import {
  TRIAGE_MIN_REPOS,
  countMatches,
  fleetGreeting,
  fleetStats,
  makeMatcher,
  showTriageControls,
} from "./fleetMapDerive";
import type { Constellation } from "./fleetMapStars";

function fleet(logins: string[], reposPerOrg: number): Constellation[] {
  return logins.map((login, o) => ({
    id: o + 1,
    login,
    status: "done" as const,
    repos: Array.from({ length: reposPerOrg }, (_, i) => ({
      fullName: `${login}/repo-${i}`,
      overall: i % 2 === 0 ? 70 : null,
      level: i % 2 === 0 ? "L4" : null,
      dOverall: null,
      watched: i === 0,
    })),
  }));
}

describe("countMatches — a zero-match filter must be distinguishable from a faded fleet", () => {
  const f = fleet(["acme", "globex"], 4);

  it("counts every repo when no filter is active", () => {
    expect(countMatches(f, undefined)).toEqual({ matched: 8, total: 8 });
  });

  it("counts the subset a query matches", () => {
    const m = makeMatcher({ q: "repo-1", levels: new Set(), watchedOnly: false });
    expect(countMatches(f, m)).toEqual({ matched: 2, total: 8 });
  });

  it("reports zero matches rather than silently dimming everything", () => {
    const m = makeMatcher({ q: "nothing-here", levels: new Set(), watchedOnly: false });
    expect(countMatches(f, m)).toEqual({ matched: 0, total: 8 });
  });

  it("ignores orgs that are still loading or unreachable (they hold no repos)", () => {
    const mixed: Constellation[] = [
      ...fleet(["acme"], 3),
      { id: 9, login: "loading", status: "loading" },
      { id: 10, login: "broken", status: "error", message: "nope" },
    ];
    expect(countMatches(mixed, undefined)).toEqual({ matched: 3, total: 3 });
  });
});

describe("TriageControls — the match summary is rendered, not just computed", () => {
  const base = {
    query: "",
    setQuery: () => {},
    levels: new Set<string>(),
    toggleLevel: () => {},
    watchedOnly: false,
    setWatchedOnly: () => {},
    sortKey: "name" as const,
    setSortKey: () => {},
    onClear: () => {},
  };

  it("says nothing when no filter is active", () => {
    render(<TriageControls {...base} filterActive={false} matchCount={{ matched: 8, total: 8 }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("summarizes N of M while a filter is active", () => {
    render(<TriageControls {...base} filterActive matchCount={{ matched: 2, total: 8 }} />);
    expect(screen.getByRole("status").textContent).toBe("2 of 8 match");
  });

  it("calls out a dead-end query explicitly", () => {
    render(<TriageControls {...base} filterActive matchCount={{ matched: 0, total: 8 }} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/no repos match/);
    // Politely announced as the user types, not a focus-stealing alert.
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});

describe("showTriageControls — a single org with many repos still gets search", () => {
  it("hides the controls for an empty fleet", () => {
    expect(showTriageControls(0, 0)).toBe(false);
  });

  it("shows them for any multi-org fleet, however small", () => {
    expect(showTriageControls(2, 0)).toBe(true);
    expect(showTriageControls(5, 3)).toBe(true);
  });

  it("shows them for ONE org once it is dense enough to need triage", () => {
    // The old `constellations.length > 1` gate denied search to exactly the user who needs it most.
    expect(showTriageControls(1, 300)).toBe(true);
    expect(showTriageControls(1, TRIAGE_MIN_REPOS)).toBe(true);
  });

  it("still hides them for a trivially small single-org fleet", () => {
    expect(showTriageControls(1, TRIAGE_MIN_REPOS - 1)).toBe(false);
    expect(showTriageControls(1, 0)).toBe(false);
  });
});

describe("ConstellationField Scan button — the single-scan lock explains itself", () => {
  const c = fleet(["acme"], 2)[0];

  it("offers a plain scan affordance when nothing is running", () => {
    render(<ConstellationField c={c} onScan={() => {}} />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-disabled")).toBeNull();
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute("title")).toMatch(/watched repos/i);
  });

  it("says WHY another org's button is unavailable during a scan", () => {
    render(<ConstellationField c={c} onScan={() => {}} scanDisabled />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toMatch(/one scan at a time/i);
    expect(btn.getAttribute("aria-label")).toMatch(/one scan at a time/i);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the blocked button reachable by keyboard so the explanation can be read", () => {
    render(<ConstellationField c={c} onScan={() => {}} scanDisabled />);
    // `disabled` would strip it from the tab order AND suppress its tooltip — the explanation would
    // exist only for mouse users. aria-disabled announces the state without hiding it.
    expect(screen.getByRole("button")).not.toBeDisabled();
  });

  it("does not fire onScan while blocked", () => {
    let calls = 0;
    render(<ConstellationField c={c} onScan={() => (calls += 1)} scanDisabled />);
    screen.getByRole("button").click();
    expect(calls).toBe(0);
  });

  it("names the org that is currently scanning", () => {
    render(<ConstellationField c={c} onScan={() => {}} scanning />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("aria-label")).toMatch(/acme/);
  });
});

describe("EmptyFleet — instrument-grade chrome, no emoji", () => {
  it("renders no emoji", () => {
    const { container } = render(<EmptyFleet />);
    expect(container.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("shows a static constellation glyph drawn by the shared star helpers", () => {
    const { container } = render(<EmptyFleet />);
    expect(container.querySelectorAll("circle.launch-star")).toHaveLength(12);
  });

  it("still leads to the connect flow", () => {
    render(<EmptyFleet />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/connect");
  });
});

describe("fleetGreeting — /launch's only entry moment is a FIRST sign-in", () => {
  it("frames the fleet instead of asserting a return visit", () => {
    const g = fleetGreeting("Dana");
    expect(g).toEqual({ lead: "Your fleet", name: "Dana" });
    expect(`${g.lead} ${g.name}`).not.toMatch(/back/i);
  });

  it("degrades to a bare heading when the viewer has no usable name", () => {
    expect(fleetGreeting("")).toEqual({ lead: "Your fleet", name: null });
    expect(fleetGreeting("   ")).toEqual({ lead: "Your fleet", name: null });
    expect(fleetGreeting(null)).toEqual({ lead: "Your fleet", name: null });
  });

  it("renders in the header without a dangling comma when nameless", () => {
    const stats = fleetStats(fleet(["acme"], 2));
    const { container } = render(<FleetHeader userName="" stats={stats} hydrating={false} />);
    expect(container.querySelector("h1")!.textContent).toBe("Your fleet");
  });

  it("greets a named viewer without 'welcome back'", () => {
    const stats = fleetStats(fleet(["acme"], 2));
    const { container } = render(<FleetHeader userName="Dana" stats={stats} hydrating={false} />);
    const h1 = container.querySelector("h1")!.textContent ?? "";
    expect(h1).toBe("Your fleet, Dana");
    expect(h1).not.toMatch(/welcome/i);
  });
});
