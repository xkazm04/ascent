// Failure paths of the re-convergence rollout: a failed mint or org lookup writes nothing, an
// unexpected per-repo error keeps its row but is reported, a failed version read degrades the audit
// row (reported), and a rejected audit write still answers the 200, reported.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { respondError, reportHandledError, requirePrWriteTarget } = vi.hoisted(() => ({
  respondError: vi.fn((status: number, message: string) => Response.json({ error: message }, { status })),
  reportHandledError: vi.fn(),
  requirePrWriteTarget: vi.fn(),
}));
vi.mock("@/lib/api/respond", () => ({ respondError, reportHandledError }));
vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {},
  parseRepoUrl: (input: string) => {
    const [owner, repo] = String(input).split("/");
    return owner && repo ? { owner, repo } : null;
  },
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  isAppConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/github/pr-route", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/pr-route")>()),
  requirePrWriteTarget,
}));
vi.mock("@/lib/db", () => ({ getOrgId: vi.fn(), recordAudit: vi.fn() }));
vi.mock("@/lib/db/practice-adoption", () => ({
  listBehindRepos: vi.fn(async () => ({ repos: [], latestVersion: null, fromVersion: null })),
  listDriftedRepos: vi.fn(),
}));
vi.mock("@/lib/practices/apply", () => ({ applyPracticeToRepo: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));

import { POST } from "./route";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getOrgId, recordAudit } from "@/lib/db";
import { listBehindRepos } from "@/lib/db/practice-adoption";
import { applyPracticeToRepo } from "@/lib/practices/apply";

const targets = ["acme/a", "acme/b"].map((raw) => {
  const [owner, repo] = raw.split("/");
  return { raw, owner, repo, token: "t", parsed: { owner, repo } };
});
const run = (mode = "drifted") =>
  POST(
    new Request("http://localhost/api/practices/rollout", {
      method: "POST",
      body: JSON.stringify({ org: "acme", practiceId: "agents-md", mode, repos: ["acme/a", "acme/b"] }),
    }),
  );
const opened = (async (_t: string, ref: { repo: string }) => ({
  kind: "ok",
  pr: { url: "u", number: 1, reused: false },
  ctx: { fullName: `acme/${ref.repo}` },
  artifact: { path: "AGENTS.md" },
})) as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(isAppConfigured).mockReturnValue(true);
  requirePrWriteTarget.mockResolvedValue({ org: "acme", token: "t", targets });
  vi.mocked(getOrgId).mockResolvedValue("org-1");
});

describe("POST /api/practices/rollout: failures", () => {
  it("applies nothing and reports a 500 when the org lookup throws", async () => {
    const boom = new Error("db down");
    vi.mocked(getOrgId).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(500);
    expect(respondError).toHaveBeenCalledWith(500, "Failed to open the rollout PRs.", { cause: boom });
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("reports a repo that throws a plain Error and keeps the others", async () => {
    const boom = new Error("kaboom");
    vi.mocked(applyPracticeToRepo).mockImplementation((async (_t: string, ref: { repo: string }) => {
      if (ref.repo === "a") throw boom;
      return { kind: "ok", pr: { url: "u", number: 1, reused: false }, ctx: { fullName: "acme/b" }, artifact: { path: "AGENTS.md" } };
    }) as never);
    const res = await run();
    const { results } = (await res.json()) as { results: { repo: string; ok: boolean; error?: string }[] };
    expect(results).toContainEqual({ repo: "acme/a", ok: false, error: "Failed to open the starter PR." });
    expect(results.find((r) => r.repo === "acme/b")?.ok).toBe(true);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.anything());
  });

  // Council r2 robustness-3: a CLASSIFIED 5xx kept its row copy and was never logged or reported.
  it("reports a classified 5xx row with its cause, and keeps a classified 4xx row quiet", async () => {
    const upstream = Object.assign(new AppApiError("app 500"), { status: 500 });
    const scope = Object.assign(new AppApiError("app 403"), { status: 403 });
    vi.mocked(applyPracticeToRepo).mockImplementation((async (_t: string, ref: { repo: string }) => {
      throw ref.repo === "a" ? upstream : scope;
    }) as never);
    const res = await run();
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { repo: string; ok: boolean; error?: string }[] };
    expect(results).toEqual([
      { repo: "acme/a", ok: false, error: "GitHub rejected the write. Check the repo and base branch." },
      { repo: "acme/b", ok: false, error: "The installation lacks contents/PR write access. Update the GitHub App's permissions." },
    ]);
    expect(reportHandledError).toHaveBeenCalledTimes(1);
    expect(reportHandledError).toHaveBeenCalledWith(upstream, expect.objectContaining({ status: 502 }));
    expect(console.error).toHaveBeenCalledWith("[practices/rollout] acme/a upstream write failed", upstream);
  });
});

describe("POST /api/practices/rollout: mint, version read and audit failures", () => {
  it("answers a reported 502 MINT_FAILED when the token mint throws, and writes nothing", async () => {
    const boom = new AppApiError("mint failed");
    requirePrWriteTarget.mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Failed to mint an installation token for this org." });
    expect(respondError).toHaveBeenCalledWith(502, "Failed to mint an installation token for this org.", { cause: boom });
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("a failed behind-version read still opens the PRs and audits a null span, reported", async () => {
    const boom = new Error("db down");
    vi.mocked(listBehindRepos).mockRejectedValue(boom);
    vi.mocked(applyPracticeToRepo).mockImplementation(opened);
    const res = await run("behind");
    expect(res.status).toBe(200);
    expect(applyPracticeToRepo).toHaveBeenCalledTimes(2);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.anything());
    expect(vi.mocked(recordAudit).mock.calls[0]![1]).toMatchObject({ mode: "behind", fromVersion: null, toVersion: null });
  });

  it("a rejected audit write after the PRs opened still answers the 200 with the results, reported", async () => {
    const boom = new Error("audit down");
    vi.mocked(applyPracticeToRepo).mockImplementation(opened);
    vi.mocked(recordAudit).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: { repo: string; ok: boolean }[]; attempted: number; skipped: number };
    expect(json.results.map((r) => [r.repo, r.ok])).toEqual([["acme/a", true], ["acme/b", true]]);
    expect(json.attempted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(respondError).not.toHaveBeenCalled();
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.anything());
    expect(console.error).toHaveBeenCalledWith("[practices/rollout] audit write failed", boom);
  });
});
