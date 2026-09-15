#!/usr/bin/env node
// ascent-mentor-intake: the local, COUNT-ONLY sensor behind `/mentor intake` (UC3 sequencing step 1,
// docs/GOLDEN-USE-CASES.md; study .ai/directions/2026-09-15-ai-engineering-coach-comparison.md,
// feature 2). It reads Claude Code session JSONL on this machine and prints numbers. It never prints,
// stores or sends a prompt, a command, a diff, a path or any other text from a log: commands are
// matched in memory and failing calls are remembered only as a SHA-256 of their input.
//
//   node scripts/ascent-mentor-intake.mjs [projectsDir] [--days 30] [--now <ISO>]
//
// projectsDir defaults to ~/.claude/projects. No network, no dependencies, Node 18+.
//
// DEFINITIONS (every number below means exactly this; change them only with a schema bump):
//   session       one top-level `<project>/<session>.jsonl` file. Subagent files
//                 (`<session>/subagents/*.jsonl`) are not read: their prompts are written by the
//                 parent model, not by the person.
//   launcher      the first `entrypoint` value in the file (Claude Code writes it from
//                 CLAUDE_CODE_ENTRYPOINT on user, assistant and system records). Interactive =
//                 `cli` or `claude-desktop`, the reference parser's allow-list. Anything else
//                 (`sdk-cli` for `claude -p`, `sdk-ts`, `mcp`, a GitHub Action) is excluded as
//                 `programmatic-launcher`; a file with no entrypoint at all (older versions) is
//                 excluded as `unknown-launcher`, never guessed.
//   window        records whose timestamp falls in (now - days, now]. A session counts when it has
//                 at least one human turn in the window; otherwise `no-turns-in-window`.
//   turn          a user record typed by the person: not `isMeta`, not a compact summary, carrying
//                 text, and either `origin.kind === "human"` or (older logs, no origin) not a
//                 `system` prompt source, not a `<tag>`-wrapped command echo, not an interrupt marker.
//   planModePct   turns whose record says `permissionMode: "plan"`, over turns that record a
//                 permissionMode at all, x100. Null when no turn records one.
//   skillInvokes30d  `Skill` tool calls whose result came back without an error. Same event the
//                 PreToolUse hook in ascent-skills.mjs records live. Typed slash commands are counted
//                 apart, as `typedCommandInvokes`, because a log cannot tell a skill from a command.
//   testsBeforeCommitPct  successful `git commit` shell calls preceded, since session start or the
//                 previous commit, by a shell call that ran a test command (any outcome: a red run is
//                 still verification), over successful commits, x100. Null when there is no commit.
//   retriesPerSession  retry loops over sessions. A retry loop is one tool call input (same tool,
//                 byte-identical input) that came back `is_error: true` three or more times in one
//                 session; it counts once however many more times it fails. Two decimals, with the raw
//                 `retryLoops` beside it, because a rare loop must not round to a false 0. A result
//                 whose call predates the window (or was never logged) is not folded.
//   compactions   `system` records with subtype `compact_boundary` (auto and manual `/compact`).

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const SCHEMA = "ascent.mentor-intake/1";
export const INTERACTIVE_ENTRYPOINTS = new Set(["cli", "claude-desktop"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const RETRY_THRESHOLD = 3;
const MAX_FAILURE_KEYS = 2000; // per session; bounds memory on a pathological log

// Test runners a developer or an agent actually types. Bounded on both sides by anything that is not
// part of a word or a path, so `cat vitest.config.mjs` or `src/jest/` do not read as a test run.
export const TEST_COMMAND_RE =
  /(?<![\w./-])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?|npx\s+(?:vitest|jest|mocha|playwright\s+test)|vitest|jest|mocha|pytest|(?:py|python3?)\s+-m\s+(?:pytest|unittest)|cargo\s+(?:test|nextest)|go\s+test|node\s+--test|node\s+\S*\.test\.m?[jt]s|dotnet\s+test|mvn\s+test|gradlew?\s+test|rspec|phpunit)(?![\w./-])/;
export const COMMIT_COMMAND_RE = /\bgit\s+(?:-C\s+\S+\s+|-c\s+\S+\s+)*commit\b/;

const inc = (obj, key, n = 1) => {
  obj[key] = (obj[key] ?? 0) + n;
};
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100; // a rare event per session must not round to a false 0
const safeEnum = (v) => (typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v) ? v : "other");

function newSession() {
  return {
    launcher: undefined,
    turns: 0,
    turnsWithMode: 0,
    planTurns: 0,
    skillInvokes: 0,
    typedCommands: 0,
    compactions: 0,
    commits: 0,
    commitsAfterTest: 0,
    testSinceCommit: false,
    toolResults: 0,
    retryLoops: 0,
    pending: new Map(), // tool_use id -> { name, hash, test, commit }
    failures: new Map(), // input hash -> failure count
  };
}

