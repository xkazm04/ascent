// The one rule that decides what a lane DOES, driven against real directories.
//
// Real fixtures rather than a mocked `fs`: the whole rule is "what is on disk", so a stubbed
// filesystem would be testing the stub. Each case builds a throwaway tree, so a `.ai/manifest.yaml`
// that exists in one case genuinely does not exist in the next.

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BACKLOG_LANE, practiceArtifactPath, proposeLaneKind } from "./lane-kind";
import type { FollowUpItem } from "@/lib/org/followups";

const dirs: string[] = [];

function repoDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-lane-kind-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, "utf8");
  }
  return dir;
}

const item = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-1",
  repo: "acme/api",
  title: "Add agent guidance",
  dimId: "D1",
  dimLabel: "Agent guidance",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: 6,
  ...over,
});

const items = (...over: Partial<FollowUpItem>[]): (() => Promise<FollowUpItem[]>) => {
  const list = over.map((o) => item(o));
  return async () => list;
};

/** The loop's own history, injected. `none` is a repo the loop has never installed a practice into. */
const none = async (): Promise<ReadonlySet<string>> => new Set<string>();
const dispatched = (...ids: string[]) => async (): Promise<ReadonlySet<string>> => new Set(ids);

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("proposeLaneKind — the foundation leads", () => {
  it("proposes a foundation lane when the repo has no .ai/ manifest", async () => {
    const plan = await proposeLaneKind(repoDir({ "README.md": "hi" }), items({}), none);
    expect(plan.kind).toBe("foundation");
    expect(plan.practiceId).toBeNull();
    expect(plan.itemId).toBeNull();
    expect(plan.reason).toMatch(/\.ai\/ foundation/);
  });

  it("proposes it even when the repo has no open follow-ups at all — the install is the work", async () => {
    const plan = await proposeLaneKind(repoDir(), async () => [], none);
    expect(plan.kind).toBe("foundation");
  });

  it("accepts the .yml spelling of the spine, exactly as the passport detector does", async () => {
    const plan = await proposeLaneKind(repoDir({ ".ai/manifest.yml": "version: 1", "AGENTS.md": "x" }), items({}), none);
    expect(plan.kind).not.toBe("foundation");
  });

  it("stops proposing it once the standard is installed", async () => {
    const plan = await proposeLaneKind(repoDir({ ".ai/manifest.yaml": "version: 1", "AGENTS.md": "x" }), items({}), none);
    expect(plan.kind).toBe("backlog");
  });
});

describe("proposeLaneKind — a practice-shaped gap", () => {
  it("proposes a practice lane for the biggest gap when its starter is missing", async () => {
    // D1 maps to `agent-guidance`, whose artifact is AGENTS.md — absent here.
    const plan = await proposeLaneKind(repoDir({ ".ai/manifest.yaml": "version: 1" }), items({ dimId: "D1", id: "rec-top" }), none);
    expect(plan.kind).toBe("practice");
    expect(plan.practiceId).toBe("agent-guidance");
    expect(plan.itemId).toBe("rec-top");
    expect(plan.reason).toContain("AGENTS.md");
  });

  it("does not propose it a SECOND time for a repo a prior lane already installed it into", async () => {
    // The file is absent, exactly as in the case above — the only difference is the loop's own
    // history. See lane-kind.dispatched.test.ts for the full once-per-repo rule and its evidence.
    const plan = await proposeLaneKind(
      repoDir({ ".ai/manifest.yaml": "version: 1" }),
      items({ dimId: "D1", id: "rec-top" }),
      dispatched("agent-guidance"),
    );
    expect(plan.kind).toBe("backlog");
    expect(plan.skippedPracticeId).toBe("agent-guidance");
  });

  it("does not propose it when the repo already has that starter's file", async () => {
    const dir = repoDir({ ".ai/manifest.yaml": "version: 1", "AGENTS.md": "# already here" });
    expect((await proposeLaneKind(dir, items({ dimId: "D1" }), none)).kind).toBe("backlog");
  });

  it("only looks at the TOP item — a practice-shaped gap ranked second does not pull the lane", async () => {
    // D6 (`enforced-quality` → .github/pull_request_template.md) is missing, but it is not the
    // highest-impact gap, and the highest one's starter is already installed.
    const dir = repoDir({ ".ai/manifest.yaml": "version: 1", "AGENTS.md": "x" });
    const plan = await proposeLaneKind(dir, items({ dimId: "D1", id: "top" }, { dimId: "D6", id: "second" }), none);
    expect(plan.kind).toBe("backlog");
  });

  it("falls back to the agent lane for a dimension with no mapped practice", async () => {
    const dir = repoDir({ ".ai/manifest.yaml": "version: 1" });
    expect((await proposeLaneKind(dir, items({ dimId: "D99" }), none)).kind).toBe("backlog");
  });
});

describe("proposeLaneKind — the honest defaults", () => {
  it("is the agent lane when the repo has no local pairing to read", async () => {
    expect(await proposeLaneKind(null, items({}), none)).toEqual(BACKLOG_LANE);
  });

  it("reads the starter path off the real generator, so the two can never drift", () => {
    expect(practiceArtifactPath("agent-guidance")).toBe("AGENTS.md");
    expect(practiceArtifactPath("ci-gates")).toBe(".github/workflows/ci.yml");
    expect(practiceArtifactPath("not-a-practice")).toBeNull();
  });
});
