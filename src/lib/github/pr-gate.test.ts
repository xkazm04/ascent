// First tests for runPrGate — the ONE check-writing path for the PR maturity gate, shared by the App
// webhook (PR events + the "Re-run" button) and the org gate-policy sweep. It had no test file at all,
// despite owning every decision that can leave a REQUIRED status wrong or missing:
//
//   • the fork-PR fallback (head unreachable → score the default branch) must post as NON-authoritative;
//   • a hard failure must still post a neutral "could not run" check, never leave the check absent —
//     GitHub only redelivers on a non-2xx and the webhook already 2xx'd, so a silent exit blocks merge
//     forever with no explanation;
//   • every abort/failure path must fire onRetryable so a held delivery claim is released for retry;
//   • the sticky comment is best-effort NARRATIVE and must not trip the neutral-check fallback;
//   • the org's persisted bar must be honored, and a FAILED read of it must not publish a verdict
//     scored against the weaker archetype default.
//
// The boundaries (scan, check writes, DB, token, rendering) are mocked so each assertion is about
// runPrGate's orchestration — the part nothing else covers.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/db", () => ({
  getOrgGatePolicy: vi.fn(async () => null),
  reportPermalink: vi.fn(() => "/report/acme/api/sha-head"),
}));
vi.mock("@/lib/scan", () => ({ scanRepository: vi.fn() }));
vi.mock("@/lib/site", () => ({ publicBaseUrl: vi.fn(() => "https://ascent.example.dev") }));
vi.mock("@/lib/scoring/gate", () => ({ evaluateGate: vi.fn(() => ({ pass: true, policy: {}, failures: [] })) }));
vi.mock("@/lib/scoring/gate-comment", () => ({
  GATE_COMMENT_MARKER: "<!-- ascent-maturity-gate -->",
  buildGateComment: vi.fn(() => ({
    conclusion: "success",
    title: "Passed — L3 Augmented (58/100)",
    summary: "### ✅ summary",
    commentBody: "<!-- ascent-maturity-gate -->\nbody",
  })),
}));
vi.mock("@/lib/github/checks", () => ({ createCheckRun: vi.fn(async () => ({ url: "u", id: 1 })), upsertStickyComment: vi.fn(async () => ({ url: "c", updated: false })) }));
vi.mock("@/lib/scoring/engine", () => ({ diffReports: vi.fn(() => ({ unchanged: false })) }));

import { runPrGate, RERUN_ACTION } from "./pr-gate";
import { getInstallationToken } from "@/lib/github/app";
import { getOrgGatePolicy } from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { evaluateGate } from "@/lib/scoring/gate";
import { buildGateComment } from "@/lib/scoring/gate-comment";
import { createCheckRun, upsertStickyComment } from "@/lib/github/checks";
import { diffReports } from "@/lib/scoring/engine";

const mockToken = vi.mocked(getInstallationToken);
const mockPolicy = vi.mocked(getOrgGatePolicy);
const mockScan = vi.mocked(scanRepository);
const mockEvaluate = vi.mocked(evaluateGate);
const mockComment = vi.mocked(buildGateComment);
const mockCheck = vi.mocked(createCheckRun);
const mockSticky = vi.mocked(upsertStickyComment);
const mockDiff = vi.mocked(diffReports);

/** Just enough report for runPrGate itself — it only reads `repo.headSha` (for the permalink). */
const report = (headSha: string) => ({ repo: { headSha } }) as never;

const REF = { installationId: 42, owner: "acme", repo: "api", prNumber: 7, headSha: "sha-head", baseRef: "main" };

beforeEach(() => {
  vi.clearAllMocks();
  mockToken.mockResolvedValue("tok");
  mockPolicy.mockResolvedValue(null);
  mockScan.mockResolvedValue(report("sha-head"));
  mockEvaluate.mockReturnValue({ pass: true, policy: {}, failures: [] });
  mockCheck.mockResolvedValue({ url: "u", id: 1 });
  mockSticky.mockResolvedValue({ url: "c", updated: false });
  // The module logs every failure path on purpose; keep the suite output about the assertions.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("runPrGate — the happy path writes the merge status and the narrative", () => {
  it("scores the PR HEAD, diffs it against the base, and posts the check + sticky comment", async () => {
    await runPrGate(REF);

    // The head ref is what makes the gate movable: adding tests/CI in the PR must be able to clear it.
    expect(mockScan).toHaveBeenCalledWith("acme/api", { mock: true, token: "tok", ref: "sha-head" });
    expect(mockScan).toHaveBeenCalledWith("acme/api", { mock: true, token: "tok", ref: "main" });
    expect(mockDiff).toHaveBeenCalled();

    expect(mockCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "api",
        headSha: "sha-head",
        conclusion: "success",
        actions: RERUN_ACTION, // a verdict must always be refreshable without a new push
        detailsUrl: "https://ascent.example.dev/report/acme/api/sha-head",
      }),
    );
    expect(mockSticky).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 7, marker: "<!-- ascent-maturity-gate -->" }),
    );
  });

  it("honors the org's persisted bar rather than the archetype default", async () => {
    mockPolicy.mockResolvedValue({ minLevel: "L4", minDimensionFor: { D9: 70 } });

    await runPrGate(REF);

    expect(mockEvaluate).toHaveBeenCalledWith(expect.anything(), { minLevel: "L4", minDimensionFor: { D9: 70 } });
  });
});

