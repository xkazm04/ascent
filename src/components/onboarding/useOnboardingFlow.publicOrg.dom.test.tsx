// @vitest-environment jsdom
//
// A signed-in non-member on the gated cloud who scans a public handle: requireOrgAccess answers 403 for
// <handle>, so the run goes into the shared "public" org (the picked repos travel as '<handle>/<name>')
// and the hand-off opens /org/public. The App path, a signed-out viewer, self-hosted and auth-off
// deployments keep importing under their own source.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { useOnboardingFlow } from "./useOnboardingFlow";
import { importOrg } from "./importTarget";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

const REPOS = [
  { fullName: "vercel/next.js", private: false, language: "TS", stars: 100, pushedAt: null },
  { fullName: "vercel/turbo", private: false, language: "Rust", stars: 50, pushedAt: null },
];
const CLOUD_SIGNED_IN = { mode: "cloud", gated: true, signedIn: true } as const;

/** Listings succeed; the import POST is captured and answers with a refusal so the stream is skipped. */
function stubFetch() {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/org/repos") || url.includes("/api/app/repos")) {
        return { ok: true, json: async () => ({ repos: REPOS }) };
      }
      if (url.includes("/api/org/import")) {
        posts.push(JSON.parse(String(init?.body)));
        return { ok: false, status: 500, body: null, json: async () => ({ error: "stub" }) };
      }
      return { ok: true, json: async () => ({ balance: 5, unlimited: false }) };
    }),
  );
  return posts;
}

async function scanHandle(deployment?: Parameters<typeof useOnboardingFlow>[0]) {
  const posts = stubFetch();
  const hook = renderHook(() => useOnboardingFlow(deployment));
  await act(async () => {
    await hook.result.current.loadRepos(undefined, "vercel");
  });
  await waitFor(() => expect(hook.result.current.repos).toHaveLength(2));
  await act(async () => {
    await hook.result.current.startScan();
  });
  return { posts, hook };
}

describe("useOnboardingFlow - signed-in non-member on the gated cloud", () => {
  it("posts org 'public' with the picked repos, real + publicFunnel, and hands off to /org/public", async () => {
    const { posts, hook } = await scanHandle({ deployment: CLOUD_SIGNED_IN });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      org: "public",
      repos: ["vercel/next.js", "vercel/turbo"],
      mock: false,
      publicFunnel: true,
    });
    expect(hook.result.current.dashboardOrg).toBe("public");
    hook.unmount();
  });

  it("keeps the handle for a signed-out viewer, self-hosted, and auth-off", async () => {
    for (const deployment of [
      { mode: "cloud", gated: true, signedIn: false },
      { mode: "self-hosted", gated: true, signedIn: true },
      { mode: "cloud", gated: false, signedIn: false },
      undefined,
    ] as const) {
      const { posts, hook } = await scanHandle(deployment ? { deployment } : undefined);
      expect(posts[0]).toMatchObject({ org: "vercel" });
      expect(hook.result.current.dashboardOrg).toBe("vercel");
      hook.unmount();
    }
  });

  it("the App path (an installation present) still posts org <login>", async () => {
    const posts = stubFetch();
    const hook = renderHook(() => useOnboardingFlow({ deployment: CLOUD_SIGNED_IN }));
    await act(async () => {
      await hook.result.current.loadInstallationRepos("Vercel", "42");
    });
    await waitFor(() => expect(hook.result.current.repos).toHaveLength(2));
    await act(async () => {
      await hook.result.current.startScan();
    });
    expect(posts[0]).toMatchObject({ org: "vercel", installationId: "42" });
    expect(hook.result.current.dashboardOrg).toBe("vercel");
    hook.unmount();
  });
});

describe("importOrg", () => {
  it("only redirects a no-installation source on the gated, signed-in cloud", () => {
    expect(importOrg("vercel", null, CLOUD_SIGNED_IN)).toBe("public");
    expect(importOrg("vercel", "42", CLOUD_SIGNED_IN)).toBe("vercel");
    expect(importOrg("vercel", null, null)).toBe("vercel");
  });
});

describe("per-repo retry on the public branch", () => {
  it("targets 'public' with the picked repo, like the batch", async () => {
    const { runRepoRetry } = await import("./retryRepo");
    const posts = stubFetch();
    await runRepoRetry({
      fullName: "vercel/turbo",
      sourceLabel: "vercel",
      importOrg: "public",
      sourceInstallId: null,
      credit: null,
      creditReady: { current: null },
      fetchCredit: async () => null,
      retries: { current: new Map() },
      previewFirst: false,
      watchOptIn: false,
      setRows: () => {},
      setAnnounce: () => {},
    });
    expect(posts[0]).toMatchObject({ org: "public", repos: ["vercel/turbo"], publicFunnel: true, mock: false });
  });
});
