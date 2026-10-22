// Pins the pure model behind the shared error card (RouteError.tsx): the retry counter that makes a
// failure that will not clear escalate instead of looping, the action order that follows from it, and
// the prefilled issue link, whose privacy contract is the hard line - it carries the digest and a
// REDACTED route only (no share/invite token, no query string, no fragment, never the message or stack).

import { describe, it, expect } from "vitest";
import { FEEDBACK_URL } from "@/lib/site";
import {
  actionsFor,
  errorKey,
  readAttempts,
  recordRetry,
  redactPath,
  reportDetails,
  reportHref,
  shouldCapture,
  type RetryStore,
} from "./routeErrorModel";

function memoryStore(): RetryStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwingStore: RetryStore = {
  getItem: () => {
    throw new Error("SecurityError: storage blocked");
  },
  setItem: () => {
    throw new Error("SecurityError: storage blocked");
  },
};

function decodedBody(href: string): string {
  const query = href.slice(href.indexOf("?") + 1);
  const params = new URLSearchParams(query);
  return `${params.get("title") ?? ""}\n${params.get("body") ?? ""}`;
}

describe("retry counter", () => {
  it("two retries for the same key -> attempts 2 and escalated", () => {
    const store = memoryStore();
    expect(recordRetry(store, "abc")).toEqual({ attempts: 1, escalated: false });
    expect(recordRetry(store, "abc")).toEqual({ attempts: 2, escalated: true });
    expect(readAttempts(store, "abc")).toBe(2);
  });

  it("a different key starts at attempts 0", () => {
    const store = memoryStore();
    recordRetry(store, "abc");
    recordRetry(store, "abc");
    expect(readAttempts(store, "other-digest")).toBe(0);
  });

  it("a blocked store (getItem/setItem throw) degrades to attempts 0 and never throws", () => {
    expect(() => recordRetry(throwingStore, "abc")).not.toThrow();
    expect(recordRetry(throwingStore, "abc")).toEqual({ attempts: 0, escalated: false });
    expect(readAttempts(throwingStore, "abc")).toBe(0);
  });

  it("no store at all (SSR) reads 0", () => {
    expect(readAttempts(null, "abc")).toBe(0);
    expect(recordRetry(null, "abc")).toEqual({ attempts: 0, escalated: false });
  });

  it("garbage in the store reads as 0", () => {
    const store = memoryStore();
    recordRetry(store, "k");
    for (const k of store.data.keys()) store.data.set(k, "not-a-number");
    expect(readAttempts(store, "k")).toBe(0);
  });
});

describe("actionsFor", () => {
  it("attempts 0 -> primary retry, no report CTA", () => {
    const a = actionsFor({ attempts: 0 });
    expect(a.primary).toBe("retry");
    expect(a.showReport).toBe(false);
    expect(a.retryLabel).toBe("Try again");
    expect(a.escalated).toBe(false);
  });

  it("attempts 1 -> still retry first, but the label shows the retry happened", () => {
    const a = actionsFor({ attempts: 1 });
    expect(a.primary).toBe("retry");
    expect(a.retryLabel).toContain("1");
  });

  it("attempts 2 -> report is primary, retry stays as a secondary labelled with the count", () => {
    const a = actionsFor({ attempts: 2 });
    expect(a.primary).toBe("report");
    expect(a.showReport).toBe(true);
    expect(a.escalated).toBe(true);
    expect(a.retryLabel).toMatch(/^Try again/);
    expect(a.retryLabel).toContain("2");
    expect(a.retryLabel).not.toContain("\u2014");
  });
});

describe("errorKey", () => {
  it("prefers the digest", () => {
    expect(errorKey({ digest: "abc" }, "/org/x")).toBe("abc");
  });

  it("a digest-less client error gets a path-scoped key, stable across mounts", () => {
    const k = errorKey({ digest: undefined, message: "boom" }, "/org/x");
    expect(k).not.toBe("abc");
    expect(k).toContain("/org/x");
    expect(errorKey({ message: "boom" }, "/org/x")).toBe(k);
    expect(errorKey({ message: "boom" }, "/org/y")).not.toBe(k);
  });

  it("the path-scoped key never stores a token or the raw message", () => {
    const k = errorKey({ message: "secret-abc" }, "/live/shared/tok_123?x=1#frag");
    expect(k).not.toContain("tok_123");
    expect(k).not.toContain("secret-abc");
    expect(k).not.toContain("?x=1");
  });
});

