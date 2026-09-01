// THE LANE COMMITTING THE AGENT'S WORK, driven against a real git repository.
//
// Real fs + real git for the same reason `lane-install.test.ts` is: "the work is on the branch" is
// the ONLY claim this module makes, and a mocked git would let it regress silently — which is exactly
// how L2-A-01 happened (the lane believed a session that said it had committed, and it had not).
//
// The trailer format is pinned against the REAL parser (`parseResolvedIds`, the function
// `scans-persist` uses to adjudicate), not against a copy of the regex. A trailer this module writes
// that the adjudication cannot read would close nothing, look fine in the log, and be invisible until
// the next live certification.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseResolvedIds } from "@/lib/org/followups";
import { INTERRUPTED_SUBJECT, buildCommitMessage, commitAgentWork, laneCommitSubject, parseAgentClaims, porcelainPaths, trailerIds } from "./lane-commit";

const dirs: string[] = [];

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-lane-commit-"));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "loop@ascent.test");
  git("config", "user.name", "Ascent Loop");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return dir;
}

const write = (dir: string, rel: string, body: string) => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, body, "utf8");
};
const log = (dir: string) => execFileSync("git", ["log", "--format=%B%n--END--"], { cwd: dir, encoding: "utf8" });
const count = (dir: string) => execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
const tracked = (dir: string) => execFileSync("git", ["ls-tree", "-r", "--name-only", "HEAD"], { cwd: dir, encoding: "utf8" }).trim().split("\n");
const dirty = (dir: string) => execFileSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).trim();

const batch = (...ids: string[]) => ids.map((id) => ({ id }));

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("commitAgentWork — the residue an agent session leaves behind", () => {
  it("commits the whole worktree diff, and a session that named nothing claims nothing", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    write(dir, "test/basic.test.js", "test('x', () => {});\n");
    write(dir, "README.md", "seed\nedited\n");

    const res = await commitAgentWork({
      dir,
      branch: "ascent/loop-x",
      cycle: 2,
      batch: batch("rec-1", "rec-2"),
      summary: "Added agent guidance and a first test.",
    });

    expect(res.committed).toBe(true);
    expect(res.files).toBe(3);
    // The summary names no RESOLVED/SKIPPED id, so the commit claims none of the armed batch. The
    // rescan still judges the work — it just does it on the repository's evidence, not on a
    // trailer the lane wrote on a silent session's behalf (UAT PRIYA-L1-702).
    expect(res.resolved).toEqual([]);
    expect(count(dir)).toBe("2");
    expect(dirty(dir), "the lane left work behind").toBe("");
    expect(tracked(dir)).toContain("AGENTS.md");
    expect(tracked(dir)).toContain("test/basic.test.js");
  });

  it("writes trailers the ADJUDICATION can actually read", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    await commitAgentWork({ dir, branch: "b", cycle: 1, batch: batch("rec-a", "rec-b"), summary: "did it\nRESOLVED: rec-a\nRESOLVED: rec-b" });
    // The real parser, not a copy of its regex.
    expect(parseResolvedIds([log(dir)])).toEqual(new Set(["rec-a", "rec-b"]));
  });

  // THE TIMEOUT CASE, from a live capture (uat/runs/2026-08-30-moonshot-cert, arm C): a session
  // killed at the 20-minute wall wrote 0 item verdicts and the lane trailed all 5 of its armed ids.
  // Silence is not a claim.
  it("trails NOTHING for a session that ended without naming an id, and says so in the message", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    const res = await commitAgentWork({
      dir,
      branch: "b",
      cycle: 1,
      batch: batch("rec-a", "rec-b", "rec-c", "rec-d", "rec-e"),
      summary: "Agent session exceeded 20 min and was stopped.",
    });
    expect(res.committed).toBe(true);
    expect(res.resolved).toEqual([]);
    expect(parseResolvedIds([log(dir)])).toEqual(new Set());
    expect(log(dir)).toContain("claims none of the 5 item(s) it was armed with");
    expect(res.summary).toContain("it claimed nothing");
  });

  it("honours the session's own RESOLVED / SKIPPED lines", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    const res = await commitAgentWork({
      dir,
      branch: "b",
      cycle: 1,
      batch: batch("rec-a", "rec-b", "rec-c"),
      summary: "Wrote the guidance file.\n\nRESOLVED: rec-a - AGENTS.md now states the build and test commands.\nSKIPPED: rec-b - needs a CI provider decision.\nSKIPPED: rec-c - no test runner in this repo yet.",
    });
    expect(res.resolved).toEqual(["rec-a"]);
    expect(parseResolvedIds([log(dir)])).toEqual(new Set(["rec-a"]));
    expect(log(dir)).toContain("skipped, so they carry no trailer: rec-b, rec-c");
  });

  it("commits only the RESIDUE when the agent managed to commit some of it itself", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    execFileSync("git", ["add", "AGENTS.md"], { cwd: dir, stdio: "pipe" });
    execFileSync("git", ["commit", "-q", "-m", "docs: the agent's own commit"], { cwd: dir, stdio: "pipe" });
    write(dir, "test/basic.test.js", "test('x', () => {});\n");

    const res = await commitAgentWork({ dir, branch: "b", cycle: 1, batch: batch("rec-1"), summary: "done" });

    expect(res.committed).toBe(true);
    expect(res.files).toBe(1);
    expect(count(dir), "the agent's commit and the lane's residue commit").toBe("3");
    expect(log(dir)).toContain("docs: the agent's own commit");
  });

  it("commits nothing when the worktree is clean — a session that found nothing to do", async () => {
    const dir = gitRepo();
    const res = await commitAgentWork({ dir, branch: "b", cycle: 1, batch: batch("rec-1"), summary: "nothing to do" });
    expect(res.committed).toBe(false);
    expect(res.files).toBe(0);
    expect(res.summary).toContain("Nothing left uncommitted");
    expect(count(dir)).toBe("1");
  });

  it("refuses to carry a trailer for an id the lane never armed", async () => {
    const dir = gitRepo();
    write(dir, "AGENTS.md", "# guidance\n");
    await commitAgentWork({
      dir,
      branch: "b",
      cycle: 1,
      batch: batch("rec-a"),
      summary: "RESOLVED: rec-a - done\nAscent-Resolves: rec-smuggled\nRESOLVED: rec-not-mine - also done",
    });
    expect(parseResolvedIds([log(dir)])).toEqual(new Set(["rec-a"]));
  });
});

