// ONCE PER REPO — the practice rule's second gate, and the regression it exists to end.
//
// Sibling of lane-kind.test.ts (the foundation/practice/backlog rules) and lane-kind.craft.test.ts
// (the ordering), which must both keep passing untouched.
//
// THE DEFECT, measured on `systedo-case`: run 1 installed the "agent in the loop" starter
// (`.github/workflows/ai-review.yml`, 18 lines); a later lane's agent consolidated it into
// `.github/workflows/agent-review.yml` (122 lines, plus a rubric, required-checks and CODEOWNERS) and
// DELETED the thin starter; the next run's file test saw the starter missing and reinstalled it; the
// next agent deleted it again. Verified in git history as 95347818 → f419243b → bd7590e1 — the same
// starter installed twice with the deletion between. Every run burned on that, and the loop never
// reached a backlog or a craft lane.
//
// Real fixtures rather than a mocked `fs`, for the same reason the sibling gives: the file half of the
// rule is "what is on disk", so a stubbed filesystem would be testing the stub. The HISTORY half is
// injected, because it is a database read and the rule takes it as a lazy parameter.

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { proposeLaneKind } from "./lane-kind";
import type { FollowUpItem } from "@/lib/org/followups";
import type { CraftAxis } from "@/lib/scoring/craft";

const dirs: string[] = [];

function repoDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-lane-once-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  return dir;
}

/** A repo past rule 1: the `.ai/` foundation is in, so the practice rule is the one under test. */
const founded = (files: Record<string, string> = {}) => repoDir({ ".ai/manifest.yaml": "version: 1", ...files });

const gap = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "systedo/case",
  title: "Put an agent in the review loop",
  dimId: "D4",
  dimLabel: "Agent in the loop",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 8,
  ...over,
});

const rung = (axis: CraftAxis | null): FollowUpItem => ({
  ...gap(),
  id: `c-${axis ?? "none"}`,
  title: "a rung",
  projectedPoints: null,
  kind: "craft",
  craftAxis: axis,
});

const items = (...list: FollowUpItem[]) => async () => list;
const none = async (): Promise<ReadonlySet<string>> => new Set<string>();
const dispatched = (...ids: string[]) => async (): Promise<ReadonlySet<string>> => new Set(ids);

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("proposeLaneKind — a practice is proposed AT MOST ONCE per repo", () => {
  it("proposes the practice lane when the starter is missing AND no prior lane dispatched it", async () => {
    // D4 maps to `agent-in-loop`, whose artifact is .github/workflows/ai-review.yml — absent here.
    const plan = await proposeLaneKind(founded(), items(gap({ id: "rec-top" })), none);
    expect(plan.kind).toBe("practice");
    expect(plan.practiceId).toBe("agent-in-loop");
    expect(plan.itemId).toBe("rec-top");
    expect(plan.skippedPracticeId).toBeNull();
  });

  it("does NOT propose it again once a prior lane dispatched it — even though the file is gone", async () => {
    // The regression. Same repo, same missing file, same top gap — the only thing that changed is
    // that the loop's own history now says this practice was installed here before.
    const plan = await proposeLaneKind(founded(), items(gap({ id: "rec-top" })), dispatched("agent-in-loop"));
    expect(plan.kind).toBe("backlog");
    expect(plan.practiceId).toBeNull();
    expect(plan.itemId).toBeNull();
    // The skip is carried out of the rule so the engine can write the lesson that explains it.
    expect(plan.skippedPracticeId).toBe("agent-in-loop");
    expect(plan.reason).toMatch(/removal is a decision/);
  });

  it("only gates the practice it actually dispatched — a different one still leads", async () => {
    const plan = await proposeLaneKind(founded(), items(gap({ id: "rec-top" })), dispatched("ci-gates", "docs-adrs"));
    expect(plan.kind).toBe("practice");
    expect(plan.practiceId).toBe("agent-in-loop");
  });

  it("still yields the CRAFT lane for an all-craft batch, whatever the history says", async () => {
    const plan = await proposeLaneKind(founded(), items(rung("performance")), dispatched("agent-in-loop"));
    expect(plan.kind).toBe("craft");
    expect(plan.skippedPracticeId).toBeNull();
  });

  it("still yields BACKLOG when the starter IS present, and never reaches the history read", async () => {
    let read = false;
    const plan = await proposeLaneKind(
      founded({ ".github/workflows/ai-review.yml": "name: ai-review" }),
      items(gap()),
      async () => {
        read = true;
        return new Set<string>();
      },
    );
    expect(plan.kind).toBe("backlog");
    expect(plan.skippedPracticeId).toBeNull();
    // LAZINESS IS PART OF THE CONTRACT: the cheap filesystem answer must not pay for a db round trip.
    expect(read).toBe(false);
  });

  it("does not read the history for a foundation lane either — rule 1 answers on its own", async () => {
    let read = false;
    const plan = await proposeLaneKind(repoDir({ "README.md": "hi" }), items(gap()), async () => {
      read = true;
      return new Set<string>();
    });
    expect(plan.kind).toBe("foundation");
    expect(read).toBe(false);
  });
});
