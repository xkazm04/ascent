import { describe, it, expect } from "vitest";

// The Practice Library headline is a PURE fold over data the page already has (getOrgPractices +
// listPlaybooks + getPlaybookAdoption) — no db boundary to mock. These pin the three things a lead
// reads off the tiles and pastes into an LLM: the numbers, the brief's SHAPE (same section grammar as
// governanceMarkdown / adoptionMarkdown, closing in an exploration-voice Ask), and — the honesty
// property — clean degradation when the optional per-practice `prs` projection is absent or empty.

import { buildPracticeLibrarySummary, practiceLibraryMarkdown } from "./practice-library";
import type { OrgPractice, PlaybookRow, PlaybookAdoption } from "@/lib/db";

const practice = (o: Partial<OrgPractice> & { id: string }): OrgPractice => ({
  label: `Practice ${o.id}`,
  dimId: "D1",
  what: "do the thing",
  starter: [],
  total: 4,
  strongCount: 1,
  exemplar: { name: "app", fullName: "acme/app", score: 82 },
  gapRepos: ["api"],
  gapRepoRefs: [{ name: "api", fullName: "acme/api" }],
  ...o,
});

const playbook = (o: Partial<PlaybookRow> & { id: string }): PlaybookRow => ({
  title: `Playbook ${o.id}`,
  dimId: "D3",
  summary: "our standard",
  steps: [],
  createdBy: null,
  createdAt: "2026-01-01",
  version: 1,
  updatedAt: "2026-01-01",
  ...o,
});

const adopted = (repos: number, lift: number | null = null): PlaybookAdoption => ({
  repos,
  appliedRepos: [],
  lift,
  measured: lift == null ? 0 : repos,
});

describe("buildPracticeLibrarySummary", () => {
  it("counts the library, the repo·practice adoption rate, and the DISTINCT repos that could adopt", () => {
    const s = buildPracticeLibrarySummary(
      "acme",
      [
        practice({ id: "a", total: 4, strongCount: 3, gapRepoRefs: [{ name: "api", fullName: "acme/api" }], gapRepos: ["api"] }),
        practice({
          id: "b",
          total: 4,
          strongCount: 1,
          // "acme/api" repeats — a repo lagging on TWO practices is still ONE repo that could adopt.
          gapRepoRefs: [
            { name: "api", fullName: "acme/api" },
            { name: "web", fullName: "acme/web" },
          ],
          gapRepos: ["api", "web"],
        }),
      ],
      [playbook({ id: "p1" })],
      { p1: adopted(2) },
    );

    expect(s.total).toBe(3);
    expect(s.mined).toBe(2);
    expect(s.authored).toBe(1);
    expect(s.adoption).toEqual({ strong: 4, measured: 8, pct: 50 });
    expect(s.couldAdopt).toEqual({ repos: 2, practices: 2 });
  });

  it("reports adoption as null (not 0%) when nothing is scored yet", () => {
    const s = buildPracticeLibrarySummary("acme", [practice({ id: "a", total: 0, strongCount: 0, gapRepoRefs: [], gapRepos: [] })], [], {});
    expect(s.adoption).toBeNull();
    expect(s.couldAdopt).toEqual({ repos: 0, practices: 0 });
  });

  it("folds the optional starter-PR projection and averages only the MEASURED lifts", () => {
    const s = buildPracticeLibrarySummary(
      "acme",
      [
        practice({ id: "a", prs: { open: 2, merged: 1, lift: 10 } }),
        practice({ id: "b", prs: { open: 1, merged: 3, lift: 20 } }),
        practice({ id: "c", prs: { open: 0, merged: 1, lift: null } }), // awaiting rescan — must not drag toward 0
      ],
      [],
      {},
    );
    expect(s.rollout).toEqual({ open: 3, merged: 5, lift: 15, liftPractices: 2 });
  });

  it("orders authored standards by reach, most-adopted first", () => {
    const s = buildPracticeLibrarySummary("acme", [], [playbook({ id: "p1" }), playbook({ id: "p2" })], {
      p1: adopted(1),
      p2: adopted(5, 7),
    });
    expect(s.standards.map((x) => x.id)).toEqual(["p2", "p1"]);
    expect(s.standards[0]!.lift).toBe(7);
  });
});

describe("practiceLibraryMarkdown", () => {
  const full = () =>
    buildPracticeLibrarySummary(
      "acme",
      [practice({ id: "a", label: "CI gates", prs: { open: 2, merged: 1, lift: 9 } })],
      [playbook({ id: "p1", title: "Review charter" })],
      { p1: adopted(3, 4) },
    );

  it("mirrors the governance/adoption brief shape and closes in an Ask", () => {
    const md = practiceLibraryMarkdown(full());
    expect(md.startsWith("# Practice library: acme\nGenerated ")).toBe(true);
    expect(md).toContain("## Library");
    expect(md).toContain("## Rollout (starter PRs)");
    expect(md).toContain("## Widest reuse gaps");
    expect(md).toContain("## Org-authored standards");
    // The Ask is the LAST section — everything above it is evidence.
    expect(md.lastIndexOf("## Ask")).toBeGreaterThan(md.lastIndexOf("## Org-authored standards"));
    expect(md.trimEnd().endsWith("Surface the questions worth taking to the teams before proposing any change.")).toBe(true);
  });

  it("keeps the Ask in EXPLORATION voice — inputs to weigh, never orders", () => {
    const ask = practiceLibraryMarkdown(full()).split("## Ask")[1]!;
    expect(ask).toContain("inputs to explore, not a work queue");
    // No imperative task-assignment verbs that would turn the brief into a directive.
    for (const order of ["Propose the 3", "Prioritize repos", "Apply this", "Open a pull request"]) {
      expect(ask).not.toContain(order);
    }
  });

  it("carries the real numbers, including the rollout line", () => {
    const md = practiceLibraryMarkdown(full());
    expect(md).toContain("2 practices: 1 org-authored standard · 1 mined from scans");
    expect(md).toContain("- 2 in flight · 1 landed · +9 avg measured dimension lift across 1 practice");
    expect(md).toContain("CI gates (D1): 1 repo below the bar · acme/app already does it · 2 starter PRs open");
    expect(md).toContain("Review charter (D3): adopted by 3 repos · +4 avg D3 since");
  });

  it("degrades cleanly when the PR projection is absent — no zeroed rollout section", () => {
    // getOrgPractices omits `prs` entirely for a practice never applied in this org.
    const s = buildPracticeLibrarySummary("acme", [practice({ id: "a", label: "CI gates" })], [], {});
    expect(s.rollout).toBeNull();
    const md = practiceLibraryMarkdown(s);
    expect(md).not.toContain("## Rollout");
    expect(md).not.toContain("in flight");
    // …and the gap line drops the starter-PR clause rather than printing "0 starter PRs open".
    expect(md).toContain("CI gates (D1): 1 repo below the bar · acme/app already does it");
    expect(md).not.toContain("starter PR");
    expect(md).toContain("## Ask");
  });

  it("says so when adoption is unmeasurable, and when a gap has no exemplar to copy", () => {
    const s = buildPracticeLibrarySummary(
      "acme",
      [practice({ id: "a", total: 0, strongCount: 0, exemplar: null })],
      [],
      {},
    );
    expect(practiceLibraryMarkdown(s)).toContain("Fleet adoption: not measurable yet");
    expect(practiceLibraryMarkdown(s)).toContain("no exemplar in the fleet yet");
  });
});
