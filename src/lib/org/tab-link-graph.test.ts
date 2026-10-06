import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { nextMoveFor, ORG_TAB_STAGE } from "./orgJourney";
import { ORG_TAB_IDS, ORG_TABS_NOT_IN_NAV, type OrgTabId } from "./orgTabs";
import { buildTabLinkGraph, extractTabLinks, owningTab, stripComments, type SourceFile } from "./tab-link-graph";

const IDS: readonly string[] = ORG_TAB_IDS;

describe("extractTabLinks — every spelling of a tab link", () => {
  it("reads the helper, a local wrapper, a buildUrl tab switch, a hand-built ?tab= and a legacy route", () => {
    const src = [
      `const a = orgTabHref(slug, "security");`,
      `<Link href={tabHref(slug, "pairing")} />`,
      `buildUrl(slug, { tab: "surfaces", ...clearedTabScopedParams() }, "")`,
      "<Link href={`/org/${slug}?tab=followups&dim=${d}`} />",
      "<Link href={`/org/${encodeURIComponent(slug)}/integrations`} />",
    ].join("\n");
    expect(extractTabLinks(src, IDS)).toEqual({
      links: ["security", "pairing", "surfaces", "followups", "integrations"],
      dynamic: 0,
    });
  });

  // The seeded prose-only violation (AGENTS.md: strip comments before matching, and prove it). This
  // repo names, in a comment, the tab each component links to — that sentence is not a link.
  it("does not count a link that exists only in a comment", () => {
    const src = [
      `// links to orgTabHref(slug, "memory") once the panel ships`,
      `/* see \`?tab=audit\` and { tab: "members" } */`,
      `const x = 1;`,
    ].join("\n");
    expect(extractTabLinks(src, IDS).links).toEqual([]);
  });

  it("keeps a // inside a string, and keeps line breaks where a block comment was", () => {
    expect(stripComments(`const u = "https://x"; // gone`)).toBe(`const u = "https://x"; `);
    expect(stripComments("a /* one\ntwo */ b")).toBe("a \n b");
  });

  it("ignores API paths, non-ids and computed hrefs, and counts a non-literal helper call as dynamic", () => {
    const src = [
      "fetch(`/api/org/${slug}/registry/index`)",
      `orgTabHref(slug, "not-a-tab")`,
      "const tabHref = (slug: string, tab: string) => `/org/${slug}?tab=${tab}`;",
      `orgTabHref(slug, top.module)`,
    ].join("\n");
    expect(extractTabLinks(src, IDS)).toEqual({ links: [], dynamic: 1 });
  });
});

