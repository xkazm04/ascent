import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  buildOrgTabUrl,
  buildUrl,
  clearedTabScopedParams,
  DEFAULT_ORG_TAB,
  isMigratedOrgTab,
  isOrgTabId,
  legacyOrgTabPath,
  MIGRATED_ORG_TAB_IDS,
  ORG_NAV_GROUPS,
  ORG_TAB_IDS,
  ORG_TABS_NOT_IN_NAV,
  orgTabHref,
  orgTabLabel,
  PERSONAL_TAB_IDS,
  resolveActiveOrgTab,
  TAB_SCOPED_PARAM_KEYS,
  type OrgTabId,
} from "./orgTabs";

const navIds = ORG_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id));

describe("org tab catalog", () => {
  it("has no duplicate ids", () => {
    expect(new Set(ORG_TAB_IDS).size).toBe(ORG_TAB_IDS.length);
    expect(new Set(navIds).size).toBe(navIds.length);
  });

  it("every nav id is a real tab id", () => {
    for (const id of navIds) expect(isOrgTabId(id)).toBe(true);
  });

  // The bug this pins: an id in the guard but missing from the nav (or vice versa) makes a valid
  // deep link silently resolve to the default with no error.
  it("every tab id is either in the nav or explicitly listed as not-in-nav", () => {
    const inNav = new Set<string>(navIds);
    const orphans = ORG_TAB_IDS.filter((id) => !inNav.has(id) && !ORG_TABS_NOT_IN_NAV.has(id));
    expect(orphans).toEqual([]);
  });

  it("the not-in-nav list contains only real ids that are genuinely absent from the nav", () => {
    for (const id of ORG_TABS_NOT_IN_NAV) {
      expect(isOrgTabId(id)).toBe(true);
      expect(navIds).not.toContain(id);
    }
  });

  // W1a: the rail is grouped by the TRANSITION JOURNEY, not by data type. The order is the order of
  // the questions a transformation owner is asked, and it is load-bearing — reordering these is a
  // product decision, not a cosmetic one. See docs/AI-SDLC-COMPANION-PLAN.md §Wave 1.
  it("the nav groups are the journey sections, in rail order", () => {
    expect(ORG_NAV_GROUPS.map((g) => g.key)).toEqual(["standing", "shared", "inflight", "bought", "admin"]);
    expect(ORG_NAV_GROUPS.map((g) => g.label)).toEqual(["Standing", "Shared", "In flight", "Bought", "Admin"]);
  });

  // `shared` holds what the org publishes once and every repo consumes — the registry repo and the
  // three libraries it distributes. Governance (a reading of the fleet's controls) moved to Standing
  // and Developer left the nav entirely, so a stray id drifting back in fails here.
  it("scopes the Shared group to the registry and what it distributes", () => {
    const shared = ORG_NAV_GROUPS.find((g) => g.key === "shared");
    expect(shared?.items.map((i) => i.id)).toEqual(["registry", "practices", "skills", "memory", "knowledge"]);
  });

  // Governance is an audit of where the fleet stands, not something the org distributes: it is the
  // LAST item in Standing, after adoption.
  it("puts Governance last in Standing", () => {
    const standing = ORG_NAV_GROUPS.find((g) => g.key === "standing");
    expect(standing?.items.at(-1)?.id).toBe("governance");
    expect(standing?.items.at(-2)?.id).toBe("adoption");
  });

  // The loop is the product. It sat third-of-four inside a data-type group called "Fleet"; the
  // regroup exists largely to put it at the top of the smallest, most-visited section.
  it("puts Live first in the smallest group", () => {
    const inflight = ORG_NAV_GROUPS.find((g) => g.key === "inflight");
    expect(inflight?.items[0]?.id).toBe("live");
    const sizes = ORG_NAV_GROUPS.map((g) => g.items.length);
    expect(Math.min(...sizes)).toBe(inflight?.items.length);
  });

  // A personal workspace filters the SAME catalog (OrgTabNav drops empty groups). Pinned because a
  // regroup that stranded every personal tab in one section would silently flatten that rail.
  it("the personal subset still spans more than one journey section", () => {
    const sections = ORG_NAV_GROUPS.filter((g) => g.items.some((t) => PERSONAL_TAB_IDS.has(t.id)));
    expect(sections.length).toBeGreaterThan(1);
  });

  it("the default tab is a real id and is a rail item", () => {
    expect(isOrgTabId(DEFAULT_ORG_TAB)).toBe(true);
    expect(navIds).toContain(DEFAULT_ORG_TAB);
  });

  it("every personal-workspace tab is a real id", () => {
    for (const id of PERSONAL_TAB_IDS) expect(isOrgTabId(id)).toBe(true);
    // Mirrors OrgNav's old PERSONAL_SEGMENTS ("" was the overview root), plus `registry` (a personal
    // workspace gets the same layout against `<user>/ai-registry`, REGISTRY-AND-CARE-IMPL §1) and
    // `developer` (UC3's home is the one surface a personal workspace exists FOR — kept in the SET
    // even though it left the rail, so a gate asking "is this a personal surface?" still says yes).
    expect([...PERSONAL_TAB_IDS].sort()).toEqual([
      "developer",
      "followups",
      // Reference the registry publishes; identical for a personal workspace because it carries no
      // per-repo adoption state — that absence is what keeps the fleet surfaces org-only.
      "knowledge",
      "memory",
      "overview",
      "registry",
      "security",
      "skills",
    ]);
  });

  // Developer is reachable only from the header identity menu, so it is deliberately not-in-nav. The
  // completeness test above would otherwise read its absence as "forgotten".
  it("keeps `developer` a real id that is reachable outside the rail", () => {
    expect(isOrgTabId("developer")).toBe(true);
    expect(ORG_TABS_NOT_IN_NAV.has("developer")).toBe(true);
    expect(navIds).not.toContain("developer");
    expect(orgTabLabel("developer")).toBe("Developer");
    expect(orgTabHref("acme", "developer")).toBe("/org/developer?org=acme");
  });

  it("every migrated tab is a real id", () => {
    for (const id of MIGRATED_ORG_TAB_IDS) expect(isOrgTabId(id)).toBe(true);
  });

  it("labels every id", () => {
    for (const id of ORG_TAB_IDS) expect(orgTabLabel(id)).toBeTruthy();
    expect(orgTabLabel("tech-stacks")).toBe("Tech Stacks");
    expect(orgTabLabel("executive")).toBe("Briefing");
  });
});

