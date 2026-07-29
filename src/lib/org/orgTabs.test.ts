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

  it("the six nav groups are the six module groups, in rail order", () => {
    expect(ORG_NAV_GROUPS.map((g) => g.key)).toEqual([
      "overview",
      "fleet",
      "intelligence",
      "plan",
      "library",
      "govern",
    ]);
  });

  it("the default tab is a real id and is a rail item", () => {
    expect(isOrgTabId(DEFAULT_ORG_TAB)).toBe(true);
    expect(navIds).toContain(DEFAULT_ORG_TAB);
  });

  it("every personal-workspace tab is a real id", () => {
    for (const id of PERSONAL_TAB_IDS) expect(isOrgTabId(id)).toBe(true);
    // Mirrors OrgNav's old PERSONAL_SEGMENTS exactly ("" was the overview root).
    expect([...PERSONAL_TAB_IDS].sort()).toEqual(["backlog", "memory", "overview", "security", "skills"]);
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

  it("normalizes the default tab away", () => {
    expect(buildUrl("acme", { tab: "overview" }, "")).toBe("/org/acme");
    expect(buildUrl("acme", { tab: "overview" }, "range=90d")).toBe("/org/acme?range=90d");
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

  it("switching back to the default drops the tab param", () => {
    expect(buildOrgTabUrl("acme", "overview", "tab=audit&range=90d")).toBe("/org/acme?range=90d");
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

  it("points the default tab at the bare org root", () => {
    expect(orgTabHref("acme", "overview")).toBe("/org/acme");
  });

  it("points an un-migrated tab at its legacy route", () => {
    const unmigrated = ORG_TAB_IDS.find((id) => !isMigratedOrgTab(id)) as OrgTabId;
    expect(orgTabHref("acme", unmigrated)).toBe(`/org/acme/${unmigrated}`);
  });

  it("agrees with legacyOrgTabPath for every un-migrated tab", () => {
    for (const id of ORG_TAB_IDS) {
      if (isMigratedOrgTab(id)) continue;
      expect(orgTabHref("acme", id)).toBe(legacyOrgTabPath("acme", id));
    }
  });
});
