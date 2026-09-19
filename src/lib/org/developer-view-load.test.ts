// The Developer home's server loader, with the three db readers it consumes mocked.
//
// The case this file exists for: `myRepos[i].level`/`.score` were hardcoded null, so the Standing
// column of "My repos' gaps" rendered "—" for every repo in the live product no matter how many scans
// the org had. These tests pin the populated path AND both honest-null paths, because the value of
// the column is that a "—" means "never scanned", not "we didn't look".

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getContributorInsights, getOrgBacklog, getRepoStates } = vi.hoisted(() => ({
  getContributorInsights: vi.fn(),
  getOrgBacklog: vi.fn(),
  getRepoStates: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ getContributorInsights, getOrgBacklog, getRepoStates }));

import { getDeveloperView } from "./developer-view-load";

/** The only fields of the contributor snapshot this loader reads. */
function insights(repoNames: string[]) {
  return {
    totalContributors: 8,
    contributors: [
      {
        login: "Ada",
        commits: 40,
        aiCommits: 10,
        aiShare: 25,
        repos: repoNames.length,
        lastActiveAt: "2026-09-01T00:00:00.000Z",
        repoNames,
      },
    ],
    champions: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getContributorInsights.mockResolvedValue(insights(["acme/scanned", "acme/never-scanned"]));
  getOrgBacklog.mockResolvedValue({
    byOwner: [{ items: [{ repo: "acme/scanned", title: "Add CLAUDE.md", dimId: "D1" }] }],
  });
  getRepoStates.mockResolvedValue({
    "acme/scanned": { watched: true, scanSchedule: "weekly", level: "L3", overall: 62 },
    // Present in the org but never scanned: the state row exists, the latest scan does not.
    "acme/never-scanned": { watched: true, scanSchedule: "off", level: null, overall: null },
  });
});

describe("getDeveloperView — the Standing column", () => {
  it("populates level and score from the repo states of a scanned repo", async () => {
    const view = await getDeveloperView("ada", "acme");
    const scanned = view.myRepos.find((r) => r.fullName === "acme/scanned");
    expect(scanned).toMatchObject({ level: "L3", score: 62 });
    // The gaps half is untouched by the new read.
    expect(scanned?.openRecommendations).toEqual([{ title: "Add CLAUDE.md", dimension: "D1" }]);
  });

  it("leaves a repo with no latest scan at null, so the mark renders an honest em-dash", async () => {
    const view = await getDeveloperView("ada", "acme");
    expect(view.myRepos.find((r) => r.fullName === "acme/never-scanned")).toMatchObject({
      level: null,
      score: null,
    });
  });

  it("leaves a repo the states read does not know about at null", async () => {
    // A repo the contributor snapshot names but the repository table has no row for (renamed,
    // deleted, or scanned under another org). Never guessed.
    getRepoStates.mockResolvedValue({});
    const view = await getDeveloperView("ada", "acme");
    expect(view.myRepos.map((r) => [r.level, r.score])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it("is best-effort: a failing states read leaves nulls and still returns the rest of the view", async () => {
    getRepoStates.mockRejectedValue(new Error("db down"));
    const view = await getDeveloperView("ada", "acme");
    expect(view.myRepos).toHaveLength(2);
    expect(view.myRepos.every((r) => r.level === null && r.score === null)).toBe(true);
    // The activity half and the gaps still rendered — the standing failure degrades one column only.
    expect(view.activity?.commits).toBe(40);
    expect(view.myRepos[0].openRecommendations).toHaveLength(1);
  });

  it("issues no reads at all when nobody is signed in", async () => {
    const view = await getDeveloperView(null, "acme");
    expect(view.myRepos).toEqual([]);
    expect(getRepoStates).not.toHaveBeenCalled();
    expect(getContributorInsights).not.toHaveBeenCalled();
  });

  it("does not read repo states for a login the snapshot has no row for", async () => {
    // Below the naming floor the producer withholds every per-person row; there are then no repos to
    // put a standing against, so the extra query must not be issued.
    getContributorInsights.mockResolvedValue({ totalContributors: 2, contributors: [], champions: [], namingAllowed: false });
    const view = await getDeveloperView("ada", "acme");
    expect(view.activity).toBeNull();
    expect(view.myRepos).toEqual([]);
    expect(getRepoStates).not.toHaveBeenCalled();
  });
});

// ── WHY `activity` is null (the Developer page encodes each of these differently) ─────────────────
//
// `activity: null` carried four unrelated facts and the page narrated all four with one paragraph.
// The worst pairing: a SUPPRESSED row (the workspace is under the naming floor, so the producer
// withheld the developer's own numbers) read exactly like "you have never committed here". These pin
// the four apart at the source, because a UI cannot encode a distinction the loader did not make.
describe("getDeveloperView — activityState", () => {
  it("is `measured` when the snapshot carries this login", async () => {
    const view = await getDeveloperView("ada", "acme");
    expect(view.activityState).toBe("measured");
  });

  it("is `withheld` when the producer suppressed every per-person row", async () => {
    getContributorInsights.mockResolvedValue({ totalContributors: 2, contributors: [], champions: [], namingAllowed: false });
    const view = await getDeveloperView("ada", "acme");
    expect(view.activityState).toBe("withheld");
  });

  it("is `absent` when naming was allowed and this login is simply not in the snapshot", async () => {
    getContributorInsights.mockResolvedValue({ totalContributors: 8, contributors: [], champions: [], namingAllowed: true });
    const view = await getDeveloperView("ada", "acme");
    expect(view.activityState).toBe("absent");
  });

  it("is `unreadable` when the snapshot read failed — not an absence of the developer", async () => {
    getContributorInsights.mockRejectedValue(new Error("db down"));
    const view = await getDeveloperView("ada", "acme");
    expect(view.activityState).toBe("unreadable");
  });

  it("is `signed-out` when nobody is signed in", async () => {
    const view = await getDeveloperView(null, "acme");
    expect(view.activityState).toBe("signed-out");
  });
});