describe("isOrgTabId", () => {
  it("accepts real ids and rejects everything else", () => {
    expect(isOrgTabId("audit")).toBe(true);
    expect(isOrgTabId("nope")).toBe(false);
    expect(isOrgTabId(null)).toBe(false);
    expect(isOrgTabId(undefined)).toBe(false);
    expect(isOrgTabId("")).toBe(false);
    // Set.has on a prototype key must not report true.
    expect(isOrgTabId("toString")).toBe(false);
  });
});

describe("buildUrl", () => {
  it("patches the tracked search string rather than replacing it", () => {
    expect(buildUrl("acme", { tab: "audit" }, "range=90d")).toBe("/org/acme?range=90d&tab=audit");
  });

  it("clears a key on null or empty string", () => {
    expect(buildUrl("acme", { repo: null }, "repo=a&range=90d")).toBe("/org/acme?range=90d");
    expect(buildUrl("acme", { repo: "" }, "repo=a")).toBe("/org/acme");
  });

  // W1b REVERSED the old "normalizes the default tab away" behaviour. The bare /org/<slug> is the
  // org's LANDING decision (which may be Live), so collapsing ?tab=overview into it would make
  // Overview unreachable: rail click → bare URL → landing → Live, forever.
  it("keeps ?tab=overview explicit rather than collapsing it to the bare URL", () => {
    expect(buildUrl("acme", { tab: "overview" }, "")).toBe("/org/acme?tab=overview");
    expect(buildUrl("acme", { tab: "overview" }, "range=90d")).toBe("/org/acme?range=90d&tab=overview");
  });

  it("still produces the bare URL when no tab is set at all", () => {
    expect(buildUrl("acme", {}, "")).toBe("/org/acme");
    expect(buildUrl("acme", { tab: null }, "tab=audit")).toBe("/org/acme");
  });

  it("encodes the slug", () => {
    expect(buildUrl("a b", {}, "")).toBe("/org/a%20b");
  });
});

