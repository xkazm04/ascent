// moonshot #8 — the customer-repo write surface. Every assertion here is about a promise made to a
// customer: nothing is sent on a dry run, nothing outside the managed markers is ever written, an
// unchanged block opens no PR, and an applied ruleset is reversible.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/github/app", () => ({
  githubAppFetch: vi.fn(),
  AppApiError: class AppApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly path: string,
      message: string,
    ) {
      super(message);
      this.name = "AppApiError";
    }
  },
}));

import { applyRuleset, listRulesets, proposeManagedBlock, revertRuleset } from "./admission-write";
import { AppApiError, githubAppFetch } from "@/lib/github/app";

const fetchMock = vi.mocked(githubAppFetch);

const BEGIN = "# BEGIN ascent:ai-stance v3";
const END = "# END ascent:ai-stance v3";
const BLOCK = [BEGIN, "infra/** @acme/platform", END].join("\n");
const EXISTING = "* @acme/core\ndocs/ @acme/writers";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Route the fetch mock by path so a test states WHICH GitHub calls it expects, not just how many. */
function routeGitHub(handlers: Record<string, unknown>, notFound: string[] = []) {
  fetchMock.mockImplementation(async (path: string) => {
    for (const p of notFound) if (path.includes(p)) throw new AppApiError(404, path, "not found");
    for (const [key, value] of Object.entries(handlers)) if (path.includes(key)) return value as never;
    return {} as never;
  });
}

