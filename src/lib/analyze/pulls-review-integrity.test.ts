// Review integrity + the qualified rate book that summarizePullRequests publishes.
//
// Three things are pinned here:
//   1. every rate the analyzer publishes travels with its denominator, exclusions, sample floor and
//      (for the AI signal) channel precision — the qualifier is inseparable from the figure;
//   2. self-approvals are counted beside review coverage, with bot/AI-app approvals excluded;
//   3. approvals landing within FAST_APPROVAL_MAX_MINUTES of opening are surfaced separately from
//      coverage, behind the same >= 5 sample floor and never over a 3-PR sample.

import { describe, it, expect } from "vitest";
import { summarizePullRequests } from "./pulls";
import { FAST_APPROVAL_MAX_MINUTES, rateBasisText, ratePercent } from "./pr-thresholds";
import type { PrNode } from "@/lib/github/graphql";

const OPENED = "2026-01-01T00:00:00Z";
/** `minutes` after OPENED, as an ISO timestamp. */
const after = (minutes: number) => new Date(Date.parse(OPENED) + minutes * 60_000).toISOString();

type Review = { state: string; submittedAt: string | null; author: { login: string; __typename?: string } | null };
const review = (login: string | null, submittedAt: string | null, typename = "User", state = "APPROVED"): Review => ({
  state,
  submittedAt,
  author: login ? { login, __typename: typename } : null,
});

function merged(number: number, over: Partial<PrNode> = {}, reviews: Review[] = []): PrNode {
  return {
    number,
    title: "feat: thing",
    bodyText: "",
    isDraft: false,
    state: "MERGED",
    createdAt: OPENED,
    mergedAt: "2026-01-02T00:00:00Z",
    closedAt: null,
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    author: { login: "alice", __typename: "User" },
    labels: { nodes: [] },
    reviews: { totalCount: reviews.length, nodes: reviews },
    comments: { totalCount: 0 },
    ...over,
  };
}

/** Five human-authored merged PRs — the minimum sample every review rate here demands. */
const fiveApproved = (reviewsFor: (n: number) => Review[]) =>
  [1, 2, 3, 4, 5].map((n) => merged(n, { author: { login: `dev${n}`, __typename: "User" } }, reviewsFor(n)));

describe("summarizePullRequests — the qualified rate book (item 12)", () => {
  it("publishes each rate with the numerator and denominator that produced it", () => {
    const nodes = [
      merged(1, { additions: 5, deletions: 5 }),
      merged(2, { additions: 500, deletions: 500 }),
      merged(3, { author: { login: "dependabot[bot]", __typename: "Bot" } }),
      merged(4, { title: 'Revert "feat: thing"' }),
    ];
    const { rates } = summarizePullRequests(nodes, 40);

    expect(rates.smallPr).toMatchObject({ id: "smallPr", count: 3, population: 4 });
    expect(rates.botAuthored).toMatchObject({ count: 1, population: 4 });
    expect(rates.revert).toMatchObject({ count: 1, population: 4 });
    // The denominator is the PRs we could analyse — never the repo-wide totalCount of 40.
    expect(rates.smallPr!.population).toBe(4);
  });

  it("keeps the qualified rates numerically identical to the bare scalars they qualify", () => {
    const nodes = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      merged(n, { additions: n * 40, deletions: 0 }, [review(`rev${n}`, after(600))]),
    );
    const stats = summarizePullRequests(nodes, 8);
    expect(ratePercent(stats.rates.smallPr!)).toBe(stats.smallPrRate);
    expect(ratePercent(stats.rates.reviewed!)).toBe(stats.reviewedRate);
    expect(ratePercent(stats.rates.revert!)).toBe(stats.revertRate);
  });

  it("carries the AI channel counts and their precision with the AI-involvement rate", () => {
    const nodes = [
      merged(1, { author: { login: "claude[bot]", __typename: "Bot" } }),
      merged(2, { bodyText: "🤖 tidy-up" }),
      merged(3, { mergeCommit: { message: "feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>" } }),
      merged(4),
    ];
    const rate = summarizePullRequests(nodes, 4).rates.aiInvolved!;
    expect(rate).toMatchObject({ count: 3, population: 4 });
    const channels = Object.fromEntries((rate.channels ?? []).map((c) => [c.name, c]));
    expect(channels["bot author"]).toMatchObject({ count: 1, precision: "exact" });
    expect(channels["title/body/label marker"]).toMatchObject({ count: 1, precision: "heuristic" });
    expect(channels["commit trailer"]).toMatchObject({ count: 1, precision: "exact" });
    // The channel counts sum to the numerator exactly — the qualifier can't describe another population.
    expect((rate.channels ?? []).reduce((a, c) => a + c.count, 0)).toBe(rate.count);
    // And the reader is told the emoji channel is the heuristic one.
    expect(rateBasisText(rate)).toContain("heuristic");
  });

  it("qualifies a rate whose floor is not met instead of dropping the counts", () => {
    const stats = summarizePullRequests([merged(1, {}, [review("bob", after(600))])], 1);
    expect(stats.reviewedRate).toBeNull(); // scalar: not measurable
    expect(stats.rates.reviewed).toMatchObject({ count: 1, population: 1 }); // qualified: still says what was seen
    expect(ratePercent(stats.rates.reviewed!)).toBeNull();
    expect(rateBasisText(stats.rates.reviewed!)).toContain("below the 5-sample floor");
  });
});

