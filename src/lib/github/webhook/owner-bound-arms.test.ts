// @vitest-environment node
// The three webhook arms that used to write tenant rows with no installation -> owner bind
// (challenge-2026-10-22d github-app-0): the repo-control attribution, the `pull_request_review`
// approval and the `pull_request.closed` merge. Each now runs only behind a BoundDelivery, and a
// refused bind releases the delivery once and writes nothing. Driven through the real route so the
// signature / parse / claim order in front of the arms is the shipped one.

import { describe, it, expect, vi, beforeEach } from "vitest";

const app = vi.hoisted(() => ({ configured: true }));

vi.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
  after: vi.fn(),
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallation: vi.fn(),
  getInstallationToken: vi.fn(),
  isAppConfigured: () => app.configured,
  listInstallationReposResult: vi.fn(),
  verifyWebhook: vi.fn(() => true),
}));
vi.mock("@/lib/db", () => ({
  claimWebhookDelivery: vi.fn(async () => true),
  releaseWebhookDelivery: vi.fn(async () => {}),
  getInstallationIdForOwner: vi.fn(),
  isDbConfigured: () => true,
  isRepoAutoscanned: vi.fn(async () => false),
  listWatchedRepos: vi.fn(async () => []),
  reconcileWatchedRepos: vi.fn(async () => 0),
  removeInstallation: vi.fn(),
  resumeInstallation: vi.fn(),
  suspendInstallation: vi.fn(),
  upsertInstallation: vi.fn(),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueProbeJob: vi.fn(async () => ({ id: "job_1", created: true })),
  resolveRepoJobRef: vi.fn(async () => ({ repoId: "repo_1" })),
}));
vi.mock("@/lib/db/install-grants", () => ({ planGrantedAutoWatch: vi.fn(), applyGrantedAutoWatch: vi.fn() }));
vi.mock("@/lib/db/control-observations", () => ({
  latestObservations: vi.fn(async () => [{ controlId: "branch-protection", state: "pass", value: 1 }]),
  recordObservations: vi.fn(async () => 1),
}));
vi.mock("@/lib/db/ai-changes", () => ({ upsertLiveAiChange: vi.fn(async () => true) }));
vi.mock("@/lib/github/pr-gate", () => ({ runPrGate: vi.fn(async () => {}) }));
vi.mock("@/lib/push-rescan", () => ({ enqueueAndDrainPushRescan: vi.fn() }));
vi.mock("@/lib/registry/registry-push", () => ({ onRegistryPush: vi.fn(async () => ({ kind: "ignored" })) }));

import { POST } from "@/app/api/app/webhook/route";
import { after } from "next/server";
import { getInstallation } from "@/lib/github/app";
import { getInstallationIdForOwner, releaseWebhookDelivery } from "@/lib/db";
import { enqueueProbeJob } from "@/lib/db/scan-jobs";
import { recordObservations } from "@/lib/db/control-observations";
import { upsertLiveAiChange } from "@/lib/db/ai-changes";

const mockAfter = vi.mocked(after);
const mockIdForOwner = vi.mocked(getInstallationIdForOwner);
const mockRelease = vi.mocked(releaseWebhookDelivery);
const mockGetInstallation = vi.mocked(getInstallation);
const mockRecord = vi.mocked(recordObservations);
const mockUpsertAi = vi.mocked(upsertLiveAiChange);
const mockEnqueueProbe = vi.mocked(enqueueProbeJob);

let n = 0;
async function post(event: string, payload: unknown): Promise<void> {
  await POST(
    new Request("http://localhost/api/app/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=x", "x-github-event": event, "x-github-delivery": `ob-${n++}` },
      body: JSON.stringify(payload),
    }),
  );
  for (const call of mockAfter.mock.calls) await (call[0] as () => Promise<void>)();
  mockAfter.mockClear();
}

const repo = { full_name: "acme/api", name: "api", owner: { login: "acme" } };
const aiPr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Add retries",
  body: "Generated with Claude Code",
  created_at: "2026-10-01T00:00:00Z",
  user: { login: "dev", type: "User" },
  labels: [],
  ...over,
});
const review = (installationId: number) => ({
  action: "submitted",
  installation: { id: installationId },
  repository: repo,
  review: { state: "approved", user: { login: "lead" }, submitted_at: "2026-10-02T00:00:00Z" },
  pull_request: aiPr(),
});
const merged = (installationId: number) => ({
  action: "closed",
  installation: { id: installationId },
  repository: repo,
  pull_request: aiPr({ merged: true, merged_at: "2026-10-03T00:00:00Z", merge_commit_sha: "ABC" }),
});

beforeEach(() => {
  vi.clearAllMocks();
  app.configured = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("webhook owner-bound arms - the three arms that used to write unbound", () => {
  it("repository_ruleset with a mismatched installation records no attribution", async () => {
    mockIdForOwner.mockResolvedValue("42");
    await post("repository_ruleset", { action: "edited", installation: { id: 99 }, repository: repo, sender: { login: "mallory" } });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("repository_ruleset with a matching installation still records the attribution", async () => {
    mockIdForOwner.mockResolvedValue("42");
    await post("repository_ruleset", { action: "edited", installation: { id: 42 }, repository: repo, sender: { login: "lead" } });
    expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    expect(mockRecord.mock.calls[0]![0]).toBe("acme");
  });

  it("owner-bind failure in the repo-control arm releases once, enqueues nothing, records nothing", async () => {
    mockIdForOwner.mockResolvedValue("42");
    await post("branch_protection_rule", { action: "deleted", installation: { id: 99 }, repository: repo, sender: { login: "m" } });
    expect(mockRelease).toHaveBeenCalledTimes(1);
    expect(mockEnqueueProbe).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("an approved review with a mismatched installation writes no AiChange and releases once", async () => {
    mockIdForOwner.mockResolvedValue("42");
    await post("pull_request_review", review(99));
    expect(mockUpsertAi).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("a merged AI PR writes one AiChange when bound, and none on a mismatch", async () => {
    mockIdForOwner.mockResolvedValue("42");
    await post("pull_request", merged(42));
    expect(mockUpsertAi).toHaveBeenCalledTimes(1);
    expect(mockUpsertAi.mock.calls[0]![0]).toBe("acme");
    expect(mockUpsertAi.mock.calls[0]![1]).toMatchObject({ state: "MERGED", mergeCommitSha: "abc" });

    mockUpsertAi.mockClear();
    await post("pull_request", merged(99));
    expect(mockUpsertAi).not.toHaveBeenCalled();
  });

  it("a review for an owner with no stored mapping, App unconfigured: no GitHub call, no write", async () => {
    app.configured = false;
    mockIdForOwner.mockResolvedValue(null);
    await post("pull_request_review", review(42));
    expect(mockGetInstallation).not.toHaveBeenCalled();
    expect(mockUpsertAi).not.toHaveBeenCalled();
  });
});
