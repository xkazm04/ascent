// Unit tests for the shared SSRF guard. The invariant: a caller-supplied outbound URL is "safe" only
// when it is https AND its host is publicly reachable. Every private/loopback/CGNAT/link-local/
// unique-local/multicast/internal-hostname class must be rejected — these are the union of what the
// branding logo-URL guard and the alert-webhook validator each used to (partially) enforce.

import { describe, it, expect } from "vitest";
import { isSafePublicHttpsUrl, isPrivateOrInternalHost } from "./ssrf";

describe("isSafePublicHttpsUrl", () => {
  it("accepts a normal public https URL", () => {
    expect(isSafePublicHttpsUrl("https://hooks.slack.com/services/T0/B0/xyz")).toBe(true);
    expect(isSafePublicHttpsUrl("https://cdn.example.com/logo.png")).toBe(true);
  });

  it("rejects non-https schemes and unparseable input", () => {
    expect(isSafePublicHttpsUrl("http://example.com/x")).toBe(false);
    expect(isSafePublicHttpsUrl("ftp://example.com/x")).toBe(false);
    expect(isSafePublicHttpsUrl("not a url")).toBe(false);
  });

  it("rejects loopback (localhost, 127.x, ::1, 0.x)", () => {
    expect(isSafePublicHttpsUrl("https://localhost/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://sub.localhost/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://127.0.0.1/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://0.0.0.0/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://[::1]/x")).toBe(false);
  });

  it("rejects RFC-1918 private ranges (10.x, 192.168.x, 172.16-31.x)", () => {
    expect(isSafePublicHttpsUrl("https://10.1.2.3/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://192.168.1.5/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://172.16.0.9/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://172.31.255.255/x")).toBe(false);
  });

  it("rejects CGNAT 100.64.0.0/10", () => {
    expect(isSafePublicHttpsUrl("https://100.64.0.1/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://100.127.255.255/x")).toBe(false);
    // 100.63 and 100.128 are OUTSIDE the /10 — still public.
    expect(isSafePublicHttpsUrl("https://100.63.0.1/x")).toBe(true);
    expect(isSafePublicHttpsUrl("https://100.128.0.1/x")).toBe(true);
  });

  it("rejects link-local 169.254.x (incl. cloud metadata)", () => {
    expect(isSafePublicHttpsUrl("https://169.254.1.1/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
  });

  it("rejects multicast / reserved (>= 224)", () => {
    expect(isSafePublicHttpsUrl("https://224.0.0.1/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://255.255.255.255/x")).toBe(false);
  });

  it("rejects IPv6 unique-local (fc00::/7) and link-local (fe80::)", () => {
    expect(isSafePublicHttpsUrl("https://[fc00::1]/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://[fd00::1]/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://[fe80::1]/x")).toBe(false);
  });

  it("rejects internal/special hostnames (*.local, *.internal, metadata.google.internal)", () => {
    expect(isSafePublicHttpsUrl("https://printer.local/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://api.internal/x")).toBe(false);
    expect(isSafePublicHttpsUrl("https://metadata.google.internal/x")).toBe(false);
  });
});

describe("isPrivateOrInternalHost", () => {
  it("treats an empty host as unsafe", () => {
    expect(isPrivateOrInternalHost("")).toBe(true);
  });

  it("allows a normal public hostname", () => {
    expect(isPrivateOrInternalHost("hooks.slack.com")).toBe(false);
    expect(isPrivateOrInternalHost("203.0.113.5")).toBe(false);
  });
});
