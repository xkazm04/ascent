// EVERY BROKEN PAIRING IN ONE REFUSAL (challenge-2026-09-23b, local-autopilot-loop-engine#B).
//
// `startLoopRun` re-verifies each repo's pairing before it arms anything, and used to THROW AT THE
// FIRST broken one: an operator with two moved checkouts pressed Run, fixed one, pressed Run again and
// met the second. It now collects every broken pairing and refuses once, naming each repo with its
// reason, so a stale tab or a curl caller gets the whole list in one answer.
//
// The refusal is a CONTRACT: the standing runner (runner.ts) reads repo names out of it to pause them.
// The last case pins the producer's real output against the runner's parser, so the two cannot drift.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ selfHosted: () => true, envBool: () => true }));
vi.mock("@/lib/local/agent", () => ({
  autopilotEnabled: () => true,
  runClaudeAgent: vi.fn(),
  DEFAULT_AGENT_MODEL: "sonnet",
  resolveAgentConfig: () => ({ model: "sonnet", effort: null }),
}));
vi.mock("@/lib/db/loop-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/loop-runs")>()),
  createLoopRun: vi.fn(async () => {
    throw new Error("createLoopRun must not be reached by a refused start");
  }),
  getActiveLoopRun: vi.fn(async () => null),
  markStaleRunsStopped: vi.fn(async () => 0),
}));
vi.mock("@/lib/db/client", () => ({ getPrisma: () => null, isDbConfigured: () => true }));
vi.mock("@/lib/db/scans-audit", () => ({ recordAudit: vi.fn(async () => true) }));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/local/source", () => ({ LocalFsSource: class {} }));

const stored: Record<string, string | null> = {};
vi.mock("@/lib/db", () => ({ getRepoLocalPath: vi.fn(async (_o: string, repo: string) => stored[repo] ?? null), persistScanReport: vi.fn() }));
const verdicts: Record<string, string | null> = {};
vi.mock("@/lib/local/pairing", () => ({
  verifyLocalPath: vi.fn(async (path: string) => {
    const error = verdicts[path] ?? null;
    return error ? { ok: false, error, originMatch: "unknown", origin: null, headSha: null, branch: null } : { ok: true, error: null, originMatch: "match", origin: null, headSha: "h", branch: "main" };
  }),
}));

import { startLoopRun } from "./loop-engine";
import { reposNamedIn } from "./pairing-health";

const MOVED = "Folder does not exist on the server's filesystem.";
const NOT_GIT = "Not a git repository (or git is not installed on the server).";
const laneKind = vi.fn(async () => ({ kind: "backlog" as const, practiceId: null, itemId: null, reason: "r", skippedPracticeId: null }));
const deps = { laneKind, openBatch: vi.fn(async () => []), dispatchedPractices: vi.fn(async () => new Set<string>()) };

beforeEach(() => {
  for (const k of Object.keys(stored)) delete stored[k];
  for (const k of Object.keys(verdicts)) delete verdicts[k];
  Object.assign(stored, { "acme/a": "/code/a", "acme/b": "/code/b", "acme/c": "/code/c" });
  Object.assign(verdicts, { "/code/b": MOVED, "/code/c": NOT_GIT });
  laneKind.mockClear();
});

async function refusal(repos: string[]): Promise<string> {
  const err = await startLoopRun({ org: "acme", repos, deps: deps as never }).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  return (err as Error).message;
}

describe("startLoopRun — every broken pairing, in one refusal", () => {
  it("names BOTH broken repos, each with its own reason, and arms nothing", async () => {
    const why = await refusal(["acme/a", "acme/b", "acme/c"]);
    expect(why).toContain(`acme/b: ${MOVED}`);
    expect(why).toContain(`acme/c: ${NOT_GIT}`);
    expect(why).not.toContain("acme/a");
    // No lane kind is read (and so no skipped-practice lesson written) for a run that will not start.
    expect(laneKind).not.toHaveBeenCalled();
  });

  it("folds an UNPAIRED repo into the same list rather than stopping at it", async () => {
    stored["acme/b"] = null;
    const why = await refusal(["acme/b", "acme/c"]);
    expect(why).toMatch(/acme\/b is not paired with a local path/);
    expect(why).toContain(`acme/c: ${NOT_GIT}`);
  });

  it("keeps the single-repo refusal byte-identical", async () => {
    expect(await refusal(["acme/a", "acme/b"])).toBe(`Pairing broken for acme/b: ${MOVED}`);
  });

  it("guard: the runner's parser reads every broken repo out of the real multi-repo refusal", async () => {
    const why = await refusal(["acme/a", "acme/b", "acme/c"]);
    expect(reposNamedIn(why, ["acme/a", "acme/b", "acme/c"])).toEqual(["acme/b", "acme/c"]);
  });
});
