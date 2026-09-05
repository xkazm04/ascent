#!/usr/bin/env node
// Zero-dep tests for the distributable's invoke channel (#19).
// Run: node scripts/__tests__/ascent-skills-hooks.test.mjs
//
// Lives outside vitest deliberately: vitest's include is `src/**`, and `ascent-skills.mjs` is a
// standalone file customers copy into their own repo — it must stay runnable and testable with
// nothing but node, exactly as they will have it. Same posture as scripts/docs/__tests__/.
//
// Three things are worth pinning here, and they are the three that would cost a user real damage:
//   1. `hooks install` is idempotent and never disturbs a foreign PreToolUse hook;
//   2. `hooks remove` deletes ONLY entries this tool marked as its own;
//   3. `report --to-registry` refuses a payload carrying a `/`- or `@`-shaped value — the usage
//      lane's contract, enforced client-side before anything reaches a repo that may be public.

import test from "node:test";
import assert from "node:assert/strict";
import {
  HOOK_MARKER,
  SKILL_HOOK_TEMPLATE,
  aggregateForRegistry,
  assertUsageLaneSafe,
  dedupeEvents,
  isOurHook,
  parseSpool,
  withSkillHook,
  withoutSkillHook,
} from "../ascent-skills.mjs";

const foreign = { matcher: "Skill", hooks: [{ type: "command", command: "node ./their-audit.mjs" }] };

test("hooks install adds one marked PreToolUse entry", () => {
  const { settings, changed } = withSkillHook({});
  assert.equal(changed, true);
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0][HOOK_MARKER], true);
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Skill");
});

test("hooks install is idempotent", () => {
  const once = withSkillHook({}).settings;
  const twice = withSkillHook(once);
  assert.equal(twice.changed, false);
  assert.equal(twice.settings.hooks.PreToolUse.length, 1);
});

test("hooks install preserves a foreign hook on the same matcher", () => {
  const { settings } = withSkillHook({ hooks: { PreToolUse: [foreign] }, permissions: { allow: ["Bash"] } });
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.deepEqual(settings.hooks.PreToolUse[0], foreign);
  // Everything else in the file survives untouched — this writes back the whole settings object.
  assert.deepEqual(settings.permissions, { allow: ["Bash"] });
});

test("hooks remove deletes only our entry", () => {
  const installed = withSkillHook({ hooks: { PreToolUse: [foreign] } }).settings;
  const { settings, removed } = withoutSkillHook(installed);
  assert.equal(removed, 1);
  assert.deepEqual(settings.hooks.PreToolUse, [foreign]);
});

test("hooks remove on a foreign-only file changes nothing", () => {
  const before = { hooks: { PreToolUse: [foreign] } };
  const { changed, removed } = withoutSkillHook(before);
  assert.equal(changed, false);
  assert.equal(removed, 0);
});

test("hooks remove tidies the empty containers it created", () => {
  const { settings } = withoutSkillHook(withSkillHook({}).settings);
  assert.equal(settings.hooks, undefined);
});

test("identity is the marker, not the matcher or the command", () => {
  assert.equal(isOurHook(foreign), false);
  assert.equal(isOurHook({ [HOOK_MARKER]: true }), true);
});

test("the emitted hook never blocks a tool call", () => {
  // The contract that matters most: whatever goes wrong, the hook exits 0 and the user's Skill runs.
  assert.match(SKILL_HOOK_TEMPLATE, /process\.exit\(0\)/);
  assert.match(SKILL_HOOK_TEMPLATE, /catch \{/);
  // And it records no content: no prompt, no file body, no login.
  assert.equal(SKILL_HOOK_TEMPLATE.includes("tool_response"), false);
});

test("parseSpool skips a torn line instead of failing the drain", () => {
  const events = parseSpool('{"skill":"a","ts":"t"}\n{"skill":"b"\n{"skill":"c"}\n');
  assert.deepEqual(events.map((e) => e.skill), ["a", "c"]);
});

test("dedupeEvents drops repeats of (session, skill, ts) and keeps un-sessioned ones", () => {
  const e = (session, ts) => ({ skill: "a", session, ts });
  assert.equal(dedupeEvents([e("s1", "t1"), e("s1", "t1"), e("s1", "t2")]).length, 2);
  assert.equal(dedupeEvents([e(null, "t1"), e(null, "t1")]).length, 2);
});

test("aggregateForRegistry emits counts only, and merges the prior total", () => {
  const payload = aggregateForRegistry(
    [
      { skill: "perfect", ts: "2026-08-20T00:00:00.000Z" },
      { skill: "perfect", ts: "2026-08-22T00:00:00.000Z" },
      { skill: "uat", ts: "2026-08-21T00:00:00.000Z" },
    ],
    "dev-box",
    { previous: { skills: { perfect: { invokes: 10, lastUsed: "2026-08-01T00:00:00.000Z" } } }, now: "2026-08-29T00:00:00.000Z" },
  );
  assert.equal(payload.skills.perfect.invokes, 12);
  assert.equal(payload.skills.perfect.lastUsed, "2026-08-22T00:00:00.000Z");
  assert.equal(payload.skills.uat.invokes, 1);
  assert.equal(payload.contributor, "dev-box");
  // No repo dimension exists in the shape at all — it is not filtered out, it is never built.
  assert.equal(JSON.stringify(payload).includes("repo"), false);
  assert.equal(assertUsageLaneSafe(payload), true);
});

test("report --to-registry refuses a payload carrying a repo-shaped value", () => {
  const payload = aggregateForRegistry([{ skill: "perfect", ts: "t" }], "acme/dev-box");
  assert.throws(() => assertUsageLaneSafe(payload), /forbids repo names/);
});

test("report --to-registry refuses an address-shaped value", () => {
  const payload = aggregateForRegistry([{ skill: "perfect", ts: "t" }], "dev@acme.com");
  assert.throws(() => assertUsageLaneSafe(payload), /forbids repo names/);
});

test("report --to-registry refuses a repo-shaped SKILL NAME, not just a contributor", () => {
  const payload = aggregateForRegistry([{ skill: "acme/internal-deploy", ts: "t" }], "dev-box");
  assert.throws(() => assertUsageLaneSafe(payload), /key/);
});

test("the schema tag's own slash is the one named exemption", () => {
  const payload = aggregateForRegistry([{ skill: "perfect", ts: "t" }], "dev-box");
  assert.equal(payload.schema, "rkb-usage/1");
  assert.equal(assertUsageLaneSafe(payload), true);
});
