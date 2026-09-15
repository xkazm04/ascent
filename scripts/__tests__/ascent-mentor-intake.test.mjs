#!/usr/bin/env node
// Zero-dep tests for the mentor intake counter.
// Run: node scripts/__tests__/ascent-mentor-intake.test.mjs
//
// Lives outside vitest for the same reason as ascent-skills-hooks.test.mjs: the counter is a
// standalone file a developer runs with nothing but node, so it is tested that way.
//
// T1 (study .ai/directions/2026-09-15-ai-engineering-coach-comparison.md, "Tests to initiate") runs
// two arms over the SAME fixture pair in scripts/__fixtures__/mentor/t1:
//   arm A: what the reference parser's session model can represent. It is restated below from
//          microsoft/ai-engineering-coach@18b1a3d src/core/parser-claude.ts (userHasText, the
//          entrypoint allow-list, Skill blocks with a non-error result, `agentMode: 'agent'`
//          hardcoded) and NOT imported: that tree is not a dependency of this repo.
//   arm B: this repo's counter.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMIT_COMMAND_RE, TEST_COMMAND_RE, intake, isHumanTurn, summarize } from "../ascent-mentor-intake.mjs";
import { parityHash } from "../ascent-mentor-parity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "..", "__fixtures__", "mentor");
const NOW = "2026-09-15T12:00:00Z";

/** Arm A: the reference model's representable fields, per session file. */
function referenceModel(projectsDir) {
  const out = { sessions: 0, launcher: { interactive: 0, programmatic: 0 }, requests: 0, skillsUsed: 0, agentModes: {} };
  for (const project of readdirSync(projectsDir)) {
    for (const file of readdirSync(join(projectsDir, project))) {
      const lines = readFileSync(join(projectsDir, project, file), "utf8")
        .split("\n")
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l)] : [];
          } catch {
            return [];
          }
        });
      const blocks = (l) => (Array.isArray(l.message?.content) ? l.message.content : []);
      // parser-claude.ts userHasText: any user text that is not a <command-> echo or an interrupt.
      const hasText = (l) => {
        const c = l.message?.content;
        const t = (typeof c === "string" ? c : blocks(l).filter((b) => b.type === "text").map((b) => b.text).join("\n")).trim();
        return t.length > 0 && !/^<(local-)?command-/.test(t) && !t.startsWith("[Request interrupted");
      };
      const requests = lines.filter((l) => l.type === "user" && hasText(l));
      if (requests.length === 0) continue; // the reference returns null for a file with no request
      out.sessions++;
      out.requests += requests.length;
      // entrypoint is captured from request lines only; missing or unlisted means programmatic.
      const entrypoint = requests.find((l) => l.entrypoint)?.entrypoint;
      out.launcher[["cli", "claude-desktop"].includes(entrypoint) ? "interactive" : "programmatic"]++;
      const results = new Map(lines.flatMap((l) => blocks(l).filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.is_error === true])));
      for (const l of lines) for (const b of blocks(l)) if (b.type === "tool_use" && b.name === "Skill" && results.get(b.id) === false) out.skillsUsed++;
      for (let i = 0; i < requests.length; i++) out.agentModes.agent = (out.agentModes.agent ?? 0) + 1; // hardcoded
    }
  }
  return out;
}

test("T1 arm A: the reference model counts both sessions and cannot hold plan mode", () => {
  const a = referenceModel(join(FIXTURES, "t1"));
  assert.deepEqual(a, {
    sessions: 2, // the SDK session is a session like any other
    launcher: { interactive: 1, programmatic: 1 },
    requests: 6, // 3 typed + task notification + compact summary, plus the SDK prompt
    skillsUsed: 2,
    agentModes: { agent: 6 }, // every request, including the plan-mode one: no field for plan mode
  });
});

test("T1 arm B: the counter folds the interactive session only and reads every UC3 signal", async () => {
  const b = await intake(join(FIXTURES, "t1"), { now: NOW });
  assert.equal(b.schema, "ascent.mentor-intake/1");
  assert.equal(b.sessionsCounted, 1);
  assert.deepEqual(b.sessionsExcluded, { "programmatic-launcher": 1, "unknown-launcher": 0, "no-turns-in-window": 0 });
  assert.equal(b.turnsPerSession, 3);
  assert.equal(b.planModePct, 33.3);
  assert.equal(b.skillInvokes30d, 1);
  assert.equal(b.testsBeforeCommitPct, 100);
  assert.equal(b.retriesPerSession, 0);
  assert.equal(b.compactions, 1);
  assert.equal(b.sessionsPerWeek, 0.2);
  assert.deepEqual(b.nullReasons, {});
});

