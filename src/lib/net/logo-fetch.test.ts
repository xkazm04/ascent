// Guards for the white-label briefing logo fetch (resolveSafeLogoDataUri). @react-pdf would otherwise
// fetch an owner-supplied logo URL server-side at render time; this resolves it to a data: URI under an
// SSRF guard so @react-pdf never makes the request. These pin: non-https is rejected before any I/O; a
// host that RESOLVES to a private/metadata IP (DNS-rebinding) is rejected before fetching; a public host
// serving an image yields a data: URI; non-image content-types and redirects are refused.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mockLookup }));

import { resolveSafeLogoDataUri } from "./logo-fetch";

function imageResponse(bytes: Uint8Array, contentType = "image/png") {
  return new Response(bytes, { status: 200, headers: { "content-type": contentType } });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  mockLookup.mockReset();
  mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]); // a public IP by default
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveSafeLogoDataUri SSRF guard", () => {
  it("rejects a non-https URL with no DNS lookup or fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await resolveSafeLogoDataUri("http://acme.com/logo.png")).toBeNull();
    expect(mockLookup).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a host that resolves to a private/metadata IP (rebinding) before fetching", async () => {
    mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]); // cloud metadata
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    expect(await resolveSafeLogoDataUri("https://rebind.example/logo.png")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled(); // never reached the network
  });

  it("returns a data: URI for a public host serving an image", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal("fetch", vi.fn(async () => imageResponse(bytes)));

    const out = await resolveSafeLogoDataUri("https://cdn.example/logo.png");
    expect(out).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
  });

  it("rejects a non-image content-type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })));
    expect(await resolveSafeLogoDataUri("https://cdn.example/page")).toBeNull();
  });

  it("refuses a redirect (3xx) rather than following it to an unvalidated host", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })));
    expect(await resolveSafeLogoDataUri("https://cdn.example/logo.png")).toBeNull();
  });
});
