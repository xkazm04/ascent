import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { ORG_TAB_IDS, ORG_TABS_NOT_IN_NAV } from "./orgTabs";
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

/** Off-rail ids: `segments` is a view inside Repositories, `developer` hangs off the header menu. */
const OFF_RAIL = new Set<string>(ORG_TABS_NOT_IN_NAV);
/** Follow-ups is the designed hand-off point to a local agent; it ends the path on purpose. */
const DESIGNED_DEAD_ENDS = new Set(["followups"]);

/** Tabs whose only entrance is the rail. Measured 2026-09-19 on master 9cfc541c2: 9 (`lessons`, newly
 *  added and not yet cross-linked, replaces `registry`, which gained a sibling link since); shrunk to
 *  8 by ADR-0001 T2's "Repository admission" link (the credit-ceiling setup card links to
 *  `governance`), which drops `governance` out of the list. */
const NO_INBOUND = ["digest", "tech-stacks", "passports", "lessons", "security", "memory", "members", "audit"];
/** Tabs that link to no sibling, beyond the designed dead ends. Measured 2026-09-19: 7 (`lessons`
 *  replaces `surfaces`, which gained an outbound link since). */
const NO_OUTBOUND = ["lessons", "security", "practices", "skills", "memory", "members", "audit"];

/**
 * Non-literal helper calls, each one a decision rather than an edge. Overview's Fix-first slot links
 * to whichever findings module is busiest (security, teams, passports, contributors or practices) —
 * a conditional edge, so `security` and `passports` stay in NO_INBOUND. RepositoriesTab's is the
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

  // A matcher that stops matching reports a clean codebase in a voice indistinguishable from
  // success. Seed one new edge into the real tree and prove both pins notice it.
  it("a seeded edge from audit to members moves both numbers", () => {
    const seeded = [...tree, { path: "src/features/admin/audit/Seed.tsx", source: `orgTabHref(slug, "members")` }];
    const { noInbound, noOutbound } = gaps(seeded);
    expect(noInbound).not.toContain("members");
    expect(noInbound).toHaveLength(NO_INBOUND.length - 1);
    expect(noOutbound).not.toContain("audit");
    expect(noOutbound).toHaveLength(NO_OUTBOUND.length - 1);
  });
});