describe("owningTab", () => {
  it("maps a feature folder, the follow-ups ledger and the group-less developer home", () => {
    expect(owningTab("src/features/standing/security/SecurityTab.tsx", IDS)).toBe("security");
    expect(owningTab("src/features/standing/security/sub/Deep.tsx", IDS)).toBe("security");
    expect(owningTab("src/components/org/followups/FollowupsTab.tsx", IDS)).toBe("followups");
    expect(owningTab("src/features/developer/DeveloperHome.tsx", IDS)).toBe("developer");
    expect(owningTab("src/features/shared/athena/AthenaDrawer.tsx", IDS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The real tree. These pins are the measurement: when a tab gains or loses a sibling link this
// fails, and the edit that makes it pass is the number moving — shrink the list, don't widen it.
// ---------------------------------------------------------------------------------------------

function readTree(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
        files.push({ path: p.split(path.sep).join("/"), source: fs.readFileSync(p, "utf8") });
    }
  };
  for (const root of ["src/features", "src/components/org/followups"]) walk(root);
  return files;
}

/** The one literal a tab writes for its next move. The render-site check and the seeded removals share it. */
const NEXT_MOVE_SITE = (target: string) =>
  new RegExp(`<NextMoveLink href=\\{orgTabHref\\([\\w.]+, "${target}"\\)\\} to="${target}" />`, "g");

/** The tree with every next-move literal to `target` deleted from the files `tab` owns. */
function withoutLink(tree: readonly SourceFile[], tab: string, target: string): SourceFile[] {
  return tree.map((f) => (owningTab(f.path, IDS) === tab ? { ...f, source: f.source.replace(NEXT_MOVE_SITE(target), "") } : f));
}

/** Off-rail ids: `segments` is a view inside Repositories, `developer` hangs off the header menu. */
const OFF_RAIL = new Set<string>(ORG_TABS_NOT_IN_NAV);
/** Follow-ups is the designed hand-off point to a local agent; it ends the path on purpose. */
const DESIGNED_DEAD_ENDS = new Set(["followups"]);

/** Tabs whose only entrance is the rail. Measured 2026-09-19 on master 9cfc541c2: 9 (`lessons`, newly
 *  added and not yet cross-linked, replaces `registry`, which gained a sibling link since); shrunk to
 *  8 by ADR-0001 T2's "Repository admission" link (the credit-ceiling setup card links to
 *  `governance`), which drops `governance` out of the list. Org-path-of-use wave 1a: 8 -> 8 - its
 *  links point at `overview` and `proposals`, and neither is a member. Wave 1b: 8 -> 8 - its links
 *  point at `live` and `executive`, and neither is a member either. Wave 1c: 8 -> 8 - its links point
 *  at `repositories` and `overview`, and neither is a member. Inbound wave 1: 8 -> 5 - second-route
 *  sibling links `executive` -> `digest`, `overview` -> `tech-stacks` and `overview` -> `security` drop
 *  those three. */
const NO_INBOUND = ["passports", "lessons", "memory", "members", "audit"];
/** Tabs that link to no sibling, beyond the designed dead ends. Measured 2026-10-05: 6 (`lessons`
 *  replaced `surfaces`, which gained an outbound link; `practices` then gained one too - the sync
 *  strip's `registry` link added by d4552ffb, which left this pin stale and this suite red). Shrunk to
 *  5 by org-path-of-use wave 1a: the Read-stage next-move link to `proposals` drops `security`.
 *  Shrunk to 1 by wave 1b: the Decide-stage link to `live` drops `lessons` and `skills`, the
 *  Apply-stage link to `executive` drops `memory` and `audit`. Shrunk to 0 by wave 1c: the Connect-stage
 *  link to `repositories` drops `members`, the last one. Empty means every on-rail tab has an exit. */
const NO_OUTBOUND: string[] = [];

/**
 * Non-literal helper calls, each one a decision rather than an edge. Overview's Fix-first slot links
 * to whichever findings module is busiest (security, teams, passports, contributors or practices) —
 * a conditional edge the graph does not count (`passports` stays in NO_INBOUND; `security` left it
 * through the unconditional Overview link added by inbound wave 1). RepositoriesTab's is the
 * personal-workspace redirect to the default tab, not a link at all.
 */
const DYNAMIC_SITES = ["src/features/standing/overview/fixFirst.ts", "src/features/standing/repositories/RepositoriesTab.tsx"];

function gaps(files: readonly SourceFile[]) {
  const g = buildTabLinkGraph(files, IDS);
  const onRail = IDS.filter((id) => !OFF_RAIL.has(id));
  return {
    graph: g,
    noInbound: onRail.filter((id) => (g.inbound[id] ?? []).length === 0),
    noOutbound: onRail.filter((id) => (g.outbound[id] ?? []).length === 0 && !DESIGNED_DEAD_ENDS.has(id)),
  };
}

describe("the org cross-tab link graph", () => {
  const tree = readTree();

  it("pins the tabs with no inbound link from a sibling", () => {
    expect(gaps(tree).noInbound).toEqual(NO_INBOUND);
  });

  it("pins the tabs with no outbound link to a sibling", () => {
    expect(gaps(tree).noOutbound).toEqual(NO_OUTBOUND);
  });

  it("declares every non-literal tab link", () => {
    expect([...new Set(gaps(tree).graph.dynamic.map((d) => d.path))].sort()).toEqual(DYNAMIC_SITES);
  });

  it("the allowlists name real ids, and a declared dead end is not also counted as a gap", () => {
    for (const id of [...OFF_RAIL, ...DESIGNED_DEAD_ENDS, ...NO_INBOUND, ...NO_OUTBOUND]) expect(IDS).toContain(id);
    for (const id of DESIGNED_DEAD_ENDS) expect(NO_OUTBOUND).not.toContain(id);
  });

  // ADR item 4 / 98af2737: Follow-ups is the hand-off to a local agent, not a destination a sibling
  // sends you to, so nothing links to the `followups` alias. Seed-proved below.
  it("no tab links to the followups alias", () => {
    expect(gaps(tree).graph.inbound["followups"] ?? []).toEqual([]);
  });

  it("a seeded link to followups is noticed", () => {
    const seeded = [...tree, { path: "src/features/standing/overview/Seed.tsx", source: `orgTabHref(slug, "followups")` }];
    expect(gaps(seeded).graph.inbound["followups"]).toEqual(["overview"]);
  });

  // A matcher that stops matching reports a clean codebase in a voice indistinguishable from
  // success. NO_OUTBOUND is empty, so first delete members' only outbound link (it reappears as a gap),
  // then seed one new edge from it to audit and prove both lists shrink.
  it("a seeded edge moves both numbers: members regains an exit, audit gains an entrance", () => {
    const bare = withoutLink(tree, "members", "repositories");
    expect(gaps(bare).noOutbound).toEqual(["members"]);
    const seeded = [...bare, { path: "src/features/admin/members/Seed.tsx", source: `orgTabHref(slug, "audit")` }];
    const { noInbound, noOutbound } = gaps(seeded);
    expect(noInbound).not.toContain("audit");
    expect(noInbound).toHaveLength(NO_INBOUND.length - 1);
    expect(noOutbound).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Org path of use, journey B (docs/adr/2026-09-14-org-path-of-use.md): every tab in a wave's stages
// carries a link to its next move. The set is DERIVED from orgJourney, so a later wave widens it by
// adding a stage to WAVE_STAGES, not by listing tabs.
// ---------------------------------------------------------------------------------------------

/** Waves 1a + 1b + 1c: all six stages. 1a covered Read and Measure, 1b Decide and Apply, 1c the first-run
 *  stages Connect and Scan. Every on-rail tab is covered, so a new tab fails here until it is staged. */
const WAVE_STAGES = new Set(["connect", "scan", "read", "decide", "apply", "measure"]);

describe("journey next moves", () => {
  const tree = readTree();
  const graph = gaps(tree).graph;
  const waveTabs = (Object.keys(ORG_TAB_STAGE) as OrgTabId[]).filter((id) => WAVE_STAGES.has(ORG_TAB_STAGE[id]!));

  it("covers the twenty-six tabs of all six stages", () => {
    expect(waveTabs).toHaveLength(26);
  });

  it.each(waveTabs)("%s links to its next move", (tab) => {
    const target = nextMoveFor(tab);
    expect(target).toBeDefined();
    expect(graph.outbound[tab]).toContain(target);
  });

  // The edge alone is not enough for a tab with a second route to the same target: Tech Stacks' playbook
  // drill-in also lands on `proposals` (dim-scoped), so removing the next-move link would leave the
  // edge standing and the graph silent. Overview's own link predates NextMoveLink (verify-only).
  const PREDATES_NEXT_MOVE_LINK = new Set<string>(["overview"]);
  it.each(waveTabs.filter((t) => !PREDATES_NEXT_MOVE_LINK.has(t)))("%s renders a NextMoveLink to its next move", (tab) => {
    const target = nextMoveFor(tab);
    const rendered = tree.some((f) => owningTab(f.path, IDS) === tab && NEXT_MOVE_SITE(target!).test(stripComments(f.source)));
    expect(rendered).toBe(true);
  });

  it("a tab missing its link is noticed: seed the Measure tabs without theirs", () => {
    const stripped = tree.filter((f) => owningTab(f.path, IDS) !== "teams");
    expect(buildTabLinkGraph(stripped, IDS).outbound.teams).not.toContain("overview");
  });

  // Audit's next-move link is its only edge to `executive`, so deleting just that render site (not the
  // whole tab) must drop the edge from its outbound list: the graph notices a removed Apply link.
  it("an Apply tab missing its link is noticed: seed audit with its link removed", () => {
    const link = /<NextMoveLink href=\{orgTabHref\([\w.]+, "executive"\)\} to="executive" \/>/;
    const stripped = tree.map((f) => (owningTab(f.path, IDS) === "audit" ? { ...f, source: f.source.replace(link, "") } : f));
    expect(graph.outbound.audit).toContain("executive");
    expect(buildTabLinkGraph(stripped, IDS).outbound.audit ?? []).not.toContain("executive");
  });
});

// Wave 1c. The graph-level removal proofs: delete a tab's next-move literal (every composition of it)
// and its outbound list must lose the target. Only valid where the literal is the tab's ONLY edge to
// that target, which each case asserts first.
describe("journey first-run stages and Scan-entry links: a removed link is noticed", () => {
  const graph = gaps(readTree()).graph;
  const tree = readTree();
  const cases: [tab: string, target: string][] = [
    // Connect -> repositories
    ["registry", "repositories"],
    ["members", "repositories"],
    ["integrations", "repositories"],
    ["pairing", "repositories"],
    ["settings", "repositories"],
    // Scan -> overview. repositories is absent on purpose: its OrgEmpty "← Org overview" link is a second
    // route to the same tab, so removing the next-move literal leaves the edge standing and only the
    // render-site check above can see it.
    ["passports", "overview"],
    // Rule B's onward move: the empty-state link to the stage that fills the tab. Security only: Executive
    // has other routes to `repositories`, so it is proven by the literal count below.
    ["security", "repositories"],
  ];
  it.each(cases)("%s: removing its link to %s drops the edge", (tab, target) => {
    expect(graph.outbound[tab]).toContain(target);
    expect(buildTabLinkGraph(withoutLink(tree, tab, target), IDS).outbound[tab] ?? []).not.toContain(target);
  });

  it("a Connect tab missing its link is a no-outbound gap again", () => {
    expect(gaps(withoutLink(tree, "members", "repositories")).noOutbound).toEqual(["members"]);
  });

  // The empty-state literal counted per composition, so deleting just one of Executive's two (Altimeter
  // SectionEmpty, Prism executiveEmptyV2) is noticed even though the graph edge survives.
  it.each([["security", 1], ["executive", 2]] as const)("%s renders %i Scan-entry link(s) to repositories", (tab, count) => {
    const found = tree
      .filter((f) => owningTab(f.path, IDS) === tab)
      .reduce((n, f) => n + (stripComments(f.source).match(NEXT_MOVE_SITE("repositories")) ?? []).length, 0);
    expect(found).toBe(count);
  });

  // Rule B: the Scan-entry link sits in the EMPTY branch and the forward link in the data branch, so the
  // two are different targets and neither replaces the other.
  it("Security and Executive keep both a Scan-entry link and their own next move", () => {
    for (const tab of ["security", "executive"]) {
      expect(graph.outbound[tab]).toEqual(expect.arrayContaining(["repositories", nextMoveFor(tab as OrgTabId)]));
    }
  });
});

// A themed Connect tab renders its link in BOTH compositions (Altimeter v1, Prism v2). The render-site
// check above passes while either one still has it, so the per-file literal count is pinned here.
describe("themed Connect tabs carry the link in every composition", () => {
  const tree = readTree();
  const WHERE: [file: string, literals: number][] = [
    ["src/features/shared/registry/RegistryPanel.v1.tsx", 2], // the unmapped and the identified panel
    ["src/features/shared/registry/RegistryPanel.v2.tsx", 1],
    ["src/features/admin/integrations/IntegrationsTab.v1.tsx", 1],
    ["src/features/admin/integrations/IntegrationsView.v2.tsx", 1],
    ["src/features/admin/settings/SettingsTab.v1.tsx", 1],
    ["src/features/admin/settings/SettingsTab.v2.tsx", 1],
  ];
  it.each(WHERE)("%s renders %i next-move link(s) to repositories", (file, literals) => {
    const f = tree.find((x) => x.path === file);
    expect(f).toBeDefined();
    expect((stripComments(f!.source).match(NEXT_MOVE_SITE("repositories")) ?? []).length).toBe(literals);
  });
});
