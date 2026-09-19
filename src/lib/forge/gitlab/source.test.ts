import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabSource, parseGitlabUrl } from "./source";

const parsed = { owner: "group/sub", repo: "project", forge: "gitlab" as const };
const sha = "a".repeat(40);
const project = { path_with_namespace: "group/sub/project", default_branch: "main", visibility: "public" };

function server(options: {
  contents?: Record<string, string | null>;
  project?: object;
  commitsStatus?: number;
  paged?: boolean;
} = {}) {
  const contents = options.contents ?? { "README.md": "# project", "package.json": "{}" };
  const calls: URL[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(url.origin).toBe("https://gitlab.com");
    expect(url.pathname).toContain("/projects/group%2Fsub%2Fproject");
    if (url.pathname.endsWith("/raw")) {
      const file = decodeURIComponent(url.pathname.split("/repository/files/")[1]!.slice(0, -4));
      const content = contents[file];
      return new Response(content ?? "missing", { status: content == null ? 503 : 200 });
    }
    if (url.pathname.endsWith("/repository/tree")) {
      const paths = Object.keys(contents);
      const page = url.searchParams.get("page");
      const selected = options.paged ? (page === "1" ? paths.slice(0, 1) : paths.slice(1)) : paths;
      return Response.json(selected.map(path => ({ path, type: "blob" })), {
        headers: { "x-next-page": options.paged && page === "1" ? "2" : "" },
      });
    }
    if (url.pathname.endsWith("/repository/commits")) {
      return options.commitsStatus
        ? new Response("unavailable", { status: options.commitsStatus })
        : Response.json([{ id: sha, message: "fix a defect", author_name: "Author", committed_date: "2026-09-01T00:00:00Z" }]);
    }
    return Response.json(options.project ?? project);
  }));
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("GitLabSource snapshot ingestion", () => {
  it("carries commit identity and reads every endpoint at the requested ref", async () => {
    const calls = server();
    const snapshot = await new GitLabSource().fetchSnapshot(parsed, { ref: "feature/unicode" });
    expect(snapshot.meta).toMatchObject({ owner: "group/sub", name: "project", headSha: sha, isPrivate: false });
    expect(snapshot.commits[0]).toMatchObject({ message: "fix a defect", authorName: "Author" });
    expect(snapshot.files.map(f => f.path)).toEqual(["README.md", "package.json"]);
    expect(snapshot.coverage).toBe(0.95);
    for (const url of calls.filter(u => u.pathname.includes("/repository/"))) {
      expect(url.searchParams.get(url.pathname.endsWith("/commits") ? "ref_name" : "ref")).toBe("feature/unicode");
    }
  });

  it("follows tree pages and quarantines memory outside the scoring files", async () => {
    const calls = server({ paged: true, contents: { "README.md": "# repo", ".ai/memory/0001-lesson.md": "private memory" } });
    const snapshot = await new GitLabSource().fetchSnapshot(parsed);
    expect(calls.filter(u => u.pathname.endsWith("/tree")).map(u => u.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.files.map(f => f.path)).toEqual(["README.md"]);
    expect(snapshot.memoryFiles?.map(f => f.path)).toEqual([".ai/memory/0001-lesson.md"]);
    expect(snapshot.coverage).toBe(0.95);
  });

  it("keeps a failed file read visible through reduced coverage", async () => {
    server({ contents: { "README.md": "# repo", "package.json": null } });
    const snapshot = await new GitLabSource().fetchSnapshot(parsed);
    expect(snapshot.files.map(f => f.path)).toEqual(["README.md"]);
    expect(snapshot.coverage).toBeLessThan(0.8);
  });

  it("does not fabricate a head SHA when the commit endpoint is unavailable", async () => {
    server({ commitsStatus: 503 });
    const snapshot = await new GitLabSource().fetchSnapshot(parsed);
    expect(snapshot.commits).toEqual([]);
    expect(snapshot.meta.headSha).toBeUndefined();
    expect(snapshot.files).toHaveLength(2);
  });

  it("applies the same Unicode byte contract as GitHub and local ingestion", async () => {
    server({ contents: { "README.md": "界".repeat(10_000) } });
    const snapshot = await new GitLabSource().fetchSnapshot(parsed);
    expect(snapshot.files[0]).toEqual({ path: "README.md", content: "界".repeat(4_666), bytes: 30_000 });
  });

  it("reports an unreadable project as NOT_FOUND", async () => {
    server({ project: {} });
    await expect(new GitLabSource().fetchSnapshot(parsed)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports an empty tree as EMPTY, rather than an empty successful scan", async () => {
    server({ contents: {} });
    await expect(new GitLabSource().fetchSnapshot(parsed)).rejects.toMatchObject({ code: "EMPTY" });
  });
});

describe("parseGitlabUrl — deep-link intent is surfaced, not silently discarded (github-repo-data-access 07-16 #4)", () => {
  // GitHub's parseRepoUrl keeps unambiguous /pull/<n>, /tree/<ref>, /commit/<sha> on ParsedRepo.
  // GitLab's /-/ separator used to throw that intent away; callers (scan route copies routed.ref /
  // routed.prNumber) then silently scored the default branch.

  it("extracts the MR number from a pasted /-/merge_requests/<n> URL", () => {
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/merge_requests/7")).toEqual({
      owner: "g",
      repo: "p",
      prNumber: 7,
    });
    expect(parseGitlabUrl("https://gitlab.com/group/sub/project/-/merge_requests/12")).toEqual({
      owner: "group/sub",
      repo: "project",
      prNumber: 12,
    });
    expect(parseGitlabUrl("g/p/-/merge_requests/7")).toEqual({ owner: "g", repo: "p", prNumber: 7 });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/merge_requests/7/diffs")).toEqual({
      owner: "g",
      repo: "p",
      prNumber: 7,
    });
  });

  it("extracts a single-segment /-/tree/<ref>, lowercases a /-/commit/<sha>", () => {
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/tree/my-branch")).toEqual({
      owner: "g",
      repo: "p",
      ref: "my-branch",
    });
    expect(parseGitlabUrl(`https://gitlab.com/g/p/-/commit/${"ABC1234".padEnd(40, "0")}`)).toEqual({
      owner: "g",
      repo: "p",
      ref: "abc1234".padEnd(40, "0"),
    });
  });

  it("leaves AMBIGUOUS shapes unset: multi-segment /-/tree/a/b, /-/blob/<ref>/<path>, non-numeric MR, unknown segments", () => {
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/tree/main/src")).toEqual({ owner: "g", repo: "p" });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/blob/main/README.md")).toEqual({ owner: "g", repo: "p" });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/merge_requests/abc")).toEqual({ owner: "g", repo: "p" });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/issues/7")).toEqual({ owner: "g", repo: "p" });
  });

  it("never lets a hostile deep-link segment become a ref (same charset/traversal guard as the coordinates)", () => {
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/tree/..")).toEqual({ owner: "g", repo: "p" });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/commit/deadbeef;rm")).toEqual({ owner: "g", repo: "p" });
    expect(parseGitlabUrl("https://gitlab.com/g/p/-/tree/foo;rm")).toEqual({ owner: "g", repo: "p" });
  });
});
