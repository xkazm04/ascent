// THE WORKFLOW RESERVE (rubric r13) — the prompt's file window must show the model the files that
// are the ONLY place D4's operational facets can be cited from.
//
// The defect this pins: `pickFilesToFetch` reserves a FETCH quota for `.github/workflows/*` and then
// ranks them LAST for the prompt. The window holds ~10 excerpts and workflows sorted past position
// 40, so across a 21-run campaign (docs/harness/campaign/run-*.json) the model cited eight distinct
// paths and not one was a workflow — while `automated_review`, `review_teeth`, `autofix` and
// `agent_dispatch` have nowhere else in a normal repo to be cited from. D4 became a lottery over
// whether a front-ranked file (a package.json script, a comment in ruff.toml) happened to describe
// the automation, which is what the bistable 10/20 and 65/85 patterns were.

import { describe, expect, it } from "vitest";

import {
  PROMPT_FILE_WINDOW_CHARS,
  PROMPT_PER_FILE_CHARS,
  PROMPT_WORKFLOW_RESERVE_FILES,
  WORKFLOW_PATH_RE,
  buildFileExcerptBlock,
} from "./prompt";

/** A file whose excerpt fills a whole per-file slot, so the window's arithmetic is predictable. */
const big = (path: string, marker: string) => ({
  path,
  content: `${marker}\n${"x".repeat(PROMPT_PER_FILE_CHARS * 2)}`,
});

/** The pick order a real scan produces: guidance + manifests + docs + source FIRST, workflows LAST
 *  (github/source.ts steps 0-6 then step 7). Enough front files to overflow the window on their own,
 *  which is the ordinary case for any repo bigger than a toy. */
const REAL_PICK_ORDER = [
  ...Array.from({ length: 20 }, (_, i) => big(`src/front-${i}.ts`, `FRONT_${i}`)),
  big(".github/workflows/agent-review.yml", "REVIEW_WORKFLOW"),
  big(".github/workflows/autofix.yml", "AUTOFIX_WORKFLOW"),
  big(".github/workflows/agent-dispatch.yml", "DISPATCH_WORKFLOW"),
  big(".github/workflows/ci.yml", "CI_WORKFLOW"),
];

describe("WORKFLOW_PATH_RE — the reserved class is exactly the class ranked last", () => {
  it("matches CI workflows at either YAML spelling", () => {
    expect(WORKFLOW_PATH_RE.test(".github/workflows/review.yml")).toBe(true);
    expect(WORKFLOW_PATH_RE.test(".github/workflows/agent-dispatch.yaml")).toBe(true);
  });

  it("does NOT match automation configs that are already exact-name (front-ranked) picks", () => {
    // Spending the reserve on these would spend it on files that were never at risk.
    expect(WORKFLOW_PATH_RE.test(".github/dependabot.yml")).toBe(false);
    expect(WORKFLOW_PATH_RE.test("renovate.json")).toBe(false);
    expect(WORKFLOW_PATH_RE.test(".pre-commit-config.yaml")).toBe(false);
  });

  it("does not match a nested path or a non-YAML file under the workflows dir", () => {
    expect(WORKFLOW_PATH_RE.test(".github/workflows/shared/lib.yml")).toBe(false);
    expect(WORKFLOW_PATH_RE.test(".github/workflows/README.md")).toBe(false);
  });
});

