// @vitest-environment jsdom
//
// URL is the shareable half of launch triage (?q=&levels=&watched=&sort=).
// Split from fleetMapTriage.test.tsx so both stay under the 300-LOC .tsx cap.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FleetMap } from "./FleetMap";
import {
  EMPTY_LAUNCH_TRIAGE,
  TRIAGE_QUERY_DEBOUNCE_MS,
  launchSignInNext,
  launchTriageHref,
  parseLaunchTriage,
} from "./fleetMapDerive";

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