describe("runPrGate — a fork PR's unreachable head is non-authoritative, never a verdict on the PR", () => {
  it("falls back to the default branch and flags scoredHead:false", async () => {
    mockScan.mockRejectedValueOnce(new Error("404 tree not found")).mockResolvedValue(report("sha-default"));

    await runPrGate(REF);

    // Exactly two scans: the failed head attempt, then the default branch. The base diff is SKIPPED —
    // diffing a default-branch report against the base would describe nothing about the PR.
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockDiff).not.toHaveBeenCalled();
    expect(mockComment).toHaveBeenCalledWith(expect.anything(), expect.anything(), null, expect.objectContaining({ scoredHead: false }));
  });
});

describe("runPrGate — a required check is never left silently absent", () => {
  it("posts the neutral 'could not run' check and releases the delivery when the gate throws", async () => {
    mockScan.mockRejectedValue(new Error("github is down"));
    const onRetryable = vi.fn();

    await expect(runPrGate(REF, { onRetryable })).resolves.toBeUndefined(); // never throws

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: "neutral", title: "Maturity gate could not run", actions: RERUN_ACTION }),
    );
    expect(onRetryable).toHaveBeenCalledTimes(1); // GitHub redelivers only if we let go of the claim
  });

  it("falls back to neutral when the VERDICT check write itself fails after its retries", async () => {
    mockCheck.mockRejectedValueOnce(new Error("500 from GitHub")).mockResolvedValue({ url: "u", id: 2 });
    const onRetryable = vi.fn();

    await runPrGate(REF, { onRetryable });

    expect(mockCheck).toHaveBeenCalledTimes(2);
    expect(mockCheck).toHaveBeenLastCalledWith(expect.objectContaining({ conclusion: "neutral" }));
    expect(onRetryable).toHaveBeenCalledTimes(1);
  });

  it("a failed org-policy READ posts no verdict at all — only the neutral check (fail closed)", async () => {
    // Regression guard for the fail-open this path used to have: `.catch(() => null)` published a green
    // check scored against the archetype default whenever the DB blipped, silently relaxing the bar.
    mockPolicy.mockRejectedValue(new Error("connection terminated"));
    const onRetryable = vi.fn();

    await runPrGate(REF, { onRetryable });

    expect(mockEvaluate).not.toHaveBeenCalled();
    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "neutral" }));
    expect(mockSticky).not.toHaveBeenCalled();
    expect(onRetryable).toHaveBeenCalledTimes(1);
  });

  it("cannot post anything when the token itself could not be minted, but still releases", async () => {
    mockToken.mockRejectedValue(new Error("installation revoked"));
    const onRetryable = vi.fn();

    await runPrGate(REF, { onRetryable });

    expect(mockCheck).not.toHaveBeenCalled(); // no token → no possible write; log + release is all there is
    expect(onRetryable).toHaveBeenCalledTimes(1);
  });
});

describe("runPrGate — the sticky comment is narrative, not the gate", () => {
  it("swallows a comment failure: the verdict check stands and no neutral fallback is posted", async () => {
    mockSticky.mockRejectedValue(new Error("comments disabled"));
    const onRetryable = vi.fn();

    await runPrGate(REF, { onRetryable });

    expect(mockCheck).toHaveBeenCalledTimes(1);
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "success" }));
    expect(onRetryable).not.toHaveBeenCalled(); // nothing to retry — the merge status was written
  });
});

describe("runPrGate — confirmOwner binds the installation to the owner", () => {
  it("aborts BEFORE minting a token and releases the claim when the pair does not match", async () => {
    const onRetryable = vi.fn();

    await runPrGate(REF, { confirmOwner: async () => false, onRetryable });

    expect(mockToken).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
    expect(mockCheck).not.toHaveBeenCalled();
    // github-app-installation-webhooks #2: a bare return here would strand the delivery claim, so a
    // momentary DB blip would permanently lose this PR's gate. A real forgery just re-fails, harmlessly.
    expect(onRetryable).toHaveBeenCalledTimes(1);
  });

  it("proceeds normally when the pair matches, and omits the hook entirely for the policy sweep", async () => {
    await runPrGate(REF, { confirmOwner: async () => true });
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "success" }));

    vi.clearAllMocks();
    mockScan.mockResolvedValue(report("sha-head"));
    mockCheck.mockResolvedValue({ url: "u", id: 1 });
    await runPrGate(REF); // no hooks: the sweep resolved the installation FROM the org
    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "success" }));
  });

  it("a throwing onRetryable hook cannot break the gate's own error handling", async () => {
    mockScan.mockRejectedValue(new Error("github is down"));

    await expect(
      runPrGate(REF, {
        onRetryable: () => {
          throw new Error("claim release failed");
        },
      }),
    ).resolves.toBeUndefined();

    expect(mockCheck).toHaveBeenCalledWith(expect.objectContaining({ conclusion: "neutral" }));
  });
});