function userText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  let text = null;
  for (const b of content) if (b && b.type === "text" && typeof b.text === "string") text = (text ?? "") + b.text;
  return text;
}

export function isHumanTurn(r) {
  if (r.type !== "user" || r.isMeta || r.isCompactSummary) return false;
  const text = userText(r.message?.content);
  if (text == null || !text.trim()) return false;
  if (r.origin && typeof r.origin === "object") return r.origin.kind === "human";
  if (r.promptSource === "system") return false;
  const t = text.trimStart();
  return !/^<[a-z-]+>/.test(t) && !t.startsWith("[Request interrupted");
}

function onToolUse(s, block) {
  if (!block.id || typeof block.name !== "string") return;
  const input = block.input ?? {};
  const command = SHELL_TOOLS.has(block.name) && typeof input.command === "string" ? input.command : "";
  const testAt = command ? command.search(TEST_COMMAND_RE) : -1;
  const commitAt = command ? command.search(COMMIT_COMMAND_RE) : -1;
  const hash = createHash("sha256").update(block.name).update("\0").update(JSON.stringify(input)).digest("hex");
  s.pending.set(block.id, { name: block.name, hash, testAt, commitAt });
}

function onToolResult(s, block) {
  const call = s.pending.get(block.tool_use_id);
  if (!call) return;
  s.pending.delete(block.tool_use_id);
  s.toolResults++;
  const failed = block.is_error === true;
  if (failed) {
    const n = (s.failures.get(call.hash) ?? 0) + 1;
    if (n <= RETRY_THRESHOLD && (s.failures.has(call.hash) || s.failures.size < MAX_FAILURE_KEYS)) s.failures.set(call.hash, n);
    if (n === RETRY_THRESHOLD) s.retryLoops++;
  }
  if (call.name === "Skill" && !failed) s.skillInvokes++;
  // A chained `tests && git commit` verifies before it commits only when the test comes first.
  const testFirst = call.testAt >= 0 && (call.commitAt < 0 || call.testAt < call.commitAt);
  if (testFirst) s.testSinceCommit = true;
  if (call.commitAt >= 0 && !failed) {
    s.commits++;
    if (s.testSinceCommit) s.commitsAfterTest++;
    s.testSinceCommit = false;
  }
  if (!failed && call.commitAt >= 0 && call.testAt > call.commitAt) s.testSinceCommit = true; // `commit && test`
}

/** Fold one parsed record into the session. Returns false once the session is known to be excluded. */
export function foldRecord(s, r, win) {
  if (s.launcher === undefined && typeof r.entrypoint === "string") {
    s.launcher = r.entrypoint;
    if (!INTERACTIVE_ENTRYPOINTS.has(r.entrypoint)) return false;
  }
  const ts = typeof r.timestamp === "number" ? r.timestamp : typeof r.timestamp === "string" ? Date.parse(r.timestamp) : NaN;
  if (!Number.isNaN(ts) && (ts <= win.from || ts > win.to)) return true;
  if (r.type === "system" && r.subtype === "compact_boundary") s.compactions++;
  const content = r.message?.content;
  if (r.type === "assistant" && Array.isArray(content)) {
    for (const b of content) if (b && b.type === "tool_use") onToolUse(s, b);
  } else if (r.type === "user") {
    if (Array.isArray(content)) for (const b of content) if (b && b.type === "tool_result") onToolResult(s, b);
    if (isHumanTurn(r)) {
      s.turns++;
      if (typeof r.permissionMode === "string") {
        s.turnsWithMode++;
        if (r.permissionMode === "plan") s.planTurns++;
      }
      if (/^\s*<command-message>/.test(userText(content) ?? "")) s.typedCommands++;
    }
  }
  return true;
}

async function foldFile(path, win, totals) {
  const s = newSession();
  const input = createReadStream(path, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let keepReading = true;
  for await (const line of lines) {
    if (!line) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      totals.malformedLines++;
      continue;
    }
    if (!r || typeof r !== "object") continue;
    keepReading = foldRecord(s, r, win);
    if (!keepReading) break; // a programmatic session: no need to read the rest of the file
  }
  lines.close();
  input.destroy();
  return s;
}

