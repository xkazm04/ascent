// LocalFsSource — exercised against THIS repository's own checkout, the fixture that is always
// present wherever the suite runs. The assertions target the properties downstream stages depend on
// (tree shape, budget caps, commit messages for the trailer close, honest sha identity), not exact
// file lists, so ordinary development in the repo never breaks them.

import { describe, expect, it } from "vitest";
import { LocalFsSource, parseGitLog } from "@/lib/local/source";
import { MAX_FILES } from "@/lib/github/source";

const NUL = "\x00";
const RS = "\x1e";

describe("parseGitLog", () => {
  it("parses sha/author/date/body records, including multi-line bodies with trailers", () => {
    const raw =
      `abc123${NUL}Ada${NUL}2026-08-19T10:00:00+02:00${NUL}feat: thing\n\nAscent-Resolves: rec-1\n${RS}` +
      `def456${NUL}Grace${NUL}2026-08-18T09:00:00+02:00${NUL}fix: other${RS}`;
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0]!.message).toContain("Ascent-Resolves: rec-1");
    expect(commits[0]!.authorName).toBe("Ada");
    expect(commits[1]!.committedAt).toBe("2026-08-18T09:00:00+02:00");
  });

  it("returns [] for empty output", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

describe("LocalFsSource against this repository", () => {
  it("produces a snapshot the pipeline can score", async () => {
    const source = new LocalFsSource(process.cwd());
    const snap = await source.fetchSnapshot({ owner: "local", repo: "ascent" });

    // Tree: forward-slashed paths, no ignored build output (node_modules is .gitignored).
    expect(snap.tree.length).toBeGreaterThan(100);
    expect(snap.tree.every((f) => !f.path.includes("\\"))).toBe(true);
    expect(snap.tree.some((f) => f.path.startsWith("node_modules/"))).toBe(false);

    // Files: budgeted like the GitHub source, README/manifest-class picks present and capped.
    expect(snap.files.length).toBeGreaterThan(5);
    expect(snap.files.length).toBeLessThanOrEqual(MAX_FILES);
    expect(snap.files.some((f) => /^readme\.md$/i.test(f.path))).toBe(true);
    for (const f of snap.files) expect(f.content.length).toBeLessThanOrEqual(60_000);

    // Commits carry real messages — the field the follow-up trailer close reads.
    expect(snap.commits.length).toBeGreaterThan(5);
    expect(snap.commits[0]!.message.length).toBeGreaterThan(0);

    // Identity honesty: EITHER a full sha (clean tree) or none at all (dirty tree) — never a sha
    // stamped over content that isn't that commit.
    const sha = snap.meta.headSha;
    expect(sha === undefined || /^[0-9a-f]{40}$/.test(sha!)).toBe(true);

    expect(snap.meta.isPrivate).toBe(true);
    expect(snap.coverage).toBeGreaterThan(0);
  }, 30_000);
});