describe("buildOrgTabUrl", () => {
  it("clears every tab-scoped param", () => {
    const url = buildOrgTabUrl("acme", "audit", "repo=x&q=y&credits=pending&cursor=abc");
    expect(url).toBe("/org/acme?tab=audit");
  });

  // Gotcha #7: the period/window is deliberately cross-tab state (resolveOrgWindow reads ?range=
  // then the cookie). Putting `range` in TAB_SCOPED_PARAM_KEYS would silently reset the user's
  // selected window on every tab click.
  it("carries the period and scope params across a tab switch", () => {
    const url = buildOrgTabUrl("acme", "security", "range=90d&from=2026-01-01&to=2026-02-01&segment=s1&stack=go&techGroup=g1");
    expect(url).toContain("range=90d");
    expect(url).toContain("from=2026-01-01");
    expect(url).toContain("to=2026-02-01");
    expect(url).toContain("segment=s1");
    expect(url).toContain("stack=go");
    expect(url).toContain("techGroup=g1");
    expect(url).toContain("tab=security");
  });

  // W1b: switching to Overview is now an EXPLICIT destination, not a return to the bare URL.
  it("switching back to Overview names it explicitly", () => {
    // `tab` was already present, so URLSearchParams.set replaces it in place — hence tab-first here.
    expect(buildOrgTabUrl("acme", "overview", "tab=audit&range=90d")).toBe("/org/acme?tab=overview&range=90d");
  });
});

describe("resolveActiveOrgTab", () => {
  it("reads the ?tab= param on the shell route", () => {
    expect(resolveActiveOrgTab("/org/acme", "security")).toBe("security");
  });

  it("keeps a legacy drill-in route's tab lit", () => {
    expect(resolveActiveOrgTab("/org/acme/audit", null)).toBe("audit");
  });

  it("falls back to the default when nothing valid is present", () => {
    expect(resolveActiveOrgTab("/org/acme", null)).toBe(DEFAULT_ORG_TAB);
    expect(resolveActiveOrgTab("/org/acme", "not-a-tab")).toBe(DEFAULT_ORG_TAB);
  });

  // W1b: the shell threads the org's resolved LANDING tab in as the fallback, so the rail lights the
  // panel the page actually rendered. Without this the rail said "Overview" while the content slot
  // showed Live — the exact drift resolveActiveOrgTab exists to prevent.
  it("honors the landing tab as the fallback when the shell supplies one", () => {
    expect(resolveActiveOrgTab("/org/acme", null, "live")).toBe("live");
    expect(resolveActiveOrgTab("/org/acme", "not-a-tab", "live")).toBe("live");
  });

  it("an explicit ?tab= always beats the landing fallback", () => {
    expect(resolveActiveOrgTab("/org/acme", "overview", "live")).toBe("overview");
  });

  // §5.1 — `/org/developer` is a STATIC route (it wins over `/org/[slug]`), so the rail must light
  // "Developer" there even though the URL carries neither a tab segment nor `?tab=`. A path one level
  // deeper is a normal org slug again and must NOT be captured by this branch.
  it("lights Developer on the personalized route", () => {
    expect(resolveActiveOrgTab("/org/developer", null)).toBe("developer");
    expect(resolveActiveOrgTab("/org/developer", null, "live")).toBe("developer");
    expect(resolveActiveOrgTab("/org/developer/audit", null)).toBe("audit");
  });
});

describe("TAB_SCOPED_PARAM_KEYS", () => {
  // Pinned so adding a deep-link param is a deliberate, reviewed edit rather than a silent leak.
  it("is the exact expected set", () => {
    expect([...TAB_SCOPED_PARAM_KEYS]).toEqual([
      "repo",
      "dim",
      "seg",
      "id",
      "edit",
      "a",
      "b",
      "q",
      "search",
      "posture",
      "kind",
      "category",
      "namespace",
      "includeClosed",
      "actorId",
      "action",
      "since",
      "until",
      "cursor",
      "credits",
    ]);
  });

  it("never contains the cross-tab period or scope params", () => {
    for (const key of ["range", "from", "to", "segment", "stack", "techGroup", "tab"]) {
      expect(TAB_SCOPED_PARAM_KEYS).not.toContain(key);
    }
  });

  it("clearedTabScopedParams nulls exactly those keys", () => {
    const cleared = clearedTabScopedParams();
    expect(Object.keys(cleared).sort()).toEqual([...TAB_SCOPED_PARAM_KEYS].sort());
    expect(Object.values(cleared).every((v) => v === null)).toBe(true);
  });
});

