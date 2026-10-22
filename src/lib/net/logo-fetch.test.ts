// Guards for the white-label logo fetch (fetchSafeLogo, and resolveSafeLogoDataUri over it). The logo
// is owner-supplied, so the fetch is untrusted input end to end. These pin: non-https is rejected
// before any I/O; a host that RESOLVES to a private/metadata IP is rejected before connecting; the
// connection is PINNED to the address that passed the check (DNS is asked once, the socket never
// re-resolves, SNI/Host keep the real name); redirects are refused; and only bytes whose magic says
// PNG, JPEG or SVG (the formats @react-pdf/image renders) within 512 KB come back.
//
// node:https is faked: the fake `request` resolves the socket address through the `lookup` option the
// caller passed, exactly as net.connect does, so the test sees the address the socket would open.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

const h = vi.hoisted(() => ({
  mockLookup: vi.fn(),
  request: vi.fn(),
  served: { status: 200, headers: {} as Record<string, string>, body: Buffer.alloc(0) },
  connected: [] as Array<{ address: string; servername?: string; host?: string; hostname?: string }>,
}));
vi.mock("node:dns/promises", () => ({ lookup: h.mockLookup, default: { lookup: h.mockLookup } }));
vi.mock("node:https", () => ({ request: h.request, default: { request: h.request } }));

import { fetchSafeLogo, resolveSafeLogoDataUri, sniffLogoFormat, MAX_LOGO_BYTES } from "./logo-fetch";

type Opts = { hostname: string; servername?: string; headers: Record<string, string>; lookup: (...a: unknown[]) => void };

function fakeRequest(opts: Opts, onResponse: (res: unknown) => void) {
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void; setTimeout: () => void };
  req.destroy = () => {};
  req.setTimeout = () => {};
  req.end = () => {
    opts.lookup(opts.hostname, {}, (err: unknown, address: string) => {
      if (err) return req.emit("error", err);
      h.connected.push({ address, servername: opts.servername, host: opts.headers.host, hostname: opts.hostname });
      const res = Readable.from([h.served.body]) as Readable & { statusCode: number; headers: Record<string, string> };
      res.statusCode = h.served.status;
      res.headers = h.served.headers;
      onResponse(res);
    });
  };
  return req;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

function serve(body: Buffer, contentType = "image/png", status = 200) {
  h.served = { status, headers: { "content-type": contentType }, body };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  h.mockLookup.mockReset();
  h.mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  h.request.mockReset();
  h.request.mockImplementation(fakeRequest);
  h.connected = [];
  serve(PNG);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchSafeLogo SSRF guard", () => {
  it("rejects a non-https URL with no DNS lookup or connection", async () => {
    expect(await fetchSafeLogo("http://acme.com/logo.png")).toEqual({ ok: false, reason: "unsafe-url" });
    expect(h.mockLookup).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });

  it("rejects a host that resolves to a private/metadata IP (rebinding) before connecting", async () => {
    h.mockLookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    expect(await fetchSafeLogo("https://rebind.example/logo.png")).toEqual({ ok: false, reason: "private-address" });
    expect(h.request).not.toHaveBeenCalled();
  });

  it("pins the connection to the address that passed the check; SNI and Host keep the real name", async () => {
    h.mockLookup.mockReset();
    h.mockLookup
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]); // the rebind answer, never asked for
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const out = await fetchSafeLogo("https://cdn.acme.com/l.png");

    expect(out.ok).toBe(true);
    expect(h.mockLookup).toHaveBeenCalledTimes(1);
    expect(h.connected).toEqual([
      { address: "93.184.216.34", servername: "cdn.acme.com", host: "cdn.acme.com", hostname: "cdn.acme.com" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled(); // no second, re-resolving client
  });

  it("refuses a redirect (3xx) rather than following it to an unvalidated host", async () => {
    serve(Buffer.alloc(0), "text/html", 302);
    expect(await fetchSafeLogo("https://cdn.example/logo.png")).toEqual({ ok: false, reason: "http-status" });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});

describe("fetchSafeLogo format and size", () => {
  it("returns PNG bytes with mime, sha256 and a data URI", async () => {
    const out = await fetchSafeLogo("https://cdn.example/logo.png");
    expect(out).toMatchObject({ ok: true, mime: "image/png" });
    if (!out.ok) throw new Error("expected ok");
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.dataUri).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  });

  it("names the mime from the magic bytes, not the header (a JPEG served as png is a JPEG)", async () => {
    serve(JPEG, "image/png");
    expect(await fetchSafeLogo("https://cdn.example/logo")).toMatchObject({ ok: true, mime: "image/jpeg" });
  });

  it("refuses WebP as unsupported-format (@react-pdf/image cannot render it)", async () => {
    serve(WEBP, "image/webp");
    expect(await fetchSafeLogo("https://cdn.example/logo.webp")).toEqual({ ok: false, reason: "unsupported-format" });
  });

  it("refuses HTML served as image/png as not-an-image", async () => {
    serve(Buffer.from("<!doctype html><html></html>"), "image/png");
    expect(await fetchSafeLogo("https://cdn.example/logo.png")).toEqual({ ok: false, reason: "not-an-image" });
  });

  it("refuses a 600 KB PNG as too-large (cap 512 KB)", async () => {
    expect(MAX_LOGO_BYTES).toBe(512 * 1024);
    serve(Buffer.concat([PNG, Buffer.alloc(600 * 1024)]));
    expect(await fetchSafeLogo("https://cdn.example/big.png")).toEqual({ ok: false, reason: "too-large" });
  });

  it("sniffs an SVG document and refuses GIF", () => {
    expect(sniffLogoFormat(Buffer.from('﻿  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffLogoFormat(Buffer.from("GIF89a...."))).toBe("unsupported");
    expect(sniffLogoFormat(Buffer.from('<?xml version="1.0"?><feed/>'))).toBeNull();
  });
});

describe("resolveSafeLogoDataUri (thin wrapper)", () => {
  it("returns the data URI on success and null on any refusal", async () => {
    expect(await resolveSafeLogoDataUri("https://cdn.example/logo.png")).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    serve(WEBP, "image/webp");
    expect(await resolveSafeLogoDataUri("https://cdn.example/logo.webp")).toBeNull();
  });
});
