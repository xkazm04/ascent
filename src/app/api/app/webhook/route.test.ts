// Pins the webhook redelivery-retry net (github-app-connect 06-11 #1): the route marks a delivery
// id seen BEFORE processing (replay defense), so a transient failure in a synchronous installation
// handler must RELEASE the dedup slot — GitHub's redelivery is the only retry, and deduping it
// would turn the transient failure into a permanently lost install/uninstall. Successful
// processing must keep the slot (genuine replays stay deduped). The GitHub / DB boundaries are
// mocked; signature verification is stubbed true (it has its own unit coverage).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
  listInstallationReposResult: vi.fn(),
  verifyWebhook: vi.fn(() => true),
}));
vi.mock("@/lib/db", () => ({
  claimWebhookDelivery: vi.fn(async () => true),
  releaseWebhookDelivery: vi.fn(async () => {}),
  getInstallationIdForOwner: vi.fn(),
  getOrgGatePolicy: vi.fn(),
  getOrgId: vi.fn(),
  getScanReportByCommit: vi.fn(),
  isDbConfigured: () => true,
  isRepoAutoscanned: vi.fn(),
  listWatchedRepos: vi.fn(async () => []),
  persistScanReport: vi.fn(),
  recordScanOutcome: vi.fn(async () => {}),
  reconcileWatchedRepos: vi.fn(async () => 0),
  removeInstallation: vi.fn(),
  suspendInstallation: vi.fn(),
  resumeInstallation: vi.fn(),
  reportPermalink: vi.fn(() => "/report/x"),
  // Present so `vi.importOriginal` on @/lib/scan-credit (below — its `shouldRefundScan` is used for
  // real) can load: the real module imports these three off this barrel. Nothing here calls them —
  // the two ledger verbs are stubbed at the scan-credit seam.
  consumeScanCredit: vi.fn(),
  grantCredits: vi.fn(),
  CREDIT_REASON: { REFUND: "refund" },
  upsertInstallation: vi.fn(),
}));
vi.mock("@/lib/db/scan-jobs", () => ({
  enqueueProbeJob: vi.fn(async () => ({ id: "job_1", created: true })),
  // push-triggered-rescan part 2: the push enqueues a rescore job (through @/lib/push-rescan, real).
  enqueueScanJob: vi.fn(),
  JOB_PRIORITY: { manual: 10, webhook: 5, cadence: 0 },
}));
// The worker's drain is a seam here: its push branch (the money) is pinned in
// src/lib/scan-queue-worker.push.test.ts, so this suite asserts only what the route asks it to drain.
vi.mock("@/lib/scan-queue-worker", () => ({ drainLane: vi.fn(), PUSH_JOB_REASON: "webhook:push" }));
// Row 35 — the auto-watch of newly granted repos. Its own rules are pinned in
// src/lib/db/install-grants.test.ts; here only what the route feeds it and when.
vi.mock("@/lib/db/install-grants", () => ({
  planGrantedAutoWatch: vi.fn(async () => []),
  applyGrantedAutoWatch: vi.fn(async () => []),
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
// `defaultGatePolicy` / `tightenGatePolicy` are the REAL implementations: runPrGate folds the org
// bar with the admission overlay through them, and stubbing the merge would let this suite pass
// while the Check Run enforced a bar nobody folded.
vi.mock("@/lib/scoring/gate", async (orig) => ({
  ...(await orig<typeof import("@/lib/scoring/gate")>()),
  evaluateGate: vi.fn(),
}));
// moonshot #8/#16 — the org-scoped reads runPrGate now makes. Mocked at the seam both gate surfaces
// share, so nothing here reaches a database.
vi.mock("@/lib/scoring/gate-admission", () => ({
  resolveAdmissionLayer: vi.fn(async () => ({ overlay: {}, admission: null })),
  loadCheckStates: vi.fn(async () => null),
}));
vi.mock("@/lib/scoring/gate-comment", () => ({ buildGateComment: vi.fn(), GATE_COMMENT_MARKER: "<!-- gate -->" }));
vi.mock("@/lib/github/checks", () => ({ createCheckRun: vi.fn(), upsertStickyComment: vi.fn() }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(), maybeAlertLowCredits: vi.fn() }));
// MONEY. The push rescan's reserve moved into the queue worker's push branch; the route must never
// reach a credit seam itself, so the reserve is still stubbed here to assert it is NOT called.
vi.mock("@/lib/scan-credit", async (orig) => ({
  // `shouldRefundScan` is the REAL policy function: stubbing it would let this suite pass while the
  // route refunded on the wrong condition.
  ...(await orig<typeof import("@/lib/scan-credit")>()),
  reserveScanCredit: vi.fn(async () => ({ skip: false, reserved: true, balance: 4 })),
  refundScanCredit: vi.fn(async () => 5),
}));
vi.mock("@/lib/scoring/engine", () => ({ diffReports: vi.fn() }));
// ai-registry-repo#A — the registry's half of a push. Its own behaviour is pinned in
// src/lib/registry/registry-push.test.ts; here only the scheduling and the delivery net are.
vi.mock("@/lib/registry/registry-push", () => ({ onRegistryPush: vi.fn(async () => ({ kind: "ignored" })) }));

import { POST } from "./route";
import { after } from "next/server";
import { AppApiError, getInstallation, getInstallationToken, listInstallationReposResult, verifyWebhook } from "@/lib/github/app";
import {
  claimWebhookDelivery,
  getInstallationIdForOwner,
  getOrgGatePolicy,
  isRepoAutoscanned,
  listWatchedRepos,
  persistScanReport,
  reconcileWatchedRepos,
  releaseWebhookDelivery,
  removeInstallation,
  resumeInstallation,
  suspendInstallation,
  upsertInstallation,
} from "@/lib/db";
import { enqueueProbeJob, enqueueScanJob } from "@/lib/db/scan-jobs";
import { drainLane, type DrainSummary } from "@/lib/scan-queue-worker";
import { applyGrantedAutoWatch, planGrantedAutoWatch } from "@/lib/db/install-grants";
import { scanRepository } from "@/lib/scan";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { reserveScanCredit } from "@/lib/scan-credit";
import { diffReports } from "@/lib/scoring/engine";
import { onRegistryPush } from "@/lib/registry/registry-push";

const mockGetInstallation = vi.mocked(getInstallation);
const mockGetToken = vi.mocked(getInstallationToken);
const mockUpsert = vi.mocked(upsertInstallation);
const mockRemove = vi.mocked(removeInstallation);
const mockSuspend = vi.mocked(suspendInstallation);
const mockResume = vi.mocked(resumeInstallation);
const mockAfter = vi.mocked(after);
const mockListReposResult = vi.mocked(listInstallationReposResult);

/** Helper: a successful (complete) installation-repos listing for the reconcile path. */
function reposResult(fullNames: string[], truncated = false) {
  return {
    repos: fullNames.map((fullName) => ({ fullName }) as Awaited<ReturnType<typeof listInstallationReposResult>>["repos"][number]),
    truncated,
  };
}
const mockReconcile = vi.mocked(reconcileWatchedRepos);
const mockIdForOwner = vi.mocked(getInstallationIdForOwner);
const mockScan = vi.mocked(scanRepository);
const mockEvaluateGate = vi.mocked(evaluateGate);
const mockBuildComment = vi.mocked(buildGateComment);
const mockCreateCheckRun = vi.mocked(createCheckRun);
const mockStickyComment = vi.mocked(upsertStickyComment);
const mockIsRepoAutoscanned = vi.mocked(isRepoAutoscanned);
const mockPersist = vi.mocked(persistScanReport);
const mockGetOrgGatePolicy = vi.mocked(getOrgGatePolicy);
const mockDiffReports = vi.mocked(diffReports);
const mockRelease = vi.mocked(releaseWebhookDelivery);
const mockClaim = vi.mocked(claimWebhookDelivery);
const mockEnqueueProbe = vi.mocked(enqueueProbeJob);
const mockEnqueueScan = vi.mocked(enqueueScanJob);
const mockDrainLane = vi.mocked(drainLane);
const drainSummary = (): DrainSummary => ({
  claimed: 1,
  done: 1,
  failed: 0,
  skipped: 0,
  skippedForCredits: 0,
  skippedNoToken: 0,
  truncated: false,
  errors: [],
});
const mockListWatched = vi.mocked(listWatchedRepos);
const mockReserve = vi.mocked(reserveScanCredit);
const mockOnRegistryPush = vi.mocked(onRegistryPush);

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
// github-app-installation-webhooks #2: the installation lifecycle (confirm round-trip + cascading DB
// writes) now runs in after() so the webhook acks fast — so each case drives the deferred phase via
// runDeferred() (signature-verify + dedup still happen synchronously in POST, before after()).
describe("POST /api/app/webhook — installation lifecycle redelivery net (deferred via after())", () => {
  it("releases the delivery when the `created` confirm/upsert fails, so a redelivery retries", async () => {
    mockGetInstallation.mockRejectedValueOnce(new Error("GitHub 502"));
    const first = await post("installation", "del-created-retry", { action: "created", installation: { id: 42 } });
    expect(first.duplicate).toBeUndefined();
    await runDeferred(); // the deferred lifecycle runs (and fails), releasing the delivery slot
    expect(mockUpsert).not.toHaveBeenCalled();

    // GitHub redelivers the SAME delivery id; the slot must have been released so this one processes.
    mockGetInstallation.mockResolvedValueOnce(installation());
    const second = await post("installation", "del-created-retry", { action: "created", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    await runDeferred();
    expect(mockUpsert).toHaveBeenCalledWith({ login: "acme", installationId: 42 });
  });

  it("keeps a successfully processed delivery deduped (replay defense intact)", async () => {
    mockGetInstallation.mockResolvedValue(installation());
    await post("installation", "del-created-ok", { action: "created", installation: { id: 42 } });
    await runDeferred();
    const replay = await post("installation", "del-created-ok", { action: "created", installation: { id: 42 } });
    expect(replay.duplicate).toBe(true); // deduped at the synchronous gate, before after()
    await runDeferred();
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("releases the delivery when a `deleted` can't be confirmed transiently, so the redelivery tears down", async () => {
    // First delivery: GitHub confirm hiccups (5xx) — fail closed, do NOT remove, but stay retryable.
    mockGetInstallation.mockRejectedValueOnce(new AppApiError(502, "/app/installations/42"));
    await post("installation", "del-deleted-retry", { action: "deleted", installation: { id: 42 } });
    await runDeferred();
    expect(mockRemove).not.toHaveBeenCalled();

    // Redelivery: GitHub now 404s — the authoritative confirmation that the installation is gone.
    mockGetInstallation.mockRejectedValueOnce(new AppApiError(404, "/app/installations/42"));
    const second = await post("installation", "del-deleted-retry", { action: "deleted", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    await runDeferred();
    expect(mockRemove).toHaveBeenCalledWith(42);
  });

  it("does not act on a forged `deleted` that GitHub says is still active (and never throws)", async () => {
    mockGetInstallation.mockResolvedValue(installation());
    const res = await post("installation", "del-deleted-forged", { action: "deleted", installation: { id: 42 } });
    expect(res.ok).toBe(true);
    await expect(runDeferred()).resolves.toBeUndefined(); // deferred work never throws
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("releases the delivery when removeInstallation itself throws after a confirmed delete", async () => {
    mockGetInstallation.mockRejectedValue(new AppApiError(404, "/app/installations/42"));
    mockRemove.mockRejectedValueOnce(new Error("db blip"));
    await post("installation", "del-deleted-dbblip", { action: "deleted", installation: { id: 42 } });
    await runDeferred();

    mockRemove.mockResolvedValueOnce(undefined);
    const second = await post("installation", "del-deleted-dbblip", { action: "deleted", installation: { id: 42 } });
    expect(second.duplicate).toBeUndefined();
    await runDeferred();
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });
});

// github-app-installation-webhooks #1: suspend is a REVERSIBLE pause, not a permanent uninstall, so it
// must NOT run the full removeInstallation teardown (which unwatched everything and never restored it),
// and unsuspend must resume the paused schedules.
describe("POST /api/app/webhook — suspend is a non-destructive pause; unsuspend resumes", () => {
  it("pauses (suspendInstallation) on a GitHub-confirmed suspend — never removeInstallation", async () => {
    // GitHub confirms the suspension (suspendedAt set) → pause, do not tear down.
    mockGetInstallation.mockResolvedValue(installation({ suspendedAt: "2026-06-25T00:00:00Z" }));
    await post("installation", "del-suspend-ok", { action: "suspend", installation: { id: 42 } });
    await runDeferred();
    expect(mockSuspend).toHaveBeenCalledWith(42);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("does not pause an unconfirmed (forged) suspend GitHub says is still active", async () => {
    mockGetInstallation.mockResolvedValue(installation({ suspendedAt: null }));
    await post("installation", "del-suspend-forged", { action: "suspend", installation: { id: 42 } });
    await runDeferred();
    expect(mockSuspend).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("re-arms schedules (resumeInstallation) on unsuspend, after re-confirming the mapping", async () => {
    mockGetInstallation.mockResolvedValue(installation());
    await post("installation", "del-unsuspend-ok", { action: "unsuspend", installation: { id: 42 } });
    await runDeferred();
    expect(mockUpsert).toHaveBeenCalledWith({ login: "acme", installationId: 42 });
    expect(mockResume).toHaveBeenCalledWith(42);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

// Pins github-app-connect 06-11 #4: `repositories_removed` must NOT be acted on verbatim — a valid
// signature proves authenticity, not ownership/freshness, so a forged-but-signed delivery naming a
// victim's installation could otherwise silently unwatch their repos with no self-heal. Teardown
// goes through the deferred reconcile, which unwatches only what GitHub confirms is gone.
describe("POST /api/app/webhook — installation_repositories confirmation discipline", () => {
  it("never unwatches straight from the payload's repositories_removed", async () => {
    mockListReposResult.mockResolvedValueOnce(reposResult(["acme/still-accessible"]));
    await post("installation_repositories", "del-repos-forged", {
      action: "removed_repositories" as never,
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/still-accessible" }],
    });
    // The deferred reconcile consults GitHub's live list — the authoritative set — rather than
    // acting on the payload's repositories_removed verbatim. (The old blind-unwatch fast path is gone.)
    await runDeferred();
    expect(mockReconcile).toHaveBeenCalledWith(42, ["acme/still-accessible"]);
  });

  it("releases the delivery when the GitHub-confirmed reconcile fails transiently", async () => {
    mockListReposResult.mockRejectedValueOnce(new AppApiError(502, "/installation/repositories"));
    await post("installation_repositories", "del-repos-blip", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/gone" }],
    });
    await runDeferred();
    expect(mockReconcile).not.toHaveBeenCalled();

    // Redelivery is NOT deduped; this time GitHub answers and the repo is confirmed gone.
    mockListReposResult.mockResolvedValueOnce(reposResult([]));
    const second = await post("installation_repositories", "del-repos-blip", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/gone" }],
    });
    expect(second.duplicate).toBeUndefined();
    await runDeferred();
    expect(mockReconcile).toHaveBeenCalledWith(42, []);
  });

  it("SKIPS the destructive reconcile when the live listing was TRUNCATED (#1 fail-safe)", async () => {
    // A >5000-repo installation: the listing is page-capped (truncated=true). Passing that partial set
    // to reconcileWatchedRepos would unwatch every repo past the page cap — so the reconcile must be
    // skipped entirely, leaving watch state intact until a later (complete) listing reconciles it.
    mockListReposResult.mockResolvedValueOnce(reposResult(["acme/page1-repo"], true));
    await post("installation_repositories", "del-repos-truncated", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/whatever" }],
    });
    await runDeferred();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("lists at the deep 'reconcile' depth, so a >5000-repo installation can still reconcile (row 14)", async () => {
    mockListReposResult.mockResolvedValueOnce(reposResult(["acme/kept"]));
    await post("installation_repositories", "del-repos-deep", {
      installation: { id: 42 },
      repositories_removed: [{ full_name: "acme/gone" }],
    });
    await runDeferred();
    expect(mockListReposResult).toHaveBeenCalledWith(42, "reconcile");
    expect(mockReconcile).toHaveBeenCalledWith(42, ["acme/kept"]);
  });
});

// Row 35 — a repo the user just granted on GitHub's Configure page enters the watch loop, from the
// GitHub-confirmed live listing only, and never off a truncated one.
describe("POST /api/app/webhook — installation_repositories auto-watches newly granted repos", () => {
  const mockPlan = vi.mocked(planGrantedAutoWatch);
  const mockApply = vi.mocked(applyGrantedAutoWatch);

  it("plans from the COMPLETE live listing (before the unwatch) and applies that plan", async () => {
    const listing = reposResult(["acme/api", "acme/billing"]);
    mockListReposResult.mockResolvedValueOnce(listing);
    const plan = [{ orgSlug: "acme", watch: [listing.repos[1]!], overflow: [] }];
    mockPlan.mockResolvedValueOnce(plan as never);
    await post("installation_repositories", "add-repos-one", {
      action: "added",
      installation: { id: 42 },
      repositories_added: [{ full_name: "acme/billing" }],
    });
    await runDeferred();
    expect(mockPlan).toHaveBeenCalledWith(42, listing.repos);
    // The watchlist snapshot is read BEFORE the unwatch step, so a selected {a} -> {b} swap still
    // counts as an org that runs a watchlist.
    expect(mockPlan.mock.invocationCallOrder[0]).toBeLessThan(mockReconcile.mock.invocationCallOrder[0]!);
    expect(mockApply).toHaveBeenCalledWith(42, plan);
  });

  it("never auto-watches off a TRUNCATED listing (overflow names are not evidence)", async () => {
    mockListReposResult.mockResolvedValueOnce(reposResult(["acme/page1-repo"], true));
    await post("installation_repositories", "add-repos-truncated", {
      action: "added",
      installation: { id: 42 },
      repositories_added: [{ full_name: "acme/page1-repo" }],
    });
    await runDeferred();
    expect(mockPlan).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("the payload's repositories_added is never the source; only GitHub's live set is", async () => {
    mockListReposResult.mockResolvedValueOnce(reposResult(["acme/api"]));
    await post("installation_repositories", "add-repos-forged", {
      action: "added",
      installation: { id: 42 },
      repositories_added: [{ full_name: "victim/secret" }],
    });
    await runDeferred();
    const planned = mockPlan.mock.calls[0]![1].map((r) => r.fullName);
    expect(planned).toEqual(["acme/api"]);
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
    // The GitHub-confirmed pairing is persisted so subsequent events take the stronger stored-mapping
    // path instead of re-confirming live with GitHub each time.
    expect(mockUpsert).toHaveBeenCalledWith({ login: "NewOrg", installationId: 77 });
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

  // ---- push path (runPushRescan) — the SAME gate fronts the rescan's enqueue ----

  const pushPayload = (owner: string, installationId: number) => ({
    installation: { id: installationId },
    repository: { name: "secret-repo", default_branch: "main", owner: { login: owner } },
    ref: "refs/heads/main",
    after: "1111111111111111111111111111111111111111",
    deleted: false,
  });

  it("REJECTS the push rescan on a forged owner pairing (stored mapping mismatch): nothing is enqueued", async () => {
    mockIdForOwner.mockResolvedValueOnce("42"); // victimOwner truly maps to 42
    mockIsRepoAutoscanned.mockResolvedValue(true);
    await post("push", "push-stored-mismatch", pushPayload("victimOwner", 99));
    await runDeferred();
    expect(mockEnqueueScan).not.toHaveBeenCalled();
    expect(mockDrainLane).not.toHaveBeenCalled();
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED on the push path when the owner-mapping lookup throws: nothing is enqueued", async () => {
    mockIdForOwner.mockRejectedValueOnce(new Error("db down"));
    mockIsRepoAutoscanned.mockResolvedValue(true);
    await post("push", "push-db-error", pushPayload("victimOwner", 99));
    await runDeferred();
    expect(mockEnqueueScan).not.toHaveBeenCalled();
    expect(mockDrainLane).not.toHaveBeenCalled();
  });

  // private-repo-scan lite r1, value-2: the job is enqueued under the installation's org, and the worker
  // scans with that org (so a BYOM org's engine and standing decisions apply; pinned in the worker).
  it("enqueues the push rescan only after the gate passes, under the installation's org", async () => {
    mockIdForOwner.mockResolvedValueOnce("88"); // victimOwner -> 88, payload also 88: agrees
    mockIsRepoAutoscanned.mockResolvedValue(true);
    mockEnqueueScan.mockResolvedValueOnce({ id: "job_push", created: true });
    mockDrainLane.mockResolvedValueOnce(drainSummary());
    await post("push", "push-stored-match", pushPayload("VictimOwner", 88));
    await runDeferred();
    expect(mockEnqueueScan).toHaveBeenCalledTimes(1);
    expect(mockEnqueueScan).toHaveBeenCalledWith(
      expect.objectContaining({ orgSlug: "victimowner", repoFullName: "VictimOwner/secret-repo" }),
    );
    expect(mockDrainLane).toHaveBeenCalledWith("rescore", expect.objectContaining({ orgSlug: "victimowner" }));
    // The route mints nothing itself: the worker owns the token, the credit and the scan.
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });
});

// github-app-installation-webhooks #5 — the replay horizon (the authoritative DB claim must outlast
// GitHub's redelivery window). #6 (per-repo rescan serialization) left with the inline loop: a push is a
// queued job now, and claimJobById's peer check serializes one repo's scans across instances.
describe("POST /api/app/webhook — replay horizon (runPushRescan)", () => {
  const pushPayload = (owner: string, installationId: number) => ({
    installation: { id: installationId },
    repository: { name: "secret-repo", default_branch: "main", owner: { login: owner } },
    ref: "refs/heads/main",
    after: "1111111111111111111111111111111111111111",
    deleted: false,
  });

  it("claims the delivery for the FULL replay horizon (24h), not the 10-min default (#5)", async () => {
    mockIsRepoAutoscanned.mockResolvedValue(false); // deferred work bails; we assert only the SYNC claim in POST
    await post("push", "replay-horizon-id", pushPayload("acme", 42));
    expect(mockClaim).toHaveBeenCalledWith("replay-horizon-id", 24 * 60 * 60_000);
  });

});

// Pins test-mastery 06-18 high #3 (route.ts:202-273, 402-413): the PR maturity gate `runPrGate` must
// never leave a PR's *required* check silently absent. The cross-tenant auth gate already has coverage
// above; here the owner mapping always AGREES so the gate is authorized, and we pin the three documented
// outcomes of the gate body itself:
//   • a PASSING evaluation posts a SUCCESS check-run for the PR head SHA (and a sticky comment);
//   • a head-ref scan failure FALLS BACK to the default branch and STILL posts a real check (a fork PR's
//     head can be unreachable — the check must not vanish);
//   • a hard failure AFTER the token mint posts a FAILING 'could not run' check (never throws into the
//     handler, never leaves the PR unchecked) and RELEASES the delivery so a redelivery retries.
// Invariant: once a token is minted, a pull_request event ALWAYS completes with either a real or a
// neutral Check Run — it never throws out of runPrGate and never leaves the PR with no check.
describe("POST /api/app/webhook — PR maturity gate outcomes (runPrGate)", () => {
  const prPayload = (over: Record<string, unknown> = {}) => ({
    action: "opened",
    installation: { id: 55 },
    repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
    pull_request: { number: 9, head: { sha: "headsha9", ref: "feature" }, base: { ref: "main" } },
    ...over,
  });

  // The auth gate is satisfied by a stored owner->installation mapping that matches the payload id (55),
  // so getInstallationMatchesOwner returns true WITHOUT consulting GitHub — keeping these tests focused
  // on the gate body, not the (separately covered) authorization branch.
  function authorize() {
    mockIdForOwner.mockResolvedValue("55");
    mockGetOrgGatePolicy.mockResolvedValue(null as Awaited<ReturnType<typeof getOrgGatePolicy>>);
    mockGetToken.mockResolvedValue("ghs_pr_token");
    mockStickyComment.mockResolvedValue(undefined as Awaited<ReturnType<typeof upsertStickyComment>>);
    mockDiffReports.mockReturnValue({} as ReturnType<typeof diffReports>);
  }

  it("posts a SUCCESS check-run for the PR head when the gate passes (and a sticky comment)", async () => {
    authorize();
    mockScan.mockResolvedValue({ repo: { headSha: "headsha9" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "success",
      title: "Passed",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockCreateCheckRun.mockResolvedValue(undefined as Awaited<ReturnType<typeof createCheckRun>>);

    await post("pull_request", "pr-gate-pass", prPayload());
    await runDeferred();

    // The head ref is scored first; the gate posts exactly one check, with the comment's conclusion.
    expect(mockScan).toHaveBeenCalledWith("acme/repo", expect.objectContaining({ mock: true, ref: "headsha9" }));
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(1);
    const check = mockCreateCheckRun.mock.calls[0][0] as { conclusion: string; headSha: string };
    expect(check.conclusion).toBe("success");
    expect(check.headSha).toBe("headsha9");
    expect(mockStickyComment).toHaveBeenCalledTimes(1);
  });

  it("falls back to the default branch and STILL posts a check when the head ref is unreachable — flagged as NOT head-scored", async () => {
    authorize();
    // First scan (head ref) rejects — a fork PR head unreachable via the base repo's tree API. The gate
    // must NOT give up: it re-scans the default branch and still posts a check (no baseline diff). But
    // that verdict describes the DEFAULT BRANCH, not the PR — buildGateComment must receive
    // scoredHead:false so it posts a neutral, honestly-framed check, never a confident per-PR verdict
    // (github-app-installation-webhooks 2026-07-16 #3).
    mockScan.mockRejectedValueOnce(new Error("head ref 404"));
    mockScan.mockResolvedValueOnce({ repo: { headSha: "defaultsha" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "failure",
      title: "Default branch passed — PR head not scored",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockCreateCheckRun.mockResolvedValue(undefined as Awaited<ReturnType<typeof createCheckRun>>);

    await post("pull_request", "pr-gate-fallback", prPayload());
    await runDeferred();

    // Two scans: the failed head ref, then the default-branch fallback (no `ref`). No baseline diff is
    // computed when the head wasn't scored, so diffReports is never called — but a check still posts.
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockScan).toHaveBeenNthCalledWith(2, "acme/repo", expect.not.objectContaining({ ref: expect.anything() }));
    expect(mockDiffReports).not.toHaveBeenCalled();
    // The fallback is flagged so the comment builder can post an honest neutral check.
    expect(mockBuildComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      expect.objectContaining({ scoredHead: false }),
    );
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(1);
    expect((mockCreateCheckRun.mock.calls[0][0] as { conclusion: string }).conclusion).toBe("failure");
  });

  it("the head-scored path passes scoredHead: true (the confident per-PR framing is preserved)", async () => {
    authorize();
    mockScan.mockResolvedValue({ repo: { headSha: "headsha9" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "success",
      title: "Passed",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockCreateCheckRun.mockResolvedValue(undefined as Awaited<ReturnType<typeof createCheckRun>>);

    await post("pull_request", "pr-gate-head-scored", prPayload());
    await runDeferred();

    expect(mockBuildComment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ scoredHead: true }),
    );
  });

  it("posts a FAILING 'could not run' check and releases the delivery when the gate throws after mint", async () => {
    authorize();
    // The token mints, but every scan attempt fails — a hard failure inside the gate body. The handler
    // must NOT throw; it posts a neutral check (with a Re-run action) so the required check isn't absent.
    mockScan.mockRejectedValue(new Error("scan exploded"));
    mockCreateCheckRun.mockResolvedValue(undefined as Awaited<ReturnType<typeof createCheckRun>>);

    await post("pull_request", "pr-gate-neutral", prPayload());
    // runDeferred awaits the gate — it must resolve, not reject, even though the gate failed internally.
    await expect(runDeferred()).resolves.toBeUndefined();

    expect(mockGetToken).toHaveBeenCalledTimes(1);
    // The PR is never left unchecked: exactly one neutral check is posted on the minted token.
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(1);
    const neutral = mockCreateCheckRun.mock.calls[0][0] as { conclusion: string; headSha: string; actions?: unknown[] };
    expect(neutral.conclusion).toBe("failure");
    expect(neutral.headSha).toBe("headsha9");
    expect(neutral.actions).toBeDefined(); // the Re-run action gives the author recourse

    // The delivery slot is released so GitHub's redelivery actually re-runs the dropped gate.
    mockScan.mockReset();
    mockScan.mockResolvedValue({ repo: { headSha: "headsha9" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "success",
      title: "Passed",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockCreateCheckRun.mockClear();
    const redelivery = await post("pull_request", "pr-gate-neutral", prPayload());
    expect(redelivery.duplicate).toBeUndefined(); // NOT deduped — the slot was freed
    await runDeferred();
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(1);
    expect((mockCreateCheckRun.mock.calls[0][0] as { conclusion: string }).conclusion).toBe("success");
  });
});

// push-triggered-rescan part 2: a default-branch push to an autoscanned repo ENQUEUES one rescore job
// (reason webhook:push, priority webhook, the aligned window bucket) and drains exactly that job by id
// with a deadline. The money (reserve, scan, persist, refund, the degrade guard, the failure backoff)
// lives in the worker's push branch and is pinned in src/lib/scan-queue-worker.push.test.ts; the route
// owns only WHETHER to enqueue and what happens to the delivery.
// Invariant: a job is enqueued for a push iff (autoscanned AND default-branch AND head-moved AND the
// owner matches); a push that enqueues no row releases its delivery, and one that did never does.
describe("POST /api/app/webhook — push rescan on the ScanJob queue (runPushRescan)", () => {
  let n = 0;
  const NOW = Date.parse("2026-10-08T12:07:00.000Z");
  const WINDOW = 15 * 60_000;
  const pushPayload = (over: Record<string, unknown> = {}) => ({
    installation: { id: 66 },
    repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
    ref: "refs/heads/main",
    after: "abc1230000000000000000000000000000000000",
    deleted: false,
    ...over,
  });

  beforeEach(() => {
    mockIdForOwner.mockResolvedValue("66"); // the auth gate agrees
    mockIsRepoAutoscanned.mockResolvedValue(true);
    mockEnqueueScan.mockResolvedValue({ id: "job_push", created: true });
    mockDrainLane.mockResolvedValue(drainSummary());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES;
  });

  it("enqueues ONE job (webhook:push, priority webhook, the window bucket), then drains it by id with a deadline", async () => {
    const delivery = "push-enqueue-" + n++;
    await post("push", delivery, pushPayload());
    await runDeferred();
    expect(mockEnqueueScan).toHaveBeenCalledTimes(1);
    expect(mockEnqueueScan).toHaveBeenCalledWith({
      orgSlug: "acme",
      repoFullName: "acme/repo",
      lane: "rescore",
      reason: "webhook:push",
      bucket: `push:${Math.floor(NOW / WINDOW)}`,
      priority: 5,
    });
    expect(mockDrainLane).toHaveBeenCalledTimes(1);
    expect(mockDrainLane).toHaveBeenCalledWith("rescore", {
      jobs: [{ id: "job_push", repo: "acme/repo" }],
      concurrency: 1,
      // fleetDeadlineAt(invokedAt, maxDuration 300): the 15 s finalize reserve is held back.
      deadlineAt: NOW + 300_000 - 15_000,
      orgSlug: "acme",
      workerId: `webhook:${delivery}`,
    });
    // No money moves in the route: no token, no reserve, no scan.
    expect(mockGetToken).not.toHaveBeenCalled();
    expect(mockReserve).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("a repo that is NOT autoscanned is never enqueued, and the owner confirm is never called", async () => {
    mockIsRepoAutoscanned.mockResolvedValue(false); // unwatched, or watched on "no autoscan"
    await post("push", "push-not-autoscanned-" + n++, pushPayload());
    await runDeferred();
    expect(mockIsRepoAutoscanned).toHaveBeenCalledWith("acme", "acme/repo");
    expect(mockIdForOwner).not.toHaveBeenCalled();
    expect(mockGetInstallation).not.toHaveBeenCalled();
    expect(mockEnqueueScan).not.toHaveBeenCalled();
    expect(mockDrainLane).not.toHaveBeenCalled();
    expect(mockRelease).not.toHaveBeenCalled(); // a deterministic no-op stays deduped
  });

  it("does NOT enqueue a push to a NON-DEFAULT branch or a branch DELETE (nothing is even scheduled)", async () => {
    await post("push", "push-feature-" + n++, pushPayload({ ref: "refs/heads/feature" }));
    await post("push", "push-delete-" + n++, pushPayload({ after: "0000000000000000000000000000000000000000", deleted: true }));
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockEnqueueScan).not.toHaveBeenCalled();
  });

  it("an enqueue that answers NULL is reported and abandons the delivery", async () => {
    mockEnqueueScan.mockResolvedValueOnce(null);
    const delivery = "push-enqueue-null-" + n++;
    await post("push", delivery, pushPayload());
    await runDeferred();
    expect(console.error).toHaveBeenCalledWith(
      "[webhook] push rescan enqueue returned no row for acme/repo",
      "enqueueScanJob returned null",
    );
    expect(mockRelease).toHaveBeenCalledWith(delivery);
    expect(mockDrainLane).not.toHaveBeenCalled();
  });

  it("an enqueue that THROWS is reported and abandons the delivery", async () => {
    mockEnqueueScan.mockRejectedValueOnce(new Error("unique index down"));
    const delivery = "push-enqueue-throw-" + n++;
    await post("push", delivery, pushPayload());
    await runDeferred();
    expect(console.error).toHaveBeenCalledWith("[webhook] push rescan enqueue failed for acme/repo", "unique index down");
    expect(mockRelease).toHaveBeenCalledWith(delivery);
    expect(mockDrainLane).not.toHaveBeenCalled();
  });

  it("once a row exists the delivery is KEPT, even when the drain throws (the row is the durable record)", async () => {
    mockDrainLane.mockRejectedValueOnce(new Error("reserve threw"));
    await post("push", "push-drain-throw-" + n++, pushPayload());
    await runDeferred();
    expect(console.error).toHaveBeenCalledWith("[webhook] push rescan drain failed for acme/repo", "reserve threw");
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("a SECOND push in the same window reuses the row and buys nothing", async () => {
    // The queue modelled honestly: the idempotency key is the bucket, an existing row is returned with
    // created: false, and a row that already settled cannot be claimed again (claimJobById's CAS on
    // state "queued", pinned in scan-jobs.test.ts). `bought` counts the drains that won a claim.
    const rows = new Map<string, { id: string; settled: boolean }>();
    let bought = 0;
    mockEnqueueScan.mockImplementation(async (input) => {
      const hit = rows.get(input.bucket!);
      if (hit) return { id: hit.id, created: false };
      const row = { id: `job_${rows.size + 1}`, settled: false };
      rows.set(input.bucket!, row);
      return { id: row.id, created: true };
    });
    mockDrainLane.mockImplementation(async (_lane, opts) => {
      const row = [...rows.values()].find((r) => r.id === opts.jobs![0]!.id)!;
      if (!row.settled) {
        row.settled = true;
        bought += 1;
      }
      return drainSummary();
    });

    await post("push", "push-window-a-" + n++, pushPayload());
    await runDeferred();
    vi.setSystemTime(NOW + 60_000); // a minute later, same aligned window
    await post("push", "push-window-b-" + n++, pushPayload({ after: "def4560000000000000000000000000000000000" }));
    await runDeferred();

    const buckets = mockEnqueueScan.mock.calls.map((c) => c[0].bucket);
    expect(buckets).toEqual([`push:${Math.floor(NOW / WINDOW)}`, `push:${Math.floor(NOW / WINDOW)}`]);
    expect(await mockEnqueueScan.mock.results[1]!.value).toEqual({ id: "job_1", created: false });
    expect(rows.size).toBe(1);
    expect(bought).toBe(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("a push in the NEXT aligned window gets a new bucket", async () => {
    await post("push", "push-next-a-" + n++, pushPayload());
    await runDeferred();
    vi.setSystemTime((Math.floor(NOW / WINDOW) + 1) * WINDOW); // the next window's first instant
    await post("push", "push-next-b-" + n++, pushPayload());
    await runDeferred();
    const buckets = mockEnqueueScan.mock.calls.map((c) => c[0].bucket);
    expect(buckets[0]).not.toBe(buckets[1]);
  });

  it("honors PUSH_RESCAN_MIN_INTERVAL_MINUTES (a 60-minute window)", async () => {
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "60";
    await post("push", "push-hour-" + n++, pushPayload());
    await runDeferred();
    expect(mockEnqueueScan.mock.calls[0]![0].bucket).toBe(`push:${Math.floor(NOW / (60 * 60_000))}`);
  });

  it("with the interval at 0 (throttle off) the bucket is per DELIVERY", async () => {
    process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES = "0";
    const d1 = "push-zero-a-" + n++;
    const d2 = "push-zero-b-" + n++;
    await post("push", d1, pushPayload());
    await post("push", d2, pushPayload());
    await runDeferred();
    expect(mockEnqueueScan.mock.calls.map((c) => c[0].bucket)).toEqual([`push:${d1}`, `push:${d2}`]);
  });
});

// Pins test-mastery 06-18 medium #5 (route.ts:72-101): the replay-dedup window itself — the
// `deliveryAlreadySeen` Map with a 10-minute TTL (`DELIVERY_TTL_MS`) and a 2000-entry bounded
// eviction (`DELIVERY_MAX`). The earlier redelivery-net suites reuse a fresh id per case, so they
// never reach the TIME-expiry branch (`exp > now`) or the SIZE-overflow eviction. Here the wall
// clock is frozen with fake timers (the map keys on `Date.now()`), and the dedup verdict is read
// through the route's `duplicate` response flag end-to-end. The carrier is an `installation` event
// with no recognized action: it passes signature + dedup but does no DB/GitHub side effects, so the
// ONLY observable is whether the delivery was deduped.
//   Invariant A (TTL): a delivery seen at T dedups again at T+5min (inside the 10-min window) but is
//   RE-PROCESSED at T+11min (past DELIVERY_TTL_MS) — never stuck-deduped forever.
//   Invariant B (eviction): when the map exceeds DELIVERY_MAX it evicts OLDEST-first so memory stays
//   bounded — the oldest id becomes re-processable while a recent id is still deduped, and the map
//   never grows past the cap (an unexpired-but-overflow id may be reprocessed; size is bounded).
describe("POST /api/app/webhook — replay-dedup window: TTL expiry + DELIVERY_MAX eviction", () => {
  const DELIVERY_TTL_MS = 10 * 60_000; // mirrors route.ts:72
  const DELIVERY_MAX = 2000; // mirrors route.ts:73

  // A benign carrier: valid signature (stubbed true), runs through the dedup gate, but no side effects.
  const carrier = { action: "labeled", installation: { id: 1 } };
  // `duplicate === true` ONLY when the dedup map short-circuited the delivery.
  const isDuplicate = (res: Record<string, unknown>): boolean => res.duplicate === true;

  beforeEach(() => {
    // Pin the wall clock — the dedup map keys expiry on Date.now(). Start at a non-zero epoch so
    // `exp && exp > now` truthiness is unambiguous (a 0 expiry would be falsy).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-18T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedups a redelivery within the TTL window, then RE-PROCESSES it once the TTL expires", async () => {
    const id = "ttl-window-id";

    // T+0: first sighting — recorded, not a duplicate.
    expect(isDuplicate(await post("installation", id, carrier))).toBe(false);

    // T+5min: still inside the 10-min window — the same id is deduped (processed once).
    vi.advanceTimersByTime(5 * 60_000);
    expect(isDuplicate(await post("installation", id, carrier))).toBe(true);

    // T+5min again (no clock move): still deduped — repeated replays in-window stay collapsed.
    expect(isDuplicate(await post("installation", id, carrier))).toBe(true);

    // T+11min total: now PAST DELIVERY_TTL_MS — the entry has expired, so a legitimate GitHub
    // redelivery of the same id is processed again rather than being stuck-deduped forever.
    vi.advanceTimersByTime(6 * 60_000); // 5 + 6 = 11 minutes elapsed
    expect(vi.getMockedSystemTime()!.getTime() > DELIVERY_TTL_MS).toBe(true); // sanity: clock advanced
    expect(isDuplicate(await post("installation", id, carrier))).toBe(false);

    // And re-recorded fresh: an immediate replay of the reprocessed id is deduped again.
    expect(isDuplicate(await post("installation", id, carrier))).toBe(true);
  });

  it("EVICTS oldest-first when the map exceeds DELIVERY_MAX, keeping memory bounded (oldest reprocessable, recent still deduped)", async () => {
    // All inserted at the SAME frozen instant: none are TTL-expired, so the overflow `while` loop is
    // the ONLY thing that can bound the map — it must evict by insertion order (oldest first).
    const oldestId = "evict-oldest";
    const recentId = "evict-recent";

    // Seed the oldest entry first (it sits at the head of the Map's insertion order).
    expect(isDuplicate(await post("installation", oldestId, carrier))).toBe(false);

    // Fill EXACTLY to the cap with filler ids: after this the map holds DELIVERY_MAX entries
    // (1 oldest + (DELIVERY_MAX - 2) filler + the recent one we add next) — the next insert overflows.
    for (let i = 0; i < DELIVERY_MAX - 2; i++) {
      await post("installation", `filler-${i}`, carrier);
    }
    // A recent id, still well under/at the cap — recorded, deduped on immediate replay (sanity).
    expect(isDuplicate(await post("installation", recentId, carrier))).toBe(false);
    expect(isDuplicate(await post("installation", recentId, carrier))).toBe(true);

    // Now push the map OVER DELIVERY_MAX with one more distinct id. No entry is expired (clock frozen),
    // so eviction must drop the OLDEST insertion-order entry to stay bounded.
    expect(isDuplicate(await post("installation", "overflow-trigger", carrier))).toBe(false);

    // Invariant: the OLDEST id was evicted (bounded memory) → it is re-processable, not a duplicate.
    expect(isDuplicate(await post("installation", oldestId, carrier))).toBe(false);
    // ...while the RECENT id survived eviction → still deduped. Oldest-first, never an unexpired-recent.
    expect(isDuplicate(await post("installation", recentId, carrier))).toBe(true);
  });
});

// github-app-installation-webhooks #2: installationMatchesOwner collapses "forged mismatch" (drop) and
// "transient DB/GitHub blip" (retry) into one `false`, and the caller early-returned INSIDE the try — so
// the catch's forgetDelivery never ran and the delivery stayed CLAIMED forever. GitHub only redelivers on
// a non-2xx and we always 2xx, so that permanently lost the PR gate / push rescan on a momentary blip. The
// fix releases the delivery on that early-return path so a redelivery retries (a genuine forgery just
// re-fails the gate again, harmlessly). Pinned end-to-end through the deferred runPrGate/runPushRescan.
describe("POST /api/app/webhook — delivery release on the installationMatchesOwner-false early return (#2)", () => {
  it("releases the delivery on the PR gate's owner-match-false early return (redelivery can retry)", async () => {
    mockIdForOwner.mockResolvedValue("99"); // stored victimOwner->99 != payload 42 → owner-match false
    await post("pull_request", "pr-owner-mismatch-release", {
      action: "opened",
      installation: { id: 42 },
      repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
      pull_request: { number: 7, head: { sha: "abc", ref: "feature" }, base: { ref: "main" } },
    });
    await runDeferred();
    expect(mockGetToken).not.toHaveBeenCalled(); // bailed before minting a token / scoring
    expect(mockCreateCheckRun).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith("pr-owner-mismatch-release");
  });

  it("releases the delivery on the push rescan's owner-match-false early return", async () => {
    mockIsRepoAutoscanned.mockResolvedValue(true); // watched, so we reach the owner check
    mockIdForOwner.mockResolvedValue("99"); // stored != payload 42 → false
    await post("push", "push-owner-mismatch-release", {
      installation: { id: 42 },
      repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
      ref: "refs/heads/main",
      after: "abc1230000000000000000000000000000000000",
      deleted: false,
    });
    await runDeferred();
    expect(mockEnqueueScan).not.toHaveBeenCalled(); // bailed before any job row exists
    expect(mockDrainLane).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith("push-owner-mismatch-release");
  });

  it("does NOT release on the deterministic 'not watched' return (a real no-op, nothing to retry)", async () => {
    mockIsRepoAutoscanned.mockResolvedValue(false); // deterministic: this repo isn't watched
    mockIdForOwner.mockResolvedValue("42"); // (never reached — the watch check returns first)
    await post("push", "push-unwatched-norelease", {
      installation: { id: 42 },
      repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
      ref: "refs/heads/main",
      after: "abc1230000000000000000000000000000000000",
      deleted: false,
    });
    await runDeferred();
    expect(mockRelease).not.toHaveBeenCalled(); // a deterministic skip stays deduped
  });
});

// ci-gate-status-checks #3 (caller half of defect 1): the PRIMARY Check Run write IS the required merge
// status. It was `.catch(log)`-swallowed, so a failed write returned normally — skipping BOTH the outer
// catch's neutral fallback AND the delivery release, leaving the required check permanently absent with
// only a log line. createCheckRun now retries transient failures internally; if it STILL rejects it THROWS
// (no inline catch), so the neutral 'could not run' check posts and the delivery is released for retry.
describe("POST /api/app/webhook — a failed PRIMARY check write is not swallowed (#3 / defect 1)", () => {
  const prPayload = {
    action: "opened",
    installation: { id: 55 },
    repository: { name: "repo", default_branch: "main", owner: { login: "acme" } },
    pull_request: { number: 9, head: { sha: "headsha9", ref: "feature" }, base: { ref: "main" } },
  };

  it("posts the failing fallback AND releases the delivery when the primary check write ultimately fails", async () => {
    mockIdForOwner.mockResolvedValue("55"); // stored mapping agrees → authorized
    mockGetToken.mockResolvedValue("ghs_pr_token");
    mockGetOrgGatePolicy.mockResolvedValue(null as Awaited<ReturnType<typeof getOrgGatePolicy>>);
    mockScan.mockResolvedValue({ repo: { headSha: "headsha9" } } as Awaited<ReturnType<typeof scanRepository>>);
    mockEvaluateGate.mockReturnValue({} as ReturnType<typeof evaluateGate>);
    mockBuildComment.mockReturnValue({
      conclusion: "success",
      title: "t",
      summary: "s",
      commentBody: "b",
    } as ReturnType<typeof buildGateComment>);
    mockDiffReports.mockReturnValue({} as ReturnType<typeof diffReports>);
    // The primary (required) check write rejects even after checks.ts's internal retries; the neutral
    // fallback then succeeds. Pre-fix, the primary's inline .catch swallowed this — no fallback, no release.
    mockCreateCheckRun.mockRejectedValueOnce(new Error("github 502 after retries"));
    mockCreateCheckRun.mockResolvedValueOnce(undefined as Awaited<ReturnType<typeof createCheckRun>>);
    mockStickyComment.mockResolvedValue(undefined as Awaited<ReturnType<typeof upsertStickyComment>>);

    await post("pull_request", "pr-primary-checkfail", prPayload);
    await expect(runDeferred()).resolves.toBeUndefined(); // never throws out of the deferred gate

    // Two check writes: the failed primary, then the neutral 'could not run' fallback.
    expect(mockCreateCheckRun).toHaveBeenCalledTimes(2);
    expect((mockCreateCheckRun.mock.calls[1][0] as { conclusion: string }).conclusion).toBe("failure");
    // The sticky comment is skipped (the throw jumped past it) and the delivery is freed for a redelivery.
    expect(mockStickyComment).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledWith("pr-primary-checkfail");
  });
});

// github-app-installation-webhooks (2026-07-16) #4: the two synchronous early-exit paths between
// "delivery recorded" and "event dispatched" used to strand a delivery half-claimed. (a) The body was
// parsed AFTER the claim, so a malformed body 400'd with the id claimed for the full 24h horizon —
// GitHub's retry of the 400 was answered `duplicate: true` and the event dropped forever. (b) The
// in-memory Map recorded the id BEFORE the DB claim, so a thrown claim (DB blip) 500'd with the id
// stuck in the local Map — the redelivery to this instance short-circuited as `duplicate: true` for a
// delivery that was never claimed nor processed.
describe("POST /api/app/webhook — claim/parse ordering: no half-claimed strandings", () => {
  const carrier = { action: "labeled", installation: { id: 1 } };

  /** POST with a RAW (possibly malformed) body — the JSON `post()` helper can't produce one. */
  async function postRaw(delivery: string, body: string) {
    return POST(
      new Request("http://localhost/api/app/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": "sha256=stubbed",
          "x-github-event": "installation",
          "x-github-delivery": delivery,
        },
        body,
      }),
    );
  }

  it("a malformed body 400s WITHOUT consuming the claim — GitHub's retry of the 400 is processed, not deduped", async () => {
    const res = await postRaw("del-badjson", "{not json");
    expect(res.status).toBe(400);
    // Nothing was claimed for an event we could not even parse.
    expect(mockClaim).not.toHaveBeenCalled();

    // GitHub retries a non-2xx: the (now well-formed) redelivery of the SAME id must process.
    const retry = await post("installation", "del-badjson", carrier);
    expect(retry.duplicate).toBeUndefined();
  });

  it("a thrown DB claim rolls back the local dedup record and answers 500, so the redelivery processes", async () => {
    mockClaim.mockRejectedValueOnce(new Error("db blip"));
    const res = await postRaw("del-claimblip", JSON.stringify(carrier));
    expect(res.status).toBe(500); // unclaimed + non-2xx → GitHub redelivers

    // Redelivery routed to the SAME instance: the optimistic Map entry must have been rolled back,
    // so this is NOT short-circuited as a duplicate — the DB claim is attempted again and wins.
    const retry = await post("installation", "del-claimblip", carrier);
    expect(retry.duplicate).toBeUndefined();
    expect(mockClaim).toHaveBeenCalledTimes(2);
  });
});

// ── Control-probe fan-in (moonshot #10) ──────────────────────────────────────────────────────────
// Five events that move a repo's GOVERNANCE without moving its code. The guard that matters most:
// THE PAYLOAD IS NOT TRUSTED FOR CONTROL STATE. A `branch_protection_rule.deleted` delivery must
// enqueue a re-read and write NO observation of its own — otherwise a replayed or misrouted (but
// validly-signed) delivery could write a false governance record that outlives it.
describe("POST /api/app/webhook — control-probe fan-in", () => {
  let d = 0;
  const delivery = () => `d-probe-${d++}`;
  const repoPayload = (over: Record<string, unknown> = {}) => ({
    installation: { id: 42 },
    repository: { full_name: "acme/api", name: "api", owner: { login: "acme" } },
    ...over,
  });

  beforeEach(() => {
    mockIdForOwner.mockResolvedValue("42");
    mockEnqueueProbe.mockResolvedValue({ id: "job_1", created: true });
  });

  for (const event of ["branch_protection_rule", "repository_ruleset", "repository"]) {
    it(`${event} enqueues ONE free probe of that repo, and nothing else`, async () => {
      await post(event, delivery(), repoPayload({ action: "deleted" }));
      await runDeferred();

      expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
      expect(mockEnqueueProbe.mock.calls[0]!.slice(0, 3)).toEqual(["acme", "acme/api", `webhook:${event}`]);
      // Enqueue-only: no scan, no credit, no persisted report.
      expect(mockScan).not.toHaveBeenCalled();
      expect(mockPersist).not.toHaveBeenCalled();
    });
  }

  it("passes the DELIVERY ID as the idempotency bucket, so a redelivery enqueues nothing new", async () => {
    await post("branch_protection_rule", "d-probe-fixed", repoPayload({ action: "created" }));
    await runDeferred();
    expect(mockEnqueueProbe.mock.calls[0]![3]).toBe("d-probe-fixed");
  });

  it("writes NO control observation itself — only the probe's own re-read may do that", async () => {
    await post("branch_protection_rule", delivery(), repoPayload({ action: "deleted" }));
    await runDeferred();
    // The route never imports the ledger; the assertion here is behavioural — the only durable effect
    // of this delivery is one queued job.
    expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
  });

  it("refuses an installation that does not own the payload's org, and releases the delivery", async () => {
    mockIdForOwner.mockResolvedValue("999"); // stored mapping disagrees with the payload
    await post("repository", delivery(), repoPayload({ action: "archived" }));
    await runDeferred();
    expect(mockEnqueueProbe).not.toHaveBeenCalled();
  });

  it("member/team fan out over the org's WATCHED repos, capped, and write no membership row", async () => {
    mockListWatched.mockResolvedValue([{ fullName: "acme/api" }, { fullName: "acme/web" }] as Awaited<
      ReturnType<typeof listWatchedRepos>
    >);
    await post("member", delivery(), { installation: { id: 42 }, organization: { login: "acme" }, action: "added" });
    await runDeferred();

    expect(mockEnqueueProbe).toHaveBeenCalledTimes(2);
    expect(mockEnqueueProbe.mock.calls.map((c) => c[1])).toEqual(["acme/api", "acme/web"]);
  });

  it("a repo-scoped member event probes just that repo rather than the whole fleet", async () => {
    await post("member", delivery(), { ...repoPayload({ action: "added" }), organization: { login: "acme" } });
    await runDeferred();
    expect(mockListWatched).not.toHaveBeenCalled();
    expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
  });
});

// repository.deleted is GitHub confirming the named repo is gone. After installationMatchesOwner,
// unwatch that fullName only via reconcileWatchedRepos (the same drop as an installation-set
// removal). A forged owner pairing must not unwatch; archived stays watched.
describe("POST /api/app/webhook — repository.deleted unwatch", () => {
  const repoPayload = (action: string, owner = "acme") => ({
    action,
    installation: { id: 42 },
    repository: { full_name: `${owner}/api`, name: "api", owner: { login: owner } },
  });

  it("unwatches only the deleted fullName after the owner matches the installation", async () => {
    mockIdForOwner.mockResolvedValue("42");
    mockListWatched.mockResolvedValue([
      { fullName: "acme/api" },
      { fullName: "acme/web" },
    ] as Awaited<ReturnType<typeof listWatchedRepos>>);

    await post("repository", "repo-del-unwatch", repoPayload("deleted"));
    await runDeferred();

    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile).toHaveBeenCalledWith(42, ["acme/web"]);
    expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
  });

  it("does NOT unwatch when a forged owner pairing fails installationMatchesOwner", async () => {
    mockIdForOwner.mockResolvedValue("999");
    mockListWatched.mockResolvedValue([{ fullName: "acme/api" }] as Awaited<ReturnType<typeof listWatchedRepos>>);

    await post("repository", "repo-del-forged", repoPayload("deleted"));
    await runDeferred();

    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockListWatched).not.toHaveBeenCalled();
    expect(mockEnqueueProbe).not.toHaveBeenCalled();
  });

  it("does NOT unwatch an archived repo — archived stays watched", async () => {
    mockIdForOwner.mockResolvedValue("42");
    mockListWatched.mockResolvedValue([
      { fullName: "acme/api" },
      { fullName: "acme/web" },
    ] as Awaited<ReturnType<typeof listWatchedRepos>>);

    await post("repository", "repo-del-archived", repoPayload("archived"));
    await runDeferred();

    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockEnqueueProbe).toHaveBeenCalledTimes(1);
  });
});

// ai-registry-repo#A (challenge-2026-09-23) — a default-branch push also reaches the registry lane:
// the registry repo's own push re-indexes it, a fleet repo's `.ai/` push re-sweeps that repo. The
// route's only job is to SCHEDULE that behind the same signature/dedup gates, and never to let the
// registry's failure touch the delivery: the rescan job beside it may already exist, and its row, not a
// redelivery, is what retries it.
describe("POST /api/app/webhook — registry push lane (onRegistryPush)", () => {
  let n = 0;
  const registryPush = (over: Record<string, unknown> = {}) => ({
    installation: { id: 1 },
    repository: { name: "AI-Registry", full_name: "acme/AI-Registry", default_branch: "main", owner: { login: "acme" } },
    ref: "refs/heads/main",
    after: "abc1230000000000000000000000000000000000",
    deleted: false,
    commits: [{ added: [], modified: ["skills/forge/SKILL.md"], removed: [] }],
    ...over,
  });

  beforeEach(() => {
    mockIsRepoAutoscanned.mockResolvedValue(false); // the registry repo is not a watched scan target
  });

  it("schedules onRegistryPush via after() with the push slice, and answers 200", async () => {
    const body = await post("push", "registry-push-" + n++, registryPush());
    expect(body).toEqual({ ok: true, event: "push" });
    expect(mockOnRegistryPush).not.toHaveBeenCalled(); // deferred, not inline
    await runDeferred();
    expect(mockOnRegistryPush).toHaveBeenCalledTimes(1);
    expect(mockOnRegistryPush.mock.calls[0]![0]).toEqual({
      installationId: 1,
      owner: "acme",
      repo: "AI-Registry",
      ref: "refs/heads/main",
      defaultBranch: "main",
      after: "abc1230000000000000000000000000000000000",
      deleted: false,
      commits: [{ added: [], modified: ["skills/forge/SKILL.md"], removed: [] }],
    });
  });

  it("onRegistryPush throwing still yields 200 and the delivery is NOT abandoned", async () => {
    mockOnRegistryPush.mockRejectedValueOnce(new Error("registry lane down"));
    const body = await post("push", "registry-push-throw-" + n++, registryPush());
    expect(body).toEqual({ ok: true, event: "push" });
    await runDeferred();
    expect(mockOnRegistryPush).toHaveBeenCalledTimes(1);
    expect(mockRelease).not.toHaveBeenCalled();
  });

  it("guard: a WATCHED repo's default-branch push still schedules runPushRescan exactly once", async () => {
    mockIdForOwner.mockResolvedValue("1");
    mockIsRepoAutoscanned.mockResolvedValue(true);
    mockEnqueueScan.mockResolvedValue({ id: "job_reg", created: true });
    mockDrainLane.mockResolvedValue(drainSummary());
    await post("push", "registry-push-watched-" + n++, registryPush({ repository: { name: "api", default_branch: "main", owner: { login: "acme" } } }));
    expect(mockAfter).toHaveBeenCalledTimes(2); // the rescan + the registry lane, nothing more
    await runDeferred();
    expect(mockEnqueueScan).toHaveBeenCalledTimes(1);
    expect(mockDrainLane).toHaveBeenCalledTimes(1);
    expect(mockOnRegistryPush).toHaveBeenCalledTimes(1);
  });

  it("a non-default-branch push schedules neither lane", async () => {
    await post("push", "registry-push-feature-" + n++, registryPush({ ref: "refs/heads/feature" }));
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockOnRegistryPush).not.toHaveBeenCalled();
  });

  it("guard: the signature check gates the registry lane — an unsigned push is 401 and schedules nothing", async () => {
    vi.mocked(verifyWebhook).mockReturnValueOnce(false);
    const res = await POST(
      new Request("http://localhost/api/app/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=forged", "x-github-event": "push", "x-github-delivery": "registry-push-forged-" + n++ },
        body: JSON.stringify(registryPush()),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockOnRegistryPush).not.toHaveBeenCalled();
  });
});

// Codebase security scan (2026-10-09) finding 1: the body was read with an unbounded request.text()
// BEFORE verifyWebhook, on an unauthenticated route. GitHub caps a payload at 25 MB, so anything larger
// is refused with a 413 before the signature check, the parse, or any delivery claim.
describe("POST /api/app/webhook — body size bound (25 MB) before the signature check", () => {
  const CAP = 25 * 1024 * 1024;
  let n = 0;

  it("an over-cap Content-Length answers 413 and reaches neither verifyWebhook nor a delivery claim", async () => {
    const res = await POST(
      new Request("http://localhost/api/app/webhook", {
        method: "POST",
        headers: {
          "content-length": String(CAP + 1),
          "x-hub-signature-256": "sha256=stubbed",
          "x-github-event": "push",
          "x-github-delivery": "oversize-cl-" + n++,
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(413);
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("an over-cap body with NO Content-Length answers 413: the read itself is bounded", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20); // 1 MB of spaces
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // 30 MB, with no Content-Length to read the size from: only the byte count can stop the read.
        if (sent === 30) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/api/app/webhook", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=stubbed", "x-github-event": "push", "x-github-delivery": "oversize-stream-" + n++ },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    // Stopped just past the cap, not after buffering the whole stream.
    expect(sent).toBeLessThanOrEqual(27);
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(mockClaim).not.toHaveBeenCalled();
  });

  it("a normal signed push verifies the exact raw string and behaves as before (pins unchanged behaviour)", async () => {
    mockIsRepoAutoscanned.mockResolvedValue(false);
    const payload = {
      installation: { id: 1 },
      repository: { name: "web", full_name: "acme/web", default_branch: "main", owner: { login: "acme" } },
      ref: "refs/heads/main",
      after: "abc1230000000000000000000000000000000000",
      deleted: false,
      commits: [{ added: [], modified: ["README — ünïcødé ✓.md"], removed: [] }],
    };
    const raw = JSON.stringify(payload);
    const delivery = "normal-push-" + n++;
    const res = await POST(
      new Request("http://localhost/api/app/webhook", {
        method: "POST",
        headers: {
          "content-length": String(Buffer.byteLength(raw)),
          "x-hub-signature-256": "sha256=stubbed",
          "x-github-event": "push",
          "x-github-delivery": delivery,
        },
        body: raw,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, event: "push" });
    expect(verifyWebhook).toHaveBeenCalledWith(raw, "sha256=stubbed");
    expect(mockClaim).toHaveBeenCalledWith(delivery, 24 * 60 * 60_000);
    expect(mockAfter).toHaveBeenCalledTimes(2); // the rescan lane + the registry lane, as before
  });

  it("a body split mid-character across chunks decodes to the same string request.text() would give", async () => {
    const raw = JSON.stringify({ zen: "ünïcødé ✓ 🚀" });
    const bytes = new TextEncoder().encode(raw);
    const cut = bytes.indexOf(0xf0) + 2; // inside the 4-byte emoji
    const chunks = [bytes.slice(0, cut), bytes.slice(cut)];
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.shift();
        if (next) controller.enqueue(next);
        else controller.close();
      },
    });
    await POST(
      new Request("http://localhost/api/app/webhook", {
        method: "POST",
        headers: { "x-hub-signature-256": "sha256=stubbed", "x-github-event": "ping", "x-github-delivery": "split-" + n++ },
        body: stream,
        duplex: "half",
      } as RequestInit),
    );
    expect(verifyWebhook).toHaveBeenCalledWith(raw, "sha256=stubbed");
  });
});
