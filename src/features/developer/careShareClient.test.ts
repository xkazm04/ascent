// The browser half of the share door: one request to the EXISTING owner-self route, its status mapped
// onto a state the panel can name. Auth is the browser session; nothing here adds a credential.

import { afterEach, describe, expect, it, vi } from "vitest";
import { commitShare, deleteShare, CARE_SHARE_ROUTE } from "./careShareClient";

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

afterEach(() => vi.unstubAllGlobals());

describe("commitShare", () => {
  it("POSTs the exact text once, refreshes once, and reads saved", async () => {
    const fetchMock = respond(200, { ok: true, sharedAt: "2026-10-22T10:00:00.000Z" });
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn();
    const text = '{\n  "contract": 1\n}';
    const out = await commitShare(text, refresh);
    expect(out).toEqual({ state: "saved", sharedAt: "2026-10-22T10:00:00.000Z" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(CARE_SHARE_ROUTE);
    expect(CARE_SHARE_ROUTE).toBe("/api/me/mentor/share");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(text);
    expect(init.credentials).toBe("same-origin");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("carries the server's own refusal reasons on a 400, and does not refresh", async () => {
    vi.stubGlobal("fetch", respond(400, { error: "The share was refused.", errors: ["contract must be 1"] }));
    const refresh = vi.fn();
    expect(await commitShare("{}", refresh)).toEqual({ state: "refused", errors: ["contract must be 1"] });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to the single error when a 400 names no list", async () => {
    vi.stubGlobal("fetch", respond(400, { error: "The share is not valid JSON." }));
    expect(await commitShare("x", vi.fn())).toEqual({ state: "refused", errors: ["The share is not valid JSON."] });
  });

  it("reads 401 as signed out, 413 as too large, 503 as unavailable", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "Sign in to share your care loop." }));
    expect((await commitShare("{}", vi.fn())).state).toBe("signed-out");
    vi.stubGlobal("fetch", respond(413, { error: "A share is at most 64 KB." }));
    expect((await commitShare("{}", vi.fn())).state).toBe("too-large");
    vi.stubGlobal("fetch", respond(503, { error: "Sharing requires a database." }));
    expect(await commitShare("{}", vi.fn())).toEqual({ state: "unavailable", message: "Sharing requires a database." });
  });

  it("reads a network failure as failed, not as saved", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect((await commitShare("{}", vi.fn())).state).toBe("failed");
  });
});

describe("deleteShare", () => {
  it("sends one DELETE and refreshes", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const refresh = vi.fn();
    expect(await deleteShare(refresh)).toEqual({ state: "deleted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads 404 as nothing stored", async () => {
    vi.stubGlobal("fetch", respond(404, { error: "No share is stored for you." }));
    expect(await deleteShare(vi.fn())).toEqual({ state: "nothing-stored" });
  });
});
