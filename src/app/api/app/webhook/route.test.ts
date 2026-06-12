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
import { AppApiError, getInstallation } from "@/lib/github/app";
import { removeInstallation, upsertInstallation } from "@/lib/db";

const mockGetInstallation = vi.mocked(getInstallation);
const mockUpsert = vi.mocked(upsertInstallation);
const mockRemove = vi.mocked(removeInstallation);

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