describe("summarizePullRequests — self-approval count (item 18)", () => {
  it("counts a merged PR its own author approved", () => {
    const nodes = fiveApproved((n) => [review(n <= 2 ? `dev${n}` : "reviewer", after(600))]);
    const rate = summarizePullRequests(nodes, 5).rates.selfApproved!;
    expect(rate).toMatchObject({ count: 2, population: 5 });
    expect(ratePercent(rate)).toBe(40);
  });

  it("matches the author case-insensitively and ignores non-approving reviews", () => {
    const nodes = fiveApproved((n) => [
      review(n === 1 ? "DEV1" : "reviewer", after(600)),
      review(`dev${n}`, after(700), "User", "COMMENTED"), // author commented, did not approve
    ]);
    expect(summarizePullRequests(nodes, 5).rates.selfApproved!.count).toBe(1);
  });

  it("excludes bot-authored PRs and approvals from bot / AI-review accounts", () => {
    // A bot approving its own bot-authored PR is an automerge app, not a person waving work through.
    const nodes = [
      ...fiveApproved(() => [review("reviewer", after(600))]),
      merged(6, { author: { login: "dependabot[bot]", __typename: "Bot" } }, [
        review("dependabot[bot]", after(1), "Bot"),
      ]),
      merged(7, { author: { login: "coderabbitai[bot]", __typename: "Bot" } }, [
        review("coderabbitai[bot]", after(1), "Bot"),
      ]),
    ];
    const rate = summarizePullRequests(nodes, 7).rates.selfApproved!;
    expect(rate).toMatchObject({ count: 0, population: 5 }); // the two bot PRs are out of both halves
  });

  it("sits on the same population as review coverage, and honours the same >= 5 floor", () => {
    const stats = summarizePullRequests(
      [1, 2, 3].map((n) => merged(n, { author: { login: `dev${n}`, __typename: "User" } }, [review(`dev${n}`, after(600))])),
      3,
    );
    expect(stats.rates.selfApproved).toMatchObject({ count: 3, population: 3 });
    expect(ratePercent(stats.rates.selfApproved!)).toBeNull(); // never "100% self-approved" off 3 PRs
    expect(stats.rates.selfApproved!.population).toBe(stats.rates.reviewed!.population);
  });
});

describe("summarizePullRequests — fast-approval share (item 19)", () => {
  it("counts approvals inside the threshold and not the ones outside it", () => {
    const nodes = fiveApproved((n) => [review("reviewer", after(n <= 2 ? FAST_APPROVAL_MAX_MINUTES - 1 : 120))]);
    const rate = summarizePullRequests(nodes, 5).rates.fastApproval!;
    expect(rate).toMatchObject({ count: 2, population: 5 });
    expect(ratePercent(rate)).toBe(40);
  });

  it("is measured from the FIRST human approval, and the threshold is inclusive", () => {
    const nodes = fiveApproved((n) =>
      n === 1
        ? [review("reviewer", after(FAST_APPROVAL_MAX_MINUTES)), review("other", after(600))]
        : [review("reviewer", after(600))],
    );
    expect(summarizePullRequests(nodes, 5).rates.fastApproval!.count).toBe(1);
  });

  it("denominates on PRs that got a human approval at all — an unreviewed PR is not a fast one", () => {
    const nodes = [
      ...fiveApproved((n) => (n <= 3 ? [review("reviewer", after(1))] : [])),
      merged(6, { author: { login: "dev6", __typename: "User" } }),
    ];
    const rate = summarizePullRequests(nodes, 6).rates.fastApproval!;
    expect(rate).toMatchObject({ count: 3, population: 3 });
    expect(ratePercent(rate)).toBeNull(); // 3 approvals is not a sample — no share is published
  });

  it("excludes bot / AI-review approvals: an instant CodeRabbit approval is not a rubber stamp", () => {
    const nodes = fiveApproved(() => [review("coderabbitai[bot]", after(1), "Bot"), review("reviewer", after(600))]);
    const rate = summarizePullRequests(nodes, 5).rates.fastApproval!;
    expect(rate).toMatchObject({ count: 0, population: 5 });
  });

  it("excludes self-approvals — one PR is not two independent pieces of evidence", () => {
    const nodes = fiveApproved((n) => [review(n === 1 ? "dev1" : "reviewer", after(1))]);
    const stats = summarizePullRequests(nodes, 5);
    expect(stats.rates.selfApproved!.count).toBe(1);
    expect(stats.rates.fastApproval!.count).toBe(4); // PR 1 counted once, as a self-approval
  });

  it("publishes a measured 0 when the sample is there and nothing was fast", () => {
    const nodes = fiveApproved(() => [review("reviewer", after(600))]);
    expect(ratePercent(summarizePullRequests(nodes, 5).rates.fastApproval!)).toBe(0);
  });
});