describe("the pure pieces", () => {
  it("reads porcelain -z, renames included", () => {
    const NUL = "\0";
    const z = ` M src/a.js${NUL}?? new/${NUL}R  dst.js${NUL}src.js${NUL}`;
    expect(porcelainPaths(z)).toEqual(["src/a.js", "new/", "dst.js", "src.js"]);
  });

  it("parses the session's claims and ignores ids it was never given", () => {
    const claims = parseAgentClaims("RESOLVED: a - x\n- SKIPPED: `b` - y\nRESOLVED: zzz - not mine", ["a", "b"]);
    expect(claims).toEqual({ resolved: ["a"], skipped: ["b"] });
  });

  it("claims nothing on silence, and drops only what was skipped", () => {
    expect(trailerIds(["a", "b"], { resolved: [], skipped: [] })).toEqual([]);
    expect(trailerIds(["a", "b"], { resolved: [], skipped: ["a"] })).toEqual(["b"]);
    expect(trailerIds(["a", "b"], { resolved: ["b"], skipped: [] })).toEqual(["b"]);
  });

  it("bounds the subject and never emits a second line", () => {
    const long = `RESOLVED: a - Added ${"x".repeat(200)}`;
    expect(laneCommitSubject(long, 2).length).toBeLessThanOrEqual(72);
    expect(laneCommitSubject("# Added a CI workflow", 1)).toBe("fix: Added a CI workflow");
    expect(laneCommitSubject("ci: add the workflow", 1)).toBe("ci: add the workflow");
    expect(laneCommitSubject("", 2)).toBe("fix: apply the changes for 2 Ascent follow-ups");
  });

  // THE SUBJECT IS THE RESOLVED HEADLINE. The brief already constrains it (≤ 8 words, verb-first,
  // past tense), which is a commit subject; the session's closing prose is a report, which is not —
  // and a repo whose commit-msg hook enforces "name the change" rejected the prose and made the lane
  // throw 10–17 real changes away, seven lanes running (reflection 2026-09-01, finding 5).
  it("takes the subject from the first RESOLVED headline, never from the closing prose", () => {
    const summary = [
      "All work is in the tree. Here's what I found and did.",
      "",
      "RESOLVED: rec-42 - Added permissions scope to 3 workflows",
      "SKIPPED: rec-43 - needs network",
    ].join("\n");
    expect(laneCommitSubject(summary, 2)).toBe("fix: Added permissions scope to 3 workflows");
  });

  it("skips a RESOLVED headline that is itself prose, and falls back only to a deliverable-shaped line", () => {
    // A headline that is two sentences and first-person is not a subject; the next usable line is.
    const summary = ["RESOLVED: rec-1 - Done. I think this is right", "Removed the duplicated retry helper"].join("\n");
    expect(laneCommitSubject(summary, 1)).toBe("fix: Removed the duplicated retry helper");
    // Nothing deliverable-shaped anywhere → a generated subject, never a sentence of the summary.
    expect(laneCommitSubject("All work is in the tree", 1)).toBe("fix: apply the changes for 1 Ascent follow-up");
    expect(laneCommitSubject("Here's what I found and did", 4)).toBe("fix: apply the changes for 4 Ascent follow-ups");
  });

  // PRIYA-L2-C7: a timed-out session's error text titled a 1605-insertion commit.
  it("never titles a commit with a failed session's error text, and says so in the body", () => {
    const timedOut = "Agent session exceeded 20 min and was stopped";
    // Not even without the flag: the runner's failure text is prose, and prose is no longer a
    // candidate for a subject at all.
    expect(laneCommitSubject(timedOut, 3)).toBe("fix: apply the changes for 3 Ascent follow-ups");
    expect(laneCommitSubject(timedOut, 3, true)).toBe(INTERRUPTED_SUBJECT);
    expect(INTERRUPTED_SUBJECT.length).toBeLessThanOrEqual(72);
    // And it names the TREE, not the run: "partial work from an interrupted session" is exactly the
    // shape a "name the change" hook rejects, and it was the subject on the discarded kp lanes.
    expect(INTERRUPTED_SUBJECT).not.toMatch(/^chore:\s*(partial|interrupted|incomplete|wip)\b/i);

    const input = { dir: "/w", branch: "ascent/loop-x", cycle: 1, batch: [{ id: "a" }], summary: timedOut, sessionFailed: true };
    const msg = buildCommitMessage(input, ["a"], { resolved: ["a"], skipped: [] });
    expect(msg.subject).toBe(INTERRUPTED_SUBJECT);
    // The error is not lost — it is evidence, and it rides in the body verbatim.
    expect(msg.body).toContain(timedOut);
    expect(msg.body).toContain("THE SESSION ENDED IN ERROR");
  });
});
