import { describe, expect, it } from "vitest";
import { buildDeliveryOutcomes, restoreHours, MIN_DEPLOYMENTS, type DeploymentRow } from "./delivery-outcomes";

const dep = (over: Partial<DeploymentRow> = {}): DeploymentRow => ({
  repoFullName: "acme/web",
  environment: "production",
  sha: "aaa",
  state: "success",
  createdAt: new Date("2026-08-01T00:00:00Z"),
  statusAt: new Date("2026-08-01T00:05:00Z"),
  ...over,
});

/** N deployments on distinct shas, so each can be attributed independently. */
const many = (n: number, over: Partial<DeploymentRow> = {}) =>
  Array.from({ length: n }, (_, i) => dep({ sha: `sha${i}`, ...over }));

const build = (deployments: DeploymentRow[], ai: string[] = [], known: string[] = ai) =>
  buildDeliveryOutcomes({ deployments, aiShas: new Set(ai), knownShas: new Set(known) });

describe("change-failure rate", () => {
  it("counts failure and error states as failed deployments", () => {
    const rows = [...many(3), dep({ sha: "f1", state: "failure" }), dep({ sha: "f2", state: "error" })];
    const o = build(rows);
    expect(o.total).toBe(5);
    expect(o.failed).toBe(2);
    expect(o.failureRate).toBe(40);
  });

  // A 1-of-1 failure is not a 100% failure rate; it is one bad deploy. The floor stops a tiny sample
  // from producing a number an exec would repeat.
  it("withholds a rate below the sample floor rather than reporting a wild one", () => {
    const o = build([dep({ state: "failure" })]);
    expect(o.total).toBe(1);
    expect(o.failed).toBe(1);
    expect(o.failureRate).toBeNull();
  });

  it("reports a rate exactly at the floor", () => {
    expect(build(many(MIN_DEPLOYMENTS)).failureRate).toBe(0);
  });

  // A deployment with no status is stored as pending. It happened; we do not know how it ended.
  // Counting it as a success would understate failure; as a failure would invent one.
  it("counts a pending deployment in the denominator but not as a failure", () => {
    const o = build([...many(4), dep({ sha: "p", state: "pending" })]);
    expect(o.total).toBe(5);
    expect(o.failed).toBe(0);
    expect(o.failureRate).toBe(0);
  });
});

describe("attribution — an equality, never a guess", () => {
  it("attributes a deployment to the change whose merge sha it carries", () => {
    const o = build([dep({ sha: "abc" })], ["abc"], ["abc"]);
    expect(o.attributed).toBe(1);
    expect(o.unattributed).toBe(0);
    expect(o.coverage).toBe(100);
    expect(o.ai.deployments).toBe(1);
  });

  // Squash merges, merge trains, tag deploys and pre-W4 scans all land here. They must be EXCLUDED
  // from the split and COUNTED, not defaulted into the human bucket — which would silently
  // manufacture a human-authored population out of "we don't know".
  it("excludes an unmatched deployment from both buckets and counts it", () => {
    const o = build([dep({ sha: "unknown" })], ["abc"], ["abc"]);
    expect(o.attributed).toBe(0);
    expect(o.unattributed).toBe(1);
    expect(o.coverage).toBe(0);
    expect(o.ai.deployments).toBe(0);
    expect(o.human.deployments).toBe(0);
  });

  it("publishes coverage so a split over a thin slice can be judged", () => {
    const rows = [...many(3, {}), dep({ sha: "x1" }), dep({ sha: "x2" })];
    const o = build(rows, ["sha0"], ["sha0", "sha1", "sha2"]);
    expect(o.attributed).toBe(3);
    expect(o.unattributed).toBe(2);
    expect(o.coverage).toBe(60);
  });
});

describe("the authorship split", () => {
  const aiShas = Array.from({ length: 6 }, (_, i) => `ai${i}`);
  const humanShas = Array.from({ length: 6 }, (_, i) => `hu${i}`);
  const known = [...aiShas, ...humanShas];

  it("splits failure rate by whether the shipped change was AI-attributed", () => {
    const rows = [
      ...aiShas.map((sha, i) => dep({ sha, state: i < 3 ? "failure" : "success" })), // 3/6 = 50%
      ...humanShas.map((sha, i) => dep({ sha, state: i < 1 ? "failure" : "success" })), // 1/6 = 17%
    ];
    const o = build(rows, aiShas, known);
    expect(o.ai).toMatchObject({ deployments: 6, failed: 3, failureRate: 50 });
    expect(o.human).toMatchObject({ deployments: 6, failed: 1, failureRate: 17 });
    expect(o.failureRateGap).toBe(33);
  });

  // The gap is only meaningful when BOTH sides cleared the floor. One side unknown makes the
  // DIFFERENCE unknowable — which is not the same as zero, and an exec reading "0 points" would
  // conclude AI makes no difference.
  it("withholds the gap when either bucket is under the sample floor", () => {
    const rows = [
      ...aiShas.map((sha) => dep({ sha })),
      dep({ sha: "hu0", state: "failure" }), // one human deployment only
    ];
    const o = build(rows, aiShas, [...aiShas, "hu0"]);
    expect(o.ai.failureRate).toBe(0);
    expect(o.human.failureRate).toBeNull();
    expect(o.failureRateGap).toBeNull();
  });

  it("withholds the gap when neither side has a sample", () => {
    expect(build([dep({ sha: "zzz" })]).failureRateGap).toBeNull();
  });
});