const input = (over: Partial<Parameters<typeof proposeManagedBlock>[0]> = {}) => ({
  token: "tok",
  owner: "acme",
  repo: "billing",
  path: "CODEOWNERS",
  block: BLOCK,
  begin: BEGIN,
  end: END,
  branch: "ascent/ai-stance-v3",
  commitMessage: "chore: managed block",
  prTitle: "Managed block",
  prBody: "body",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("proposeManagedBlock — a dry run sends NOTHING", () => {
  beforeEach(() => {
    routeGitHub({ "/repos/acme/billing/contents/CODEOWNERS": { content: b64(EXISTING), sha: "f1" }, "/repos/acme/billing": { default_branch: "main" } });
  });

  it("returns the diff and makes no mutating call", async () => {
    const res = await proposeManagedBlock(input());

    expect(res.diff).toContain(`+${BEGIN}`);
    expect(res.willModify).toBe(true);
    expect(res.willCreate).toBe(false);
    expect(res.pr).toBeUndefined();
    // The load-bearing assertion: not one call carried a method other than the implicit GET.
    for (const [, , init] of fetchMock.mock.calls) {
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
  });

  it("never shows a line the customer wrote as a removal", async () => {
    const { diff } = await proposeManagedBlock(input());
    for (const line of EXISTING.split("\n")) expect(diff).not.toContain(`-${line}`);
  });

  it("reads the BASE branch, not our generated branch", async () => {
    await proposeManagedBlock(input());
    // Reading our own branch would show a no-op after the first run, so the diff a reviewer approves
    // would stop being the diff against what is actually shipping.
    const reads = fetchMock.mock.calls.map(([p]) => p as string).filter((p) => p.includes("contents/CODEOWNERS"));
    expect(reads.some((p) => p.includes("ref=main"))).toBe(true);
    expect(reads.every((p) => !p.includes("ref=ascent"))).toBe(true);
  });
});

describe("proposeManagedBlock — a confirmed run", () => {
  it("creates the branch, PUTs the spliced file and opens a DRAFT pr", async () => {
    routeGitHub(
      {
        "/repos/acme/billing/contents/CODEOWNERS?ref=main": { content: b64(EXISTING), sha: "f1" },
        "/repos/acme/billing/git/ref/heads/main": { object: { sha: "base-sha" } },
        "/repos/acme/billing/pulls": { html_url: "https://github.com/acme/billing/pull/9", number: 9 },
        "/repos/acme/billing": { default_branch: "main" },
      },
      ["contents/CODEOWNERS?ref=ascent"], // the file is not on our branch yet
    );

    const res = await proposeManagedBlock(input({ confirm: true }));

    expect(res.pr).toEqual({ url: "https://github.com/acme/billing/pull/9", number: 9, branch: "ascent/ai-stance-v3", reused: false });
    const put = fetchMock.mock.calls.find(([, , i]) => (i as RequestInit | undefined)?.method === "PUT")!;
    const written = Buffer.from(JSON.parse((put[2] as RequestInit).body as string).content, "base64").toString("utf8");
    // Everything the customer wrote survives, and the managed block is appended.
    expect(written).toContain("* @acme/core");
    expect(written).toContain(BLOCK);
    const pr = fetchMock.mock.calls.find(([p, , i]) => (p as string).endsWith("/pulls") && (i as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((pr[2] as RequestInit).body as string).draft).toBe(true);
  });

  // Idempotence, at the layer where it costs money: a recompile that changes nothing must not open a
  // PR, or the product trains a team to ignore its pull requests.
  it("writes NOTHING when the block is already current, even with confirm", async () => {
    const current = EXISTING + "\n\n" + BLOCK + "\n";
    routeGitHub({ "contents/CODEOWNERS": { content: b64(current), sha: "f1" }, "/repos/acme/billing": { default_branch: "main" } });

    const res = await proposeManagedBlock(input({ confirm: true }));

    expect(res.diff).toBe("");
    expect(res.pr).toBeUndefined();
    for (const [, , init] of fetchMock.mock.calls) expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
  });

  it("reports a missing file as a CREATE rather than failing the way openDraftPr would", async () => {
    // openDraftPr refuses an existing base file by design; this writer's whole reason to exist is the
    // opposite case. A file that is absent is simply created.
    routeGitHub({ "/repos/acme/billing": { default_branch: "main" } }, ["contents/CODEOWNERS"]);
    const res = await proposeManagedBlock(input());
    expect(res.willCreate).toBe(true);
    expect(res.willModify).toBe(false);
    expect(res.diff).toContain(`+${BEGIN}`);
  });
});

describe("rulesets — the one real mutation, and its reversal", () => {
  const proposal = {
    name: "ascent:ai-oversight (acme/billing)",
    target: "branch" as const,
    enforcement: "active" as const,
    conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
    rules: [{ type: "pull_request", parameters: { required_approving_review_count: 2 } }],
  };

  it("returns the created id — the reversal handle", async () => {
    fetchMock.mockResolvedValue({ id: 4242 } as never);
    expect(await applyRuleset("tok", "acme", "billing", proposal)).toBe("4242");
    const [path, , init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("/repos/acme/billing/rulesets");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("lists observed rulesets for the dry run, and degrades to [] on a shape it does not recognize", async () => {
    fetchMock.mockResolvedValue([{ id: 1, name: "existing", enforcement: "active" }] as never);
    expect(await listRulesets("tok", "acme", "billing")).toHaveLength(1);
    fetchMock.mockResolvedValue({ message: "not an array" } as never);
    expect(await listRulesets("tok", "acme", "billing")).toEqual([]);
  });

  it("reverts by DELETE, and treats a 404 as SUCCESS", async () => {
    fetchMock.mockResolvedValue({} as never);
    await revertRuleset("tok", "acme", "billing", "4242");
    expect((fetchMock.mock.calls[0]![2] as RequestInit).method).toBe("DELETE");

    // Someone deleting it on GitHub directly is the same END STATE the caller asked for. Failing here
    // would strand the stored id forever, leaving a reversal button that can never succeed.
    fetchMock.mockRejectedValue(new AppApiError(404, "/rulesets/4242", "not found"));
    await expect(revertRuleset("tok", "acme", "billing", "4242")).resolves.toBeUndefined();
  });

  it("propagates a real failure rather than reporting a reversal that did not happen", async () => {
    fetchMock.mockRejectedValue(new AppApiError(403, "/rulesets/4242", "forbidden"));
    await expect(revertRuleset("tok", "acme", "billing", "4242")).rejects.toThrow("forbidden");
  });
});
