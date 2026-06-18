// Pins the webhook redelivery-retry net (github-app-connect 06-11 #1): the route marks a delivery
// id seen BEFORE processing (replay defense), so a transient failure in a synchronous installation
// handler must RELEASE the dedup slot — GitHub's redelivery is the only retry, and deduping it
// would turn the transient failure into a permanently lost install/uninstall. Successful
// processing must keep the slot (genuine replays stay deduped). The GitHub / DB boundaries are
// mocked; signature verification is stubbed true (it has its own unit coverage).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InstallationInfo } from "@/lib/github/app";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  },
  after: vi.fn(),
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {
    constructor(
      readonly status: number,
      readonly path: string,
    ) {
      super(`GitHub App API ${status} on ${path}`);
      this.name = "AppApiError";
    }
  },
  getInstallation: vi.fn(),
  getInstallationToken: vi.fn(),
  isAppConfigured: () => true,
  listInstallationRepos: vi.fn(),
  verifyWebhook: () => true,
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(),
  getOrgId: vi.fn(),
  getScanReportByCommit: vi.fn(),
  isDbConfigured: () => true,
  isRepoWatched: vi.fn(),
  persistScanReport: vi.fn(),
  reconcileWatchedRepos: vi.fn(async () => 0),
  removeInstallation: vi.fn(),
  reportPermalink: vi.fn(() => "/report/x"),
  unwatchReposForInstallation: vi.fn(),
  upsertInstallation: vi.fn(),
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/scoring/gate", () => ({ evaluateGate: vi.fn() }));
vi.mock("@/lib/scoring/gate-comment", () => ({ buildGateComment: vi.fn(), GATE_COMMENT_MARKER: "<!-- gate -->" }));
vi.mock("@/lib/github/checks", () => ({ createCheckRun: vi.fn(), upsertStickyComment: vi.fn() }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn() }));
vi.mock("@/lib/scoring/engine", () => ({ diffReports: vi.fn() }));

import { POST } from "./route";
import { after } from "next/server";
import { AppApiError, getInstallation, getInstallationToken, listInstallationRepos } from "@/lib/github/app";
import {
  getInstallationIdForOwner,
  getScanReportByCommit,
  isRepoWatched,
  persistScanReport,
  reconcileWatchedRepos,
  removeInstallation,
  unwatchReposForInstallation,
  upsertInstallation,
} from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { checkAndAlertRegression } from "@/lib/scan-alerts";

const mockGetInstallation = vi.mocked(getInstallation);
const mockGetToken = vi.mocked(getInstallationToken);
const mockUpsert = vi.mocked(upsertInstallation);
const mockRemove = vi.mocked(removeInstallation);
const mockAfter = vi.mocked(after);
const mockListRepos = vi.mocked(listInstallationRepos);
const mockReconcile = vi.mocked(reconcileWatchedRepos);
const mockUnwatch = vi.mocked(unwatchReposForInstallation);
const mockIdForOwner = vi.mocked(getInstallationIdForOwner);
const mockScan = vi.mocked(scanRepository);
const mockEvaluateGate = vi.mocked(evaluateGate);
const mockBuildComment = vi.mocked(buildGateComment);
const mockCreateCheckRun = vi.mocked(createCheckRun);
const mockStickyComment = vi.mocked(upsertStickyComment);
const mockIsRepoWatched = vi.mocked(isRepoWatched);
const mockPersist = vi.mocked(persistScanReport);
const mockGetReportByCommit = vi.mocked(getScanReportByCommit);
const mockCheckRegression = vi.mocked(checkAndAlertRegression);

/** Run the work the route deferred via after() — the test stands in for the post-response phase. */
async function runDeferred(): Promise<void> {
  for (const call of mockAfter.mock.calls) {
    await (call[0] as () => Promise<void>)();
  }
  mockAfter.mockClear();
}

const installation = (over: Partial<InstallationInfo> = {}): InstallationInfo => ({
  id: 42,
  account: "acme",
  type: "Organization",
  suspendedAt: null,
  ...over,
});