describe("deployment frequency", () => {
  it("counts SUCCESSFUL deployments per week over the window's own span", () => {
    const rows = [
      dep({ sha: "a", createdAt: new Date("2026-08-01T00:00:00Z") }),
      dep({ sha: "b", createdAt: new Date("2026-08-08T00:00:00Z") }),
      dep({ sha: "c", createdAt: new Date("2026-08-15T00:00:00Z") }),
      dep({ sha: "d", createdAt: new Date("2026-08-15T00:00:00Z"), state: "failure" }),
    ];
    // 3 successes over a 2-week span.
    expect(build(rows).perWeek).toBe(1.5);
  });

  it("never divides by a sub-week span — a single day of deploys is not an infinite rate", () => {
    const o = build(many(3));
    expect(o.perWeek).toBe(3); // clamped to a 1-week minimum span
  });

  it("is null with no deployments at all", () => {
    expect(build([]).perWeek).toBeNull();
  });
});

describe("restoreHours — time to the NEXT SUCCESSFUL deployment", () => {
  it("measures from a failure to the next success in the same repo and environment", () => {
    const rows = [
      dep({ sha: "a", state: "failure", statusAt: new Date("2026-08-01T00:00:00Z"), createdAt: new Date("2026-08-01T00:00:00Z") }),
      dep({ sha: "b", state: "success", statusAt: new Date("2026-08-01T03:00:00Z"), createdAt: new Date("2026-08-01T02:00:00Z") }),
    ];
    expect(restoreHours(rows)).toBe(3);
  });

  // A burst of retries is ONE outage. Measuring from the last retry would flatter the number.
  it("measures from the FIRST failure of a run, not the last retry", () => {
    const rows = [
      dep({ sha: "a", state: "failure", createdAt: new Date("2026-08-01T00:00:00Z"), statusAt: new Date("2026-08-01T00:00:00Z") }),
      dep({ sha: "b", state: "failure", createdAt: new Date("2026-08-01T01:00:00Z"), statusAt: new Date("2026-08-01T01:00:00Z") }),
      dep({ sha: "c", state: "success", createdAt: new Date("2026-08-01T04:00:00Z"), statusAt: new Date("2026-08-01T04:00:00Z") }),
    ];
    expect(restoreHours(rows)).toBe(4);
  });

  it("does not pair a failure with a success in a DIFFERENT environment", () => {
    const rows = [
      dep({ sha: "a", environment: "production", state: "failure", createdAt: new Date("2026-08-01T00:00:00Z"), statusAt: new Date("2026-08-01T00:00:00Z") }),
      dep({ sha: "b", environment: "staging", state: "success", createdAt: new Date("2026-08-01T01:00:00Z"), statusAt: new Date("2026-08-01T01:00:00Z") }),
    ];
    expect(restoreHours(rows)).toBeNull();
  });

  // An unresolved failure has no duration yet. Assuming "still broken as of now" would let one
  // abandoned environment dominate the median.
  it("contributes nothing for a failure never followed by a success", () => {
    expect(restoreHours([dep({ state: "failure" })])).toBeNull();
  });

  it("takes the median across several outages", () => {
    const outage = (repo: string, startH: number, endH: number): DeploymentRow[] => [
      dep({ repoFullName: repo, sha: `${repo}f`, state: "failure", createdAt: new Date(`2026-08-01T0${startH}:00:00Z`), statusAt: new Date(`2026-08-01T0${startH}:00:00Z`) }),
      dep({ repoFullName: repo, sha: `${repo}s`, state: "success", createdAt: new Date(`2026-08-01T0${endH}:00:00Z`), statusAt: new Date(`2026-08-01T0${endH}:00:00Z`) }),
    ];
    // Gaps of 1h, 3h, 5h → median 3.
    expect(restoreHours([...outage("a/1", 1, 2), ...outage("a/2", 1, 4), ...outage("a/3", 1, 6)])).toBe(3);
  });
});

describe("empty and edge inputs", () => {
  it("builds an honest empty model", () => {
    const o = build([]);
    expect(o).toMatchObject({
      total: 0,
      failed: 0,
      failureRate: null,
      perWeek: null,
      medianRestoreHours: null,
      attributed: 0,
      unattributed: 0,
      coverage: null,
      failureRateGap: null,
      from: null,
      to: null,
    });
  });

  it("lists the environments it saw", () => {
    const o = build([dep({ sha: "a", environment: "production" }), dep({ sha: "b", environment: "staging" })]);
    expect(o.environments).toEqual(["production", "staging"]);
  });
});
