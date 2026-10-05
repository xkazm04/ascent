// D8 sees LLM-as-judge harnesses, single-file decision logs and runbooks, versioned agent guardrails
// and task-card queues: the forms the game repos (2026-10-05) use for the practices D8's rows describe.
// Both directions throughout: the form scores, and a repo without it scores 0 on that row.

import { describe, it, expect } from "vitest";
import { analyzeSignals } from "./index";
import type { RepoSnapshot, Signal } from "@/lib/types";

function repoSnap(paths: string[]): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: ["README.md", "src/main.cpp", ...paths].map((path) => ({ path, type: "blob" as const })),
    files: [{ path: "README.md", content: "# x", bytes: 3 }],
    commits: [],
    truncated: false,
    coverage: 1,
  };
}
const dim = (id: "D5" | "D8", paths: string[]) =>
  analyzeSignals(repoSnap(paths), "2026-06-10T00:00:00Z").find((d) => d.id === id)!;
const find = (sigs: Signal[], re: RegExp) => sigs.find((x) => re.test(x.label));
const EVAL = /eval/i;

describe("D8 eval award recognises an LLM-as-judge harness on two kinds of evidence", () => {
  it("garden-vr shape: judge scripts + a rubric", () => {
    const out = dim("D8", ["apps/sundial/Art/Scripts/halo_s5_judge.py", "apps/sundial/Art/Scripts/sprint_t050_rubric.py"]);
    expect(find(out.signals, EVAL)?.detail).toBe("apps/sundial/art/scripts/halo_s5_judge.py, apps/sundial/art/scripts/sprint_t050_rubric.py");
    expect(out.signalScore).toBe(30);
  });

  it("garden-vr shape: a judge/ directory + a rubric inside it", () => {
    expect(find(dim("D8", ["tools/fidelity/judge/controls.json", "tools/fidelity/judge/packet-v1/rubric-dial.md"]).signals, EVAL)).toBeDefined();
  });

  it("firetv shape: uat/rubric.md + uat/driver/verdict.cjs", () => {
    expect(find(dim("D8", ["uat/rubric.md", "uat/driver/verdict.cjs"]).signals, EVAL)?.detail).toBe("uat/rubric.md, uat/driver/verdict.cjs");
  });

  it("ONE hit earns nothing: a lone judge file, a lone rubric, a lone uat verdict", () => {
    for (const paths of [["src/judge.ts"], ["docs/rubric.md"], ["uat/rubric.md"], ["uat/driver/verdict.cjs"]])
      expect(find(dim("D8", paths).signals, EVAL), paths.join()).toBeUndefined();
  });

  it("a judge file and a judges/ directory are ONE kind (a courts app is not an eval harness)", () => {
    expect(find(dim("D8", ["src/judges/judge.ts", "src/judges/panel.ts", "lib/judge_service.py"]).signals, EVAL)).toBeUndefined();
  });

  it("third-party trees are not evidence", () => {
    expect(find(dim("D8", ["node_modules/x/judge.js", "vendor/y/rubric.md"]).signals, EVAL)).toBeUndefined();
  });

  it("a repo with evals/ keeps its existing label and is not awarded twice", () => {
    const out = dim("D8", ["evals/cases.yaml", "tools/judge.py", "rubric.md"]);
    expect(out.signals.filter((x) => EVAL.test(x.label))).toHaveLength(1);
    expect(find(out.signals, EVAL)?.label).toBe("AI-output eval / golden-test harness");
  });
});

describe("ADR_PATH: anchored to a segment, and single-file decision logs", () => {
  const ADR = /runbooks \/ ADRs/;
  it("owner-decisions/x.md no longer matches (D8 and D5)", () => {
    expect(find(dim("D8", ["evidence/owner-decisions/x.md"]).signals, ADR)).toBeUndefined();
    expect(find(dim("D5", ["evidence/owner-decisions/x.md"]).signals, /Decision Records/)).toBeUndefined();
  });

  it("directory ADRs keep matching, and docs/adrs/ joins docs/adr/", () => {
    for (const p of ["docs/decisions/0001-x.md", "docs/adr/0001-x.md", "docs/adrs/0001-x.md", "decisions/x.md"])
      expect(find(dim("D8", [p]).signals, ADR)?.detail, p).toBe(p);
  });

  it("mage-arena shape: docs/DECISIONS.md earns the D8 row and D5's ADR award", () => {
    expect(find(dim("D8", ["docs/DECISIONS.md"]).signals, ADR)?.detail).toBe("docs/decisions.md");
    expect(find(dim("D5", ["docs/DECISIONS.md"]).signals, /Decision Records/)?.detail).toBe("docs/decisions.md");
    expect(find(dim("D8", ["decision-log.md"]).signals, ADR)).toBeDefined();
  });

  it("docs/ORCHESTRATION.md is a runbook for D8, but not a decision record for D5", () => {
    expect(find(dim("D8", ["docs/ORCHESTRATION.md"]).signals, ADR)?.detail).toBe("docs/orchestration.md");
    expect(find(dim("D5", ["docs/ORCHESTRATION.md"]).signals, /Decision Records/)).toBeUndefined();
  });

  it("a repo with no decision record still scores 0 for the row", () => {
    for (const p of ["docs/design.md", "notes/decisions-pending.txt", "src/orchestration.md"])
      expect(find(dim("D8", [p]).signals, ADR), p).toBeUndefined();
  });
});

describe("D8 process rows: versioned agent guardrails and task-card queues", () => {
  const PROCESS = /AI contribution process/;
  const ISSUES = /issue templates|task-card queue/;
  it("a tracked .agents/hooks.json or .claude/settings.json earns the process row", () => {
    for (const p of [".agents/hooks.json", ".claude/settings.json"])
      expect(find(dim("D8", [p]).signals, PROCESS)?.detail, p).toBe(p);
  });

  it("a personal settings.local.json, or a nested copy, does not", () => {
    for (const p of [".claude/settings.local.json", "tools/.claude/settings.json"])
      expect(find(dim("D8", [p]).signals, PROCESS), p).toBeUndefined();
  });

  it("guardrails beside a PR template do not stack: one 15-point row", () => {
    const out = dim("D8", [".github/pull_request_template.md", ".agents/hooks.json"]);
    expect(out.signals.filter((x) => PROCESS.test(x.label))).toHaveLength(1);
    expect(out.signalScore).toBe(15);
  });

  it("mage-arena shape: three or more cards in one tasks/ folder earn the issue-template row", () => {
    const out = dim("D8", ["apps/vr/tasks/T01-a.md", "apps/vr/tasks/T02-b.md", "apps/vr/tasks/T03-c.md"]);
    expect(find(out.signals, ISSUES)?.detail).toBe("apps/vr/tasks/ (3 cards)");
    expect(out.signalScore).toBe(10);
  });

  it("two cards, cards spread over folders, a docs tasks/ tree, or non-md cards earn nothing", () => {
    for (const paths of [
      ["tasks/a.md", "tasks/b.md"],
      ["a/tasks/x.md", "b/tasks/y.md", "c/queue/z.md"],
      ["docs/tasks/a.md", "docs/tasks/b.md", "docs/tasks/c.md"],
      [".claude/runs/cards/a.json", ".claude/runs/cards/b.json", ".claude/runs/cards/c.json"],
      ["tasks/readme.md", "tasks/a.md", "tasks/b.md"],
    ])
      expect(find(dim("D8", paths).signals, ISSUES), paths.join()).toBeUndefined();
  });
});