describe("redactPath", () => {
  it.each([
    ["/live/shared/tok_123?x=1", "/live/shared/[token]"],
    ["/share/briefing/tok_456#section", "/share/briefing/[token]"],
    ["/invite/inv_789/accept?email=a@b.c", "/invite/[token]/accept"],
    ["/org/acme?tab=live#top", "/org/acme"],
    ["", "/"],
  ])("%s -> %s", (input, out) => {
    expect(redactPath(input)).toBe(out);
  });
});

describe("reportHref (outbound link privacy)", () => {
  const label = "[ascent] app-route-error";

  it("targets the deployment's tracker and carries the digest + a redacted share path", () => {
    const href = reportHref({ digest: "abc", path: "/live/shared/tok_123?x=1", label });
    expect(href.startsWith(`${FEEDBACK_URL}/new?`)).toBe(true);
    const body = decodedBody(href);
    expect(body).toContain("abc");
    expect(body).toContain("/live/shared/[token]");
    expect(body).not.toContain("tok_123");
    expect(body).not.toContain("?x=1");
    expect(href).not.toContain("tok_123");
  });

  it("redacts a briefing share token and a fragment the same way", () => {
    const href = reportHref({ digest: "abc", path: "/share/briefing/brf_secret#frag", label });
    const body = decodedBody(href);
    expect(body).toContain("/share/briefing/[token]");
    expect(body).not.toContain("brf_secret");
    expect(body).not.toContain("frag");
  });

  it("an explicit base is honoured", () => {
    const href = reportHref({ digest: "abc", path: "/", label }, "https://example.test/o/r/issues");
    expect(href.startsWith("https://example.test/o/r/issues/new?")).toBe(true);
  });

  it("never includes error.message or error.stack, even if handed the whole error", () => {
    const err = Object.assign(new Error("boom secret-token-abc123"), { digest: "D1" });
    err.stack = "Error: x\n    at /app/secret/path.ts:42:7";
    const input = { ...err, message: err.message, stack: err.stack, digest: "D1", path: "/org/x", label };
    const href = reportHref(input);
    const body = decodedBody(href);
    expect(body).toContain("D1");
    expect(body).not.toContain("secret-token-abc123");
    expect(body).not.toContain("/app/secret/path.ts");
    expect(decodeURIComponent(href)).not.toContain("secret-token-abc123");
  });

  it("carries no em dash and no identity-shaped fields", () => {
    const body = decodedBody(reportHref({ digest: "abc", path: "/org/x", label }));
    expect(body).not.toContain("\u2014");
    expect(body).not.toMatch(/@|email|user/i);
  });

  it("a missing digest still yields a usable body", () => {
    const body = decodedBody(reportHref({ digest: undefined, path: "/org/x", label }));
    expect(body).toContain("/org/x");
    expect(body).not.toContain("undefined");
  });
});

describe("reportDetails (copy fallback)", () => {
  it("is the same redacted text, no message", () => {
    const text = reportDetails({ digest: "abc", path: "/live/shared/tok_1?q=2#f", label: "[l]" });
    expect(text).toContain("abc");
    expect(text).toContain("/live/shared/[token]");
    expect(text).not.toContain("tok_1");
    expect(text).not.toContain("q=2");
  });
});

describe("shouldCapture (Sentry once per key)", () => {
  it("returns true once per key", () => {
    const seen = new Set<string>();
    expect(shouldCapture("k1", seen)).toBe(true);
    expect(shouldCapture("k1", seen)).toBe(false);
    expect(shouldCapture("k2", seen)).toBe(true);
  });
});