async function post(event: string, delivery: string, payload: unknown): Promise<Record<string, unknown>> {
  const res = await POST(
    new Request("http://localhost/api/app/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=stubbed",
        "x-github-event": event,
        "x-github-delivery": delivery,
      },
      body: JSON.stringify(payload),
    }),
  );
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// The dedup map is module-level state shared across this file — every test uses its own delivery id.
describe("POST /api/app/webhook — installation lifecycle redelivery net", () => {
  it("releases the delivery when the `created` confirm/upsert fails, so a redelivery retries", async () => {
    mockGetInstallation.mockRejectedValueOnce(new Error("GitHub 502"));
    const first = await post("installation", "del-created-retry", { action: "created", installation: { id: 42 } });
    expect(first.duplicate).toBeUndefined();
    expect(mockUpsert).not.toHaveBeenCalled();

    // GitHub redelivers the SAME delivery id; the slot must have been released so this one processes.
    mockGetInstallation.mockResolvedValueOnce(installation());
    const second = await post("installation", "del-created-retry", { action: "created", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    expect(mockUpsert).toHaveBeenCalledWith({ login: "acme", installationId: 42 });
  });

  it("keeps a successfully processed delivery deduped (replay defense intact)", async () => {
    mockGetInstallation.mockResolvedValue(installation());
    await post("installation", "del-created-ok", { action: "created", installation: { id: 42 } });
    const replay = await post("installation", "del-created-ok", { action: "created", installation: { id: 42 } });
    expect(replay.duplicate).toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("releases the delivery when a `deleted` can't be confirmed transiently, so the redelivery tears down", async () => {
    // First delivery: GitHub confirm hiccups (5xx) — fail closed, do NOT remove, but stay retryable.
    mockGetInstallation.mockRejectedValueOnce(new AppApiError(502, "/app/installations/42"));
    await post("installation", "del-deleted-retry", { action: "deleted", installation: { id: 42 } });
    expect(mockRemove).not.toHaveBeenCalled();

    // Redelivery: GitHub now 404s — the authoritative confirmation that the installation is gone.
    mockGetInstallation.mockRejectedValueOnce(new AppApiError(404, "/app/installations/42"));
    const second = await post("installation", "del-deleted-retry", { action: "deleted", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    expect(mockRemove).toHaveBeenCalledWith(42);
  });

  it("does not act on a forged `deleted` that GitHub says is still active (and never throws)", async () => {
    mockGetInstallation.mockResolvedValue(installation());
    const res = await post("installation", "del-deleted-forged", { action: "deleted", installation: { id: 42 } });
    expect(res.ok).toBe(true);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("releases the delivery when removeInstallation itself throws after a confirmed delete", async () => {
    mockGetInstallation.mockRejectedValue(new AppApiError(404, "/app/installations/42"));
    mockRemove.mockRejectedValueOnce(new Error("db blip"));
    await post("installation", "del-deleted-dbblip", { action: "deleted", installation: { id: 42 } });

    mockRemove.mockResolvedValueOnce(undefined);
    const second = await post("installation", "del-deleted-dbblip", { action: "deleted", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});

// Pins github-app-connect 06-11 #4: `repositories_removed` must NOT be acted on verbatim — a valid
// signature proves authenticity, not ownership/freshness, so a forged-but-signed delivery naming a
// victim's installation could otherwise silently unwatch their repos with no self-heal. Teardown
// goes through the deferred reconcile, which unwatches only what GitHub confirms is gone.
describe("POST /api/app/webhook — installation_repositories confirmation discipline", () => {
  it("never unwatches straight from the payload's repositories_removed", async () => {
    mockListRepos.mockResolvedValueOnce([
      { fullName: "acme/still-accessible" } as Awaited<ReturnType<typeof listInstallationRepos>>[number],
    ]);
    await post("installation_repositories", "del-repos-forged", {
      action: "removed_repositories" as never,
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/still-accessible" }],
    });
    // The blind fast path is gone: nothing is unwatched from the payload before the response.
    expect(mockUnwatch).not.toHaveBeenCalled();

    // The deferred reconcile consults GitHub's live list — the authoritative set — instead.
    await runDeferred();
    expect(mockUnwatch).not.toHaveBeenCalled();
    expect(mockReconcile).toHaveBeenCalledWith(42, ["acme/still-accessible"]);
  });

  it("releases the delivery when the GitHub-confirmed reconcile fails transiently", async () => {
    mockListRepos.mockRejectedValueOnce(new AppApiError(502, "/installation/repositories"));
    await post("installation_repositories", "del-repos-blip", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/gone" }],
    });
    await runDeferred();
    expect(mockReconcile).not.toHaveBeenCalled();

    // Redelivery is NOT deduped; this time GitHub answers and the repo is confirmed gone.
    mockListRepos.mockResolvedValueOnce([]);
    const second = await post("installation_repositories", "del-repos-blip", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/gone" }],
    });
    expect(second.duplicate).toBeUndefined();
    await runDeferred();
    expect(mockReconcile).toHaveBeenCalledWith(42, []);
  });
});

// Pins test-mastery 06-18 critical #1: the cross-tenant authorization gate `installationMatchesOwner`
// (route.ts:109-148) must FAIL CLOSED. A forged-but-signed pull_request/push delivery that pairs a
// VICTIM's installation id with an ATTACKER's owner login must NOT mint a token / scan a private repo.
// The invariant asserted here, end-to-end through the deferred runPrGate/runPushRescan:
//   getInstallationToken is called ONLY when (a) a STORED owner->installation mapping equals the
//   payload installation id, OR (b) no mapping exists AND GitHub's getInstallation(id).account
//   case-insensitively equals the payload owner. On a DB error, a stored-id mismatch, or a
//   GitHub-account mismatch, NO token is minted (fail closed). A fail-open regression breaks a test.
describe("POST /api/app/webhook — cross-tenant token-mint authorization gate (installationMatchesOwner)", () => {
  // Minimal benign downstream stubs so a PASSING gate doesn't throw before the mint we assert on.
  function stubPrHappyDownstream() {
    mockGetToken.mockResolvedValue("ghs_minted_token");
    mockScan.mockResolvedValue({ repo: { headSha: "headsha" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "success",
      title: "t",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockCreateCheckRun.mockResolvedValue(undefined as Awaited<ReturnType<typeof createCheckRun>>);
    mockStickyComment.mockResolvedValue(undefined as Awaited<ReturnType<typeof upsertStickyComment>>);
  }

  const prPayload = (owner: string, installationId: number) => ({
    action: "opened",
    installation: { id: installationId },
    repository: { name: "secret-repo", default_branch: "main", owner: { login: owner } },
    pull_request: { number: 7, head: { sha: "deadbeef", ref: "feature" }, base: { ref: "main" } },
  });

  // ---- pull_request path (runPrGate) ----

  it("ALLOWS the mint when the STORED owner mapping equals the payload installation id", async () => {
    stubPrHappyDownstream();
    mockIdForOwner.mockResolvedValueOnce("99"); // stored: victimOwner -> installation 99
    await post("pull_request", "gate-stored-match", prPayload("victimOwner", 99));
    await runDeferred();
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledWith(99);
    // No GitHub confirmation needed when a stored mapping already agrees.
    expect(mockGetInstallation).not.toHaveBeenCalled();
  });

  it("REJECTS (no mint) when a STORED mapping points at a DIFFERENT installation id (forged pairing)", async () => {
    stubPrHappyDownstream();
    // The attacker forges owner=victimOwner but uses their OWN installation id 99; the stored truth
    // is that victimOwner is installation 42, so the pairing is rejected — no token, no scan.
    mockIdForOwner.mockResolvedValueOnce("42");
    await post("pull_request", "gate-stored-mismatch", prPayload("victimOwner", 99));
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockCreateCheckRun).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED (no mint) when the owner-mapping DB lookup throws (no fall-through to GitHub path)", async () => {
    stubPrHappyDownstream();
    // A DB error must NOT be downgraded to "no mapping" and slip into the looser confirmation path.
    mockIdForOwner.mockRejectedValueOnce(new Error("db unavailable"));
    await post("pull_request", "gate-db-error", prPayload("victimOwner", 99));
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    // Crucially: it does NOT fall through to a GitHub confirmation when the DB hiccups.
    expect(mockGetInstallation).not.toHaveBeenCalled();
  });

  it("ALLOWS the mint for an UNKNOWN owner only when GitHub confirms the account matches", async () => {
    stubPrHappyDownstream();
    mockIdForOwner.mockResolvedValueOnce(null); // no stored mapping yet
    mockGetInstallation.mockResolvedValueOnce(installation({ id: 77, account: "NewOrg" }));
    // Payload owner casing differs from GitHub's — match must be case-insensitive.
    await post("pull_request", "gate-unknown-confirmed", prPayload("neworg", 77));
    await runDeferred();
    expect(mockGetInstallation).toHaveBeenCalledWith(77);
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledWith(77);
  });

  it("REJECTS (no mint) for an UNKNOWN owner when GitHub's account does NOT match the payload owner", async () => {
    stubPrHappyDownstream();
    mockIdForOwner.mockResolvedValueOnce(null); // no stored mapping
    // The forged payload claims owner=attacker but installation 42 really belongs to "acme".
    mockGetInstallation.mockResolvedValueOnce(installation({ id: 42, account: "acme" }));
    await post("pull_request", "gate-github-mismatch", prPayload("attacker", 42));
    await runDeferred();
    expect(mockGetInstallation).toHaveBeenCalledWith(42);
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED (no mint) for an UNKNOWN owner when the GitHub confirmation lookup throws", async () => {
    stubPrHappyDownstream();
    mockIdForOwner.mockResolvedValueOnce(null);
    mockGetInstallation.mockRejectedValueOnce(new AppApiError(502, "/app/installations/42"));
    await post("pull_request", "gate-github-error", prPayload("attacker", 42));
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  // ---- push path (runPushRescan) — the SAME gate fronts the rescan mint ----

  const pushPayload = (owner: string, installationId: number) => ({
    installation: { id: installationId },
    repository: { name: "secret-repo", default_branch: "main", owner: { login: owner } },
    ref: "refs/heads/main",
    after: "1111111111111111111111111111111111111111",
    deleted: false,
  });

  it("REJECTS the push rescan mint on a forged owner pairing (stored mapping mismatch)", async () => {
    mockIdForOwner.mockResolvedValueOnce("42"); // victimOwner truly maps to 42
    mockIsRepoWatched.mockResolvedValue(true);
    await post("push", "push-stored-mismatch", pushPayload("victimOwner", 99));
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    // The gate is checked BEFORE the watch check / mint, so no rescan side effects fire.
    expect(mockCheckRegression).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on the push path when the owner-mapping lookup throws", async () => {
    mockIdForOwner.mockRejectedValueOnce(new Error("db down"));
    mockIsRepoWatched.mockResolvedValue(true);
    await post("push", "push-db-error", pushPayload("victimOwner", 99));
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("ALLOWS the push rescan mint only after the gate passes (stored mapping agrees)", async () => {
    mockIdForOwner.mockResolvedValueOnce("88"); // victimOwner -> 88, payload also 88: agrees
    mockIsRepoWatched.mockResolvedValue(true);
    mockGetToken.mockResolvedValue("ghs_push_token");
    mockGetReportByCommit.mockResolvedValue(null as Awaited<ReturnType<typeof getScanReportByCommit>>);
    mockScan.mockResolvedValue({ repo: { headSha: "h" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockPersist.mockResolvedValue({ deduped: false } as Awaited<ReturnType<typeof persistScanReport>>);
    await post("push", "push-stored-match", pushPayload("victimOwner", 88));
    await runDeferred();
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetToken).toHaveBeenCalledWith(88);
    expect(mockScan).toHaveBeenCalled();
  });
});
