// A push delivery as the registry sees it (ai-registry-repo#A, challenge-2026-09-23): the registry
// repo's own default-branch push re-indexes (trailing) and witnesses the webhook; a fleet repo's push
// that moves its `.ai/` map or manifest re-sweeps that ONE repo. The db, GitHub and the indexer door
// are mocked at their module boundaries; `githubSource` is real, so the source's token is observable.

import { beforeEach, describe, expect, it, vi } from "vitest";

const listOrgRegistries = vi.fn();
const markRegistryWebhookSeen = vi.fn(async () => {});
const resolveRepoJobRef = vi.fn();
const getInstallationIdForOwner = vi.fn();
const getInstallationToken = vi.fn(async () => "ghs_push");
const runIndexPass = vi.fn(async () => ({ kind: "ok", headSha: "abc123" }));
const sweepConformance = vi.fn(async () => ({ scanned: 1, withMap: 1, withoutMap: 0, pairs: 3, warnings: [] }));

vi.mock("@/lib/db/org-registry", () => ({ listOrgRegistries: (...a: unknown[]) => listOrgRegistries(...a) }));
vi.mock("@/lib/db/org-registry-write", () => ({ markRegistryWebhookSeen: (...a: unknown[]) => markRegistryWebhookSeen(...(a as [])) }));
vi.mock("@/lib/db/scan-jobs", () => ({ resolveRepoJobRef: (...a: unknown[]) => resolveRepoJobRef(...a) }));
vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: (...a: unknown[]) => getInstallationIdForOwner(...a) }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: (...a: unknown[]) => getInstallationToken(...(a as [])) }));
vi.mock("./index-pass", () => ({ runIndexPass: (...a: unknown[]) => runIndexPass(...(a as [])) }));
vi.mock("./conformance-sweep", () => ({ sweepConformance: (...a: unknown[]) => sweepConformance(...(a as [])) }));
vi.mock("@/lib/env", () => ({ selfHosted: () => false }));

import { onRegistryPush, type RegistryPush } from "./registry-push";

const REGISTRY = { id: "reg-1", fullName: "acme/ai-registry", localPath: null, defaultBranch: "main" };
const push = (over: Partial<RegistryPush> = {}): RegistryPush => ({
  installationId: 1,
  owner: "acme",
  repo: "AI-Registry",
  ref: "refs/heads/main",
  defaultBranch: "main",
  after: "abc123",
  commits: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  listOrgRegistries.mockResolvedValue([REGISTRY]);
  getInstallationIdForOwner.mockResolvedValue("1");
  resolveRepoJobRef.mockResolvedValue({ orgId: "org-1", repoId: "repo-api" });
});

describe("onRegistryPush — the registry repo itself", () => {
  it("a default-branch push re-indexes ONCE with policy 'trail' through a github source, and witnesses the webhook", async () => {
    const outcome = await onRegistryPush(push());
    expect(listOrgRegistries).toHaveBeenCalledWith("acme");
    expect(runIndexPass).toHaveBeenCalledTimes(1);
    const [row, source, policy] = runIndexPass.mock.calls[0] as unknown as [typeof REGISTRY, { token?: string; readTree: unknown }, string];
    expect(row.id).toBe("reg-1");
    expect(policy).toBe("trail");
    expect(source.token).toBe("ghs_push");
    expect(typeof source.readTree).toBe("function");
    expect(getInstallationToken).toHaveBeenCalledWith(1);
    expect(markRegistryWebhookSeen).toHaveBeenCalledWith("reg-1");
    expect(outcome.kind).toBe("indexed");
    expect(sweepConformance).not.toHaveBeenCalled();
  });

  it("a non-default-branch push does not index and does not witness the webhook", async () => {
    await onRegistryPush(push({ ref: "refs/heads/feature" }));
    expect(runIndexPass).not.toHaveBeenCalled();
    expect(markRegistryWebhookSeen).not.toHaveBeenCalled();
  });

  it("a branch-delete push (all-zero after) does not index and does not witness the webhook", async () => {
    await onRegistryPush(push({ after: "0000000000000000000000000000000000000000" }));
    await onRegistryPush(push({ deleted: true }));
    expect(runIndexPass).not.toHaveBeenCalled();
    expect(markRegistryWebhookSeen).not.toHaveBeenCalled();
  });

  it("an installation the stored mapping does not bind to the owner mints no token and writes nothing", async () => {
    getInstallationIdForOwner.mockResolvedValue("999");
    const outcome = await onRegistryPush(push());
    expect(outcome.kind).toBe("ignored");
    expect(getInstallationToken).not.toHaveBeenCalled();
    expect(runIndexPass).not.toHaveBeenCalled();
    expect(markRegistryWebhookSeen).not.toHaveBeenCalled();
  });

  it("an injected owner check replaces the stored-mapping default", async () => {
    getInstallationIdForOwner.mockResolvedValue(null);
    const ownerMatches = vi.fn(async () => true);
    await onRegistryPush(push(), { ownerMatches });
    expect(ownerMatches).toHaveBeenCalledWith(1, "acme");
    expect(runIndexPass).toHaveBeenCalledTimes(1);
  });
});

describe("onRegistryPush — a fleet repo moving its .ai/ files", () => {
  const fleet = (paths: { added?: string[]; modified?: string[]; removed?: string[] }) =>
    push({ repo: "api", commits: [{ added: [], modified: [], removed: [], ...paths }] });

  it("a default-branch push touching .ai/registry-map.json re-sweeps that ONE repo", async () => {
    const outcome = await onRegistryPush(fleet({ modified: [".ai/registry-map.json"] }));
    expect(resolveRepoJobRef).toHaveBeenCalledWith("acme", "acme/api");
    expect(sweepConformance).toHaveBeenCalledTimes(1);
    expect(sweepConformance).toHaveBeenCalledWith("acme", "ghs_push", { repositoryId: "repo-api" });
    expect(runIndexPass).not.toHaveBeenCalled();
    expect(markRegistryWebhookSeen).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("swept");
  });

  it("an ADDED .ai/manifest.yaml (or .yml) counts too", async () => {
    await onRegistryPush(fleet({ added: [".ai/manifest.yaml"] }));
    await onRegistryPush(fleet({ added: [".ai/manifest.yml"] }));
    expect(sweepConformance).toHaveBeenCalledTimes(2);
  });

  it("a push touching only src/** does not sweep", async () => {
    await onRegistryPush(fleet({ modified: ["src/index.ts"], added: ["src/ai/registry-map.json"] }));
    expect(sweepConformance).not.toHaveBeenCalled();
    expect(getInstallationToken).not.toHaveBeenCalled();
  });

  it("no mapped registry, or a repo the org has not imported, does not sweep", async () => {
    listOrgRegistries.mockResolvedValueOnce([]);
    await onRegistryPush(fleet({ modified: [".ai/registry-map.json"] }));
    resolveRepoJobRef.mockResolvedValueOnce({ orgId: "org-1", repoId: null });
    await onRegistryPush(fleet({ modified: [".ai/registry-map.json"] }));
    expect(sweepConformance).not.toHaveBeenCalled();
  });
});
