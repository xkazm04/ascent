import { afterEach, describe, expect, it, vi } from "vitest";
import { gitlabGet, gitlabGetSoft, gitlabPaged, projectRef } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("GitLab transport", () => {
  it.each([500, 503])("does not expose the configured host or repository path on upstream %i", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(gitlabGet("/projects/private%2Fproject", {
      host: { apiBase: "https://internal.gitlab.example/api/v4", webBase: "https://internal.gitlab.example" },
    })).rejects.toMatchObject({ code: "UPSTREAM", status, message: `GitLab returned ${status}. Please try again.` });
  });

  it("uses the self-managed API root and passes credentials without caching the response", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: 7 }, { headers: { "x-request-id": "r7" } }));
    vi.stubGlobal("fetch", fetch);
    const result = await gitlabGet("/projects/7", {
      token: "fixture-token",
      host: { apiBase: "https://gitlab.example/api/v4///", webBase: "https://gitlab.example" },
    });
    expect(result.body).toEqual({ id: 7 });
    expect(result.headers.get("x-request-id")).toBe("r7");
    expect(fetch).toHaveBeenCalledWith("https://gitlab.example/api/v4/projects/7", expect.objectContaining({
      cache: "no-store",
      headers: expect.objectContaining({ Authorization: "Bearer fixture-token" }),
      signal: expect.any(AbortSignal),
    }));
  });

  it("follows the server's page number and discloses when the page budget ends", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(["a"], { headers: { "x-next-page": "3" } }))
      .mockResolvedValueOnce(Response.json(["b"], { headers: { "x-next-page": "4" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await gitlabPaged("/tree?recursive=true", 2)).toEqual({ items: ["a", "b"], truncated: true });
    expect(fetch.mock.calls.map(([url]) => new URL(url).search)).toEqual([
      "?recursive=true&page=1", "?recursive=true&page=3",
    ]);
  });

  it("stops at the last page and omits authorization for public reads", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(["a"], { headers: { "x-next-page": "" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await gitlabPaged("/tree", 10)).toEqual({ items: ["a"], truncated: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe("https://gitlab.com/api/v4/tree?page=1");
    expect(fetch.mock.calls[0]![1].headers).not.toHaveProperty("Authorization");
  });

  it("does not describe an unexpected page body as complete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: true })));
    expect(await gitlabPaged("/tree", 2)).toEqual({ items: [], truncated: true });
  });

  it.each([403, 404])("maps unreadable status %i to NOT_FOUND", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
    await expect(gitlabGet("/projects/7")).rejects.toMatchObject({ code: "NOT_FOUND", status });
  });

  it("preserves the rate-limit retry delay", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 429, headers: { "retry-after": "42" },
    })));
    await expect(gitlabGet("/projects/7")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSec: 42 });
  });

  it("reports other upstream failures while optional enrichments degrade to null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(null, { status: 503 })));
    await expect(gitlabGet("/projects/7")).rejects.toMatchObject({ code: "UPSTREAM", status: 503 });
    expect(await gitlabGetSoft("/projects/7")).toBeNull();
  });

  it("keeps optional transport and JSON failures distinct from an empty collection", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response("not JSON"))
      .mockResolvedValueOnce(Response.json([])));
    expect(await gitlabGetSoft("/optional")).toBeNull();
    expect(await gitlabGetSoft("/optional")).toBeNull();
    expect(await gitlabGetSoft("/optional")).toEqual([]);
  });

  it("encodes nested project paths as one identifier and prefers a numeric project ID", () => {
    expect(projectRef("group/sub/my project")).toBe("group%2Fsub%2Fmy%20project");
    expect(projectRef("group/sub/project", "17")).toBe("17");
    expect(projectRef("group/sub/project", "invalid")).toBe("group%2Fsub%2Fproject");
  });
});
