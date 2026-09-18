// @vitest-environment jsdom
//
// The fleet map's triage residuals — five seams where the map showed a STATE but never explained it.
// Each block below pins the explanation, because in every case the silent version was visually
// indistinguishable from a different (and wrong) reading of the same pixels.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConstellationField } from "./ConstellationField";
import { EmptyFleet } from "./FleetMapChrome";
import { FleetHeader } from "./FleetMap.Header";
import { FleetMap } from "./FleetMap";
import { TriageControls } from "./FleetMap.TriageControls";
import {
  EMPTY_LAUNCH_TRIAGE,
  TRIAGE_MIN_REPOS,
  TRIAGE_QUERY_DEBOUNCE_MS,
  countMatches,
  fleetGreeting,
  fleetStats,
  launchSignInNext,
  launchTriageHref,
  makeMatcher,
  parseLaunchTriage,
  showTriageControls,
} from "./fleetMapDerive";
import type { Constellation } from "./fleetMapStars";

const nav = vi.hoisted(() => {
  const replace = vi.fn();
  let search = "";
  return {
    replace,
    setSearch: (s: string) => {
      search = s.replace(/^\?/, "");
    },
    params: () => new URLSearchParams(search),
    reset: () => {
      search = "";
      replace.mockClear();
    },
  };
});