describe("orgTabHref", () => {
  it("points a migrated tab at the ?tab= shell", () => {
    expect(orgTabHref("acme", "audit")).toBe("/org/acme?tab=audit");
  });

  // Regression pin: pairing was born as a ?tab= panel and has NO legacy route — omitting it from
  // MIGRATED_ORG_TAB_IDS sent the rail to /org/<slug>/pairing, a page that has never existed.
  it("points pairing at the ?tab= shell (it never had a legacy route)", () => {
    expect(orgTabHref("acme", "pairing")).toBe("/org/acme?tab=pairing");
  });

  // W1b: Overview is an explicit destination. The bare /org/acme is the LANDING url, and a link
  // labelled "Overview" that lands you on Live is exactly the bug this prevents — including on a
  // middle-click, where the rail's href (not its onSelect) is what the browser follows.
  it("points Overview at its own explicit tab url, not the bare org root", () => {
    expect(orgTabHref("acme", "overview")).toBe("/org/acme?tab=overview");
  });

  it("points an un-migrated tab at its legacy route", () => {
    const unmigrated = ORG_TAB_IDS.find((id) => !isMigratedOrgTab(id) && id !== "developer");
    // Every id except `developer` has now migrated into the `?tab=` shell, so this only asserts
    // anything while one is left behind. Kept (rather than deleted) so re-adding a legacy tab is
    // covered again the moment it happens.
    if (unmigrated) expect(orgTabHref("acme", unmigrated)).toBe(`/org/acme/${unmigrated}`);
  });

  // §5.1 — `developer` is a rail item but NOT a `?tab=` panel: it is the personalized route, with the
  // org carried as a query param. Both helpers must agree, because 58 link sites reach for one or the
  // other and `/org/<slug>/developer` is only a redirect stub.
  it("points `developer` at the personalized route with the org as a param", () => {
    expect(orgTabHref("acme", "developer")).toBe("/org/developer?org=acme");
    expect(legacyOrgTabPath("acme", "developer")).toBe("/org/developer?org=acme");
    expect(orgTabHref("acme corp/x", "developer")).toBe(`/org/developer?org=${encodeURIComponent("acme corp/x")}`);
  });

  it("agrees with legacyOrgTabPath for every un-migrated tab", () => {
    for (const id of ORG_TAB_IDS) {
      if (isMigratedOrgTab(id)) continue;
      expect(orgTabHref("acme", id)).toBe(legacyOrgTabPath("acme", id));
    }
  });

  // The seam's one real hazard, and the bug it shipped: a tab whose panel IS registered in
  // OrgTabChunks but whose id was never added to MIGRATED_ORG_TAB_IDS. Nothing above catches that —
  // the href helpers happily agree on `/org/<slug>/<id>` — but the page redirects `?tab=<id>` to
  // that path, and for a tab born inside the shell no such route exists, so the rail link 404s and
  // the panel never renders. `knowledge` shipped exactly this way. An un-migrated tab must own a
  // real legacy route directory; `developer` is exempt (its legacy path is the static
  // /org/developer route, asserted above).
  it("gives every un-migrated tab a real legacy route to redirect to", () => {
    const appDir = path.join(process.cwd(), "src", "app", "org", "[slug]");
    for (const id of ORG_TAB_IDS) {
      if (isMigratedOrgTab(id) || id === "developer") continue;
      expect(
        fs.existsSync(path.join(appDir, id, "page.tsx")),
        `un-migrated tab "${id}" has no src/app/org/[slug]/${id}/page.tsx to redirect to — ` +
          `add it to MIGRATED_ORG_TAB_IDS if its panel is registered in OrgTabChunks`,
      ).toBe(true);
    }
  });
});