test("edge fixtures: retry loops, chained and failed commits, window, launcher reasons", async () => {
  const e = await intake(join(FIXTURES, "edge"), { now: NOW });
  assert.equal(e.sessionsCounted, 1);
  assert.deepEqual(e.sessionsExcluded, { "programmatic-launcher": 0, "unknown-launcher": 1, "no-turns-in-window": 1 });
  assert.equal(e.turnsPerSession, 2); // the out-of-window plan turn is not folded
  assert.equal(e.planModePct, 0);
  assert.equal(e.skillInvokes30d, 0); // the only Skill call predates the window
  assert.equal(e.typedCommandInvokes, 1);
  assert.equal(e.retriesPerSession, 1); // `build` failed 4x = one loop; `tsc` failed 2x = none
  assert.equal(e.retryLoops, 1);
  assert.equal(e.commits, 3); // the hook-rejected commit is not a commit
  assert.equal(e.testsBeforeCommitPct, 33.3); // only the chained `vitest && commit`
  assert.equal(e.malformedLines, 1);
});

const quietSession = () => ({ launcher: "cli", turns: 2, turnsWithMode: 0, planTurns: 0, skillInvokes: 0, typedCommands: 0, compactions: 0, commits: 0, commitsAfterTest: 0, toolResults: 0, retryLoops: 0 });

test("absent inputs are null with a reason, never 0", async () => {
  const missing = await intake(join(FIXTURES, "does-not-exist"), { now: NOW });
  assert.equal(missing.planModePct, null);
  assert.equal(missing.nullReasons.planModePct, "projects-directory-missing");
  const none = summarize([], { days: 30, from: 0, to: 1, filesRead: 3 });
  assert.equal(none.skillInvokes30d, null);
  assert.equal(none.nullReasons.skillInvokes30d, "no-interactive-sessions-in-window");
  const quiet = summarize([quietSession()], { days: 30, from: 0, to: 1 });
  assert.deepEqual(quiet.nullReasons, { planModePct: "permission-mode-not-recorded", retriesPerSession: "no-tool-results", testsBeforeCommitPct: "no-commits" });
  assert.equal(quiet.retryLoops, null);
  const rare = summarize(Array.from({ length: 300 }, (_, i) => ({ ...quietSession(), toolResults: 1, retryLoops: i < 3 ? 1 : 0 })), { days: 30, from: 0, to: 1 });
  assert.equal(rare.retriesPerSession, 0.01); // 3 loops in 300 sessions is not a zero
  assert.equal(quiet.skillInvokes30d, 0); // sessions were read and no Skill call happened: a measured zero
});

test("turn and command classifiers", () => {
  assert.equal(isHumanTurn({ type: "user", origin: { kind: "task-notification" }, message: { content: "x" } }), false);
  assert.equal(isHumanTurn({ type: "user", message: { content: "<local-command-stdout>x</local-command-stdout>" } }), false);
  assert.equal(isHumanTurn({ type: "user", message: { content: "fix the bug" } }), true);
  for (const c of ["npm test", "npm run test:unit", "npx vitest run a", "py -m pytest", "node --test", "cargo test"]) assert.match(c, TEST_COMMAND_RE);
  for (const c of ["cat vitest.config.mjs", "npx tsc --noEmit", "npm testing", "ls src/jest/"]) assert.doesNotMatch(c, TEST_COMMAND_RE);
  assert.match("git -C ../repo commit -m x", COMMIT_COMMAND_RE);
  assert.doesNotMatch("git log --grep commit", COMMIT_COMMAND_RE);
});

test("output carries numbers and enums only, never fixture text", async () => {
  const raw = JSON.stringify(await intake(join(FIXTURES, "t1"), { now: NOW }));
  for (const needle of ["flaky", "Plan a fix", "tdd", "git commit", "demo-app", "Summary of", "background job"]) assert.equal(raw.includes(needle), false, needle);
});

test("parity hash: the same tree over the same logs hashes identically", async () => {
  const self = join(here, "..", "ascent-mentor-intake.mjs");
  const a = await parityHash(self, join(FIXTURES, "t1"), NOW);
  const b = await parityHash(self, join(FIXTURES, "t1"), NOW);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, await parityHash(self, join(FIXTURES, "edge"), NOW));
});