vi.mock("./useFleetData", () => ({ useFleetData: () => ({ onRetry: () => {} }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/launch",
  useSearchParams: () => nav.params(),
}));

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

const triageBase = {
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

describe("TriageControls — the match summary is rendered, not just computed", () => {

  it("says nothing when no filter is active", () => {
    render(<TriageControls {...triageBase} filterActive={false} matchCount={{ matched: 8, total: 8 }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("summarizes N of M while a filter is active", () => {
    render(<TriageControls {...triageBase} filterActive matchCount={{ matched: 2, total: 8 }} />);
    expect(screen.getByRole("status").textContent).toBe("2 of 8 match");
  });

  it("calls out a dead-end query explicitly", () => {
    render(<TriageControls {...triageBase} filterActive matchCount={{ matched: 0, total: 8 }} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/no repos match/);
    // Politely announced as the user types, not a focus-stealing alert.
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
});

describe("TriageControls — / focuses Find a repo like the rest of the app", () => {
  function renderTriage() {
    render(<TriageControls {...triageBase} filterActive={false} matchCount={{ matched: 8, total: 8 }} />);
    return screen.getByRole("searchbox", { name: "Filter repositories by name" });
  }

  it("captures / when the target is not an input and focuses Find a repo", () => {
    const search = renderTriage();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    expect(search.getAttribute("aria-keyshortcuts")).toBe("/");
    fireEvent.keyDown(document, { key: "/" });
    expect(search).toHaveFocus();
  });

  it("ignores / inside inputs so a typed slash is not stolen", () => {
    render(
      <div>
        <input aria-label="other field" />
        <TriageControls {...triageBase} filterActive={false} matchCount={{ matched: 8, total: 8 }} />
      </div>,
    );
    const search = screen.getByRole("searchbox", { name: "Filter repositories by name" });
    const other = screen.getByLabelText("other field");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(other).toHaveFocus();
    expect(search).not.toHaveFocus();
  });

  it("ignores / inside the sort select", () => {
    const search = renderTriage();
    const sort = screen.getByRole("combobox");
    sort.focus();
    fireEvent.keyDown(sort, { key: "/" });
    expect(sort).toHaveFocus();
    expect(search).not.toHaveFocus();
  });
});

describe("parseLaunchTriage / launchTriageHref — levels/q/watched/sort round-trip", () => {
  it("parses /launch?levels=L1 as the L1 band filter", () => {
    expect(parseLaunchTriage({ levels: "L1" })).toEqual({
      q: "",
      levels: ["L1"],
      watchedOnly: false,
      sortKey: "name",
    });
    expect(launchTriageHref("/launch", "", { ...EMPTY_LAUNCH_TRIAGE, levels: ["L1"] })).toBe("/launch?levels=L1");
  });

  it("round-trips q, levels, watched, and sort, omitting defaults", () => {
    const triage = parseLaunchTriage({
      q: "payments",
      levels: "L5,L1,L1,L9",
      watched: "1",
      sort: "maturity",
    });
    expect(triage).toEqual({
      q: "payments",
      levels: ["L1", "L5"],
      watchedOnly: true,
      sortKey: "maturity",
    });
    const href = launchTriageHref("/launch", "", triage);
    const qs = href.startsWith("/launch?") ? href.slice("/launch?".length) : "";
    expect(qs).toContain("q=payments");
    expect(qs).toContain("watched=1");
    expect(qs).toContain("sort=maturity");
    expect(qs.replace(/%2C/gi, ",")).toContain("levels=L1,L5");
    expect(parseLaunchTriage(new URLSearchParams(qs))).toEqual(triage);
  });

  it("accepts URLSearchParams, repeated levels, watched=true, and drops unknown sort", () => {
    const sp = new URLSearchParams();
    sp.append("levels", "L2");
    sp.append("levels", "unscanned");
    sp.set("watched", "true");
    sp.set("sort", "nope");
    expect(parseLaunchTriage(sp)).toEqual({
      q: "",
      levels: ["L2", "unscanned"],
      watchedOnly: true,
      sortKey: "name",
    });
  });

  it("preserves ?next= while patching triage, and strips defaults", () => {
    const href = launchTriageHref("/launch", "next=%2Forg%2Facme&q=old", {
      q: "",
      levels: ["L1"],
      watchedOnly: false,
      sortKey: "name",
    });
    expect(href).toBe("/launch?next=%2Forg%2Facme&levels=L1");
    expect(launchTriageHref("/launch", "", EMPTY_LAUNCH_TRIAGE)).toBe("/launch");
  });

  it("keeps a signed-out /launch?levels=L1 as the OAuth next", () => {
    expect(launchSignInNext({})).toBe("/launch");
    expect(launchSignInNext({ levels: "L1", next: "/org/acme" })).toBe("/launch?next=%2Forg%2Facme&levels=L1");
  });
});

describe("FleetMap — triage lives in the /launch query string", () => {
  const installations = [
    { id: 1, login: "acme" },
    { id: 2, login: "globex" },
  ];

  beforeEach(() => nav.reset());
  afterEach(() => {
    vi.useRealTimers();
    nav.reset();
  });

  function mount(triage?: ReturnType<typeof parseLaunchTriage>) {
    return render(
      <FleetMap installations={installations} userName="Dana" next="/org/acme" triage={triage} />,
    );
  }

  function searchBox() {
    return screen.getByRole("searchbox", { name: "Filter repositories by name" });
  }

  it("restores the L1 band from /launch?levels=L1", () => {
    nav.setSearch("levels=L1");
    mount();
    expect(screen.getByRole("button", { name: "L1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "L2" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("round-trips q, levels, watched, and sort from the URL on mount", () => {
    nav.setSearch("q=pay&levels=L1,L5&watched=1&sort=maturity");
    mount();
    expect(searchBox()).toHaveValue("pay");
    expect(screen.getByRole("button", { name: "L1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "L5" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "L2" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("combobox")).toHaveValue("maturity");
  });

  it("writes levels via router.replace immediately", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "L1" }));
    expect(nav.replace).toHaveBeenCalledWith("/launch?levels=L1", { scroll: false });
    expect(screen.getByRole("button", { name: "L1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("debounces Find-a-repo into ?q= via router.replace", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.change(searchBox(), { target: { value: "payments" } });
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TRIAGE_QUERY_DEBOUNCE_MS - 1);
    });
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(nav.replace).toHaveBeenCalledWith("/launch?q=payments", { scroll: false });
  });

  it("writes watched and sort immediately", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(nav.replace).toHaveBeenCalledWith("/launch?watched=1", { scroll: false });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "repos" } });
    expect(nav.replace).toHaveBeenLastCalledWith("/launch?watched=1&sort=repos", { scroll: false });
  });

  it("restores L1 from the server-parsed triage prop when the live URL is empty", () => {
    mount(parseLaunchTriage({ levels: "L1" }));
    expect(screen.getByRole("button", { name: "L1" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles L1 off and drops the param", () => {
    nav.setSearch("levels=L1");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "L1" }));
    expect(nav.replace).toHaveBeenCalledWith("/launch", { scroll: false });
    expect(screen.getByRole("button", { name: "L1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears q/levels/watched while preserving ?next=", () => {
    nav.setSearch("next=%2Forg%2Facme&q=pay&levels=L1");
    mount();
    expect(searchBox()).toHaveValue("pay");
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(searchBox()).toHaveValue("");
    expect(nav.replace).toHaveBeenCalledWith("/launch?next=%2Forg%2Facme", { scroll: false });
  });

  it("restores a query from the URL on remount (the refresh case)", () => {
    nav.setSearch("q=payments");
    const { unmount } = mount();
    expect(searchBox()).toHaveValue("payments");
    unmount();
    mount();
    expect(searchBox()).toHaveValue("payments");
  });

  it("still sends Enter mission control through missionControlHref", () => {
    mount();
    expect(screen.getByRole("link", { name: /Enter mission control/ }).getAttribute("href")).toBe("/org/acme");
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
    expect(screen.getByRole("link").getAttribute("href")).toBe("/onboarding");
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