function listSessionFiles(dir, fromMs) {
  const out = [];
  for (const project of readdirSync(dir, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    let entries;
    try {
      entries = readdirSync(join(dir, project.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const path = join(dir, project.name, e.name);
      try {
        if (statSync(path).mtimeMs > fromMs) out.push(path); // untouched in the window: nothing to count
      } catch {
        /* vanished between list and stat */
      }
    }
  }
  return out.sort();
}

const NULL_KEYS = [
  "sessionsPerWeek", "turnsPerSession", "planModePct", "retriesPerSession", "testsBeforeCommitPct", "skillInvokes30d",
  "compactions", "typedCommandInvokes", "commits", "retryLoops",
];

/** Pure summary of folded sessions. Exported so the test can check it without touching the disk. */
export function summarize(sessions, { days, from, to, filesRead = sessions.length, malformedLines = 0 }) {
  const excluded = { "programmatic-launcher": 0, "unknown-launcher": 0, "no-turns-in-window": 0 };
  const launchers = {};
  const t = { turns: 0, turnsWithMode: 0, planTurns: 0, skill: 0, typed: 0, compactions: 0, commits: 0, commitsAfterTest: 0, toolResults: 0, retryLoops: 0 };
  let counted = 0;
  for (const s of sessions) {
    inc(launchers, s.launcher === undefined ? "none" : safeEnum(s.launcher));
    if (s.launcher === undefined) excluded["unknown-launcher"]++;
    else if (!INTERACTIVE_ENTRYPOINTS.has(s.launcher)) excluded["programmatic-launcher"]++;
    else if (s.turns === 0) excluded["no-turns-in-window"]++;
    else {
      counted++;
      t.turns += s.turns;
      t.turnsWithMode += s.turnsWithMode;
      t.planTurns += s.planTurns;
      t.skill += s.skillInvokes;
      t.typed += s.typedCommands;
      t.compactions += s.compactions;
      t.commits += s.commits;
      t.commitsAfterTest += s.commitsAfterTest;
      t.toolResults += s.toolResults;
      t.retryLoops += s.retryLoops;
    }
  }
  const out = {
    schema: SCHEMA,
    window: { days, from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    sessionsPerWeek: null,
    turnsPerSession: null,
    planModePct: null,
    retriesPerSession: null,
    testsBeforeCommitPct: null,
    skillInvokes30d: null,
    nullReasons: {},
    compactions: null,
    typedCommandInvokes: null,
    commits: null,
    retryLoops: null,
    sessionsCounted: counted,
    sessionsExcluded: excluded,
    launchers,
    filesRead,
    malformedLines,
  };
  if (counted === 0) {
    const why = filesRead === 0 ? "no-session-files-in-window" : "no-interactive-sessions-in-window";
    for (const k of NULL_KEYS) out.nullReasons[k] = why;
    return out;
  }
  out.sessionsPerWeek = round1(counted / (days / 7));
  out.turnsPerSession = round1(t.turns / counted);
  out.compactions = t.compactions;
  out.typedCommandInvokes = t.typed;
  out.commits = t.commits;
  out.skillInvokes30d = t.skill;
  if (t.turnsWithMode > 0) out.planModePct = round1((100 * t.planTurns) / t.turnsWithMode);
  else out.nullReasons.planModePct = "permission-mode-not-recorded";
  if (t.toolResults > 0) {
    out.retriesPerSession = round2(t.retryLoops / counted);
    out.retryLoops = t.retryLoops;
  }
  else out.nullReasons.retriesPerSession = "no-tool-results";
  if (t.commits > 0) out.testsBeforeCommitPct = round1((100 * t.commitsAfterTest) / t.commits);
  else out.nullReasons.testsBeforeCommitPct = "no-commits";
  return out;
}

export async function intake(dir, { days = 30, now = Date.now() } = {}) {
  const to = typeof now === "number" ? now : Date.parse(now);
  const from = to - days * 86_400_000;
  if (!existsSync(dir)) {
    const out = summarize([], { days, from, to, filesRead: 0 });
    for (const k of Object.keys(out.nullReasons)) out.nullReasons[k] = "projects-directory-missing";
    return out;
  }
  const totals = { malformedLines: 0 };
  const sessions = [];
  const files = listSessionFiles(dir, from);
  for (const path of files) {
    const s = await foldFile(path, { from, to }, totals);
    s.pending.clear(); // only the counters survive the file; nothing text-derived is kept
    s.failures.clear();
    sessions.push(s);
  }
  return summarize(sessions, { days, from, to, filesRead: files.length, malformedLines: totals.malformedLines });
}

function parseArgs(argv) {
  const opts = { dir: join(homedir(), ".claude", "projects"), days: 30, now: Date.now() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--days") opts.days = Number(argv[++i]);
    else if (a === "--now") opts.now = Date.parse(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else opts.dir = resolve(a);
  }
  if (!(opts.days > 0) || Number.isNaN(opts.now)) throw new Error("--days must be a positive number and --now an ISO date");
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log("usage: ascent-mentor-intake [projectsDir] [--days 30] [--now <ISO>]  (prints counts, never text)");
    } else {
      console.log(JSON.stringify(await intake(opts.dir, opts), null, 2));
    }
  } catch (err) {
    console.error(`ascent-mentor-intake: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
