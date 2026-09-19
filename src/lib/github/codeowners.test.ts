import { describe, expect, it } from "vitest";
import {
  extractTeamOwnership,
  findCodeownersContent,
  parseCodeowners,
  teamDisplayName,
} from "@/lib/github/codeowners";

// These cover the pure CODEOWNERS → team parsing that feeds the org team rollups — no network, no DB.

describe("parseCodeowners", () => {
  it("extracts @org/team owners, counts owned rules, and flags the default (*) owner", () => {
    const content = `
# Default owners for everything
*               @acme/platform @acme/security

# Frontend
/web/           @acme/frontend
*.tsx           @acme/frontend

# Docs (also security reviews these)
/docs/          @acme/security
`;
    const teams = parseCodeowners(content);
    const bySlug = Object.fromEntries(teams.map((t) => [t.slug, t]));

    expect(bySlug["@acme/frontend"]).toEqual({ slug: "@acme/frontend", ownedPaths: 2, isDefaultOwner: false });
    expect(bySlug["@acme/security"]).toEqual({ slug: "@acme/security", ownedPaths: 2, isDefaultOwner: true });
    expect(bySlug["@acme/platform"]).toEqual({ slug: "@acme/platform", ownedPaths: 1, isDefaultOwner: true });
  });

  it("ignores @individual and email owners (teams only)", () => {
    const teams = parseCodeowners("*  @octocat docs@example.com @acme/team");
    expect(teams.map((t) => t.slug)).toEqual(["@acme/team"]);
  });

  it("skips comments, blank lines, and CODEOWNERS v2 section headers", () => {
    const content = `
# a comment
[Frontend]
^[Security]
/web/   @acme/frontend
`;
    const teams = parseCodeowners(content);
    expect(teams).toEqual([{ slug: "@acme/frontend", ownedPaths: 1, isDefaultOwner: false }]);
  });

  it("dedupes a team named twice on the same rule (counts the rule once)", () => {
    const teams = parseCodeowners("/web/  @acme/frontend @acme/frontend");
    expect(teams).toEqual([{ slug: "@acme/frontend", ownedPaths: 1, isDefaultOwner: false }]);
  });

  it("normalizes slugs to lowercase so casing variants merge", () => {
    const teams = parseCodeowners("/a/  @Acme/Frontend\n/b/  @acme/frontend");
    expect(teams).toEqual([{ slug: "@acme/frontend", ownedPaths: 2, isDefaultOwner: false }]);
  });

  it("ignores an unowned pattern (one with no owners)", () => {
    const teams = parseCodeowners("/generated/\n*  @acme/team");
    expect(teams).toEqual([{ slug: "@acme/team", ownedPaths: 1, isDefaultOwner: true }]);
  });

  it("sorts by owned-path count desc, then slug", () => {
    const teams = parseCodeowners("/a/ @acme/b\n/c/ @acme/b\n/d/ @acme/a");
    expect(teams.map((t) => t.slug)).toEqual(["@acme/b", "@acme/a"]);
  });

  it("returns nothing for an empty or owner-less file", () => {
    expect(parseCodeowners("")).toEqual([]);
    expect(parseCodeowners("# just comments\n\n")).toEqual([]);
  });
});

describe("findCodeownersContent / extractTeamOwnership", () => {
  it("finds CODEOWNERS in any of the three honored locations, case-insensitively", () => {
    expect(findCodeownersContent([{ path: "CODEOWNERS", content: "x" }])).toBe("x");
    expect(findCodeownersContent([{ path: ".github/CODEOWNERS", content: "y" }])).toBe("y");
    expect(findCodeownersContent([{ path: "docs/codeowners", content: "z" }])).toBe("z");
    expect(findCodeownersContent([{ path: "src/CODEOWNERS", content: "no" }])).toBeNull();
    expect(findCodeownersContent([{ path: "README.md", content: "no" }])).toBeNull();
  });

  // github-repo-data-access (2026-07-16) #3: when CODEOWNERS exists in more than one honored
  // location, GitHub applies `.github/` first, then root, then `docs/` — the array's fetch order
  // (source.ts lists root BEFORE .github/) must not decide which file wins, or a stale root copy
  // shadows the maintained `.github/` one during exactly the migration case where they disagree.
  it("resolves multiple locations in GitHub's precedence order (.github/ > root > docs/), not array order", () => {
    expect(
      findCodeownersContent([
        { path: "CODEOWNERS", content: "stale-root" }, // fetch rank lists root first
        { path: ".github/CODEOWNERS", content: "github-dir" },
        { path: "docs/CODEOWNERS", content: "docs-dir" },
      ]),
    ).toBe("github-dir");
    expect(
      findCodeownersContent([
        { path: "docs/CODEOWNERS", content: "docs-dir" },
        { path: "CODEOWNERS", content: "root" },
      ]),
    ).toBe("root");
    // Precedence changes the attribution end-to-end, not just the raw content pick.
    expect(
      extractTeamOwnership([
        { path: "CODEOWNERS", content: "*  @acme/old-team" },
        { path: ".github/CODEOWNERS", content: "*  @acme/new-team" },
      ]),
    ).toEqual([{ slug: "@acme/new-team", ownedPaths: 1, isDefaultOwner: true }]);
  });

  it("extractTeamOwnership returns [] when no CODEOWNERS file is present", () => {
    expect(extractTeamOwnership([{ path: "README.md", content: "*  @acme/team" }])).toEqual([]);
  });

  it("extractTeamOwnership parses the located CODEOWNERS file", () => {
    const teams = extractTeamOwnership([
      { path: "README.md", content: "ignore me" },
      { path: ".github/CODEOWNERS", content: "*  @acme/team" },
    ]);
    expect(teams).toEqual([{ slug: "@acme/team", ownedPaths: 1, isDefaultOwner: true }]);
  });
});

describe("teamDisplayName", () => {
  it("extracts the team segment of an @org/team slug", () => {
    expect(teamDisplayName("@acme/payments")).toBe("payments");
  });
});