describe("the reserve: a blind scan of a repo that HAS agentic review can now cite it", () => {
  it("shows the workflows even when 20 front-ranked files would have filled the window alone", () => {
    const block = buildFileExcerptBlock(REAL_PICK_ORDER);
    expect(block).toContain("### .github/workflows/agent-review.yml");
    expect(block).toContain("REVIEW_WORKFLOW");
    expect(block).toContain("### .github/workflows/autofix.yml");
    expect(block).toContain("### .github/workflows/agent-dispatch.yml");
  });

  it("is the exact regression: WITHOUT a reserve the same input shows no workflow at all", () => {
    // The pre-r13 rule, reproduced here so the test states what changed rather than only what holds.
    let joined = "";
    for (const f of REAL_PICK_ORDER) {
      const b = `### ${f.path}\n\`\`\`\n${f.content.slice(0, PROMPT_PER_FILE_CHARS)}\n…[truncated]\n\`\`\``;
      joined = joined ? `${joined}\n\n${b}` : b;
      if (joined.length >= PROMPT_FILE_WINDOW_CHARS) break;
    }
    expect(joined).not.toContain(".github/workflows/");
  });

  it("keeps the block inside the window — the reserve is a reallocation, not extra budget", () => {
    expect(buildFileExcerptBlock(REAL_PICK_ORDER).length).toBeLessThanOrEqual(
      PROMPT_FILE_WINDOW_CHARS + "\n…[truncated]".length,
    );
  });

  it("still front-loads: the reserve costs the LAST texture samples, not the first evidence files", () => {
    const block = buildFileExcerptBlock(REAL_PICK_ORDER);
    expect(block).toContain("FRONT_0");
    expect(block).toContain("FRONT_1");
    expect(block).not.toContain("FRONT_19");
  });

  it("emits in fetch-rank order: admission is reordered, emission is not", () => {
    const block = buildFileExcerptBlock(REAL_PICK_ORDER);
    expect(block.indexOf("FRONT_0")).toBeLessThan(block.indexOf(".github/workflows/agent-review.yml"));
  });

  it("caps the reserved class rather than letting workflows eat the window", () => {
    // Real pick order: texture files first, twelve workflows last (github/source.ts step 7).
    const front = Array.from({ length: 20 }, (_, i) => big(`src/f-${i}.ts`, `F_${i}`));
    const many = Array.from({ length: 12 }, (_, i) => big(`.github/workflows/wf-${i}.yml`, `WF_${i}`));
    const block = buildFileExcerptBlock([...front, ...many]);
    const shown = many.filter((f) => block.includes(`### ${f.path}`)).length;
    expect(shown).toBe(PROMPT_WORKFLOW_RESERVE_FILES);
    // The first three in pick order, not the three that happen to fit.
    expect(block).toContain("### .github/workflows/wf-0.yml");
    expect(block).toContain("### .github/workflows/wf-2.yml");
    expect(block).not.toContain("### .github/workflows/wf-3.yml");
    // …and the front-ranked evidence still made it in.
    expect(block).toContain("F_0");
  });
});

describe("nothing else moves: the pre-r13 block is reproduced byte for byte", () => {
  /** The rule this file replaced, verbatim, as the oracle. */
  function preR13(files: readonly { path: string; content: string }[]): string {
    let joined = "";
    for (const f of files) {
      const body = f.content.length > PROMPT_PER_FILE_CHARS
        ? f.content.slice(0, PROMPT_PER_FILE_CHARS) + "\n…[truncated]"
        : f.content;
      const block = `### ${f.path}\n\`\`\`\n${body}\n\`\`\``;
      joined = joined ? `${joined}\n\n${block}` : block;
      if (joined.length >= PROMPT_FILE_WINDOW_CHARS) break;
    }
    return joined.length > PROMPT_FILE_WINDOW_CHARS
      ? joined.slice(0, PROMPT_FILE_WINDOW_CHARS) + "\n…[truncated]"
      : joined;
  }

  it("a repo whose files all fit is byte-identical (a workflow present but nothing dropped)", () => {
    const files = [
      { path: "README.md", content: "# rocket\nA small service.\n" },
      { path: "package.json", content: '{"scripts":{"test":"vitest"}}' },
      { path: ".github/workflows/ci.yml", content: "on:\n  pull_request:\njobs:\n  t:\n    steps:\n      - run: npm test\n" },
    ];
    expect(buildFileExcerptBlock(files)).toBe(preR13(files));
  });

  it("a repo with NO workflows is byte-identical even when the window truncates", () => {
    const files = Array.from({ length: 20 }, (_, i) => big(`src/f-${i}.ts`, `F_${i}`));
    expect(buildFileExcerptBlock(files)).toBe(preR13(files));
  });

  it("an empty file list is byte-identical (an empty block, not a stray separator)", () => {
    expect(buildFileExcerptBlock([])).toBe(preR13([]));
    expect(buildFileExcerptBlock([])).toBe("");
  });
});
