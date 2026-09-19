// Pins the permalink `repo` segment grammar for /report/{owner}/{repo}[@{sha}].
//
// The regression this exists for: a browser (or a proxy) percent-encodes the `@` when a pinned
// permalink is copied, so the route receives `next.js%40abc…`. Without a decode the segment never
// splits — the page reads it as a repo literally NAMED "next.js%40abc…", finds no scan, and offers a
// "Scan now" CTA for a repository that cannot exist. Decoding must be defensive: already-decoded
// input passes through unchanged, and a malformed escape must fall back to the raw segment rather
// than throwing a 500 on a shared link.

import { describe, expect, it } from "vitest";
import { parseRepoParam } from "./repoParam";

describe("parseRepoParam", () => {
  it("splits a plain `name@sha` segment", () => {
    expect(parseRepoParam("next.js@abc1234")).toEqual({ name: "next.js", sha: "abc1234" });
  });

  it("decodes a percent-encoded `@` (%40) so an encoded permalink resolves", () => {
    expect(parseRepoParam("next.js%40abc1234")).toEqual({ name: "next.js", sha: "abc1234" });
  });

  it("decodes only ONCE — a double-encoded segment keeps its literal escape", () => {
    // `%2540` is an encoded `%40`; decoding once yields the literal text "%40", which is NOT an `@`,
    // so the segment stays unsplit rather than being decoded repeatedly into a pin.
    expect(parseRepoParam("next.js%2540abc")).toEqual({ name: "next.js%40abc" });
  });

  it("returns a bare name for an @-less segment", () => {
    expect(parseRepoParam("next.js")).toEqual({ name: "next.js" });
  });

  it("leaves an already-decoded segment untouched (idempotent for the common case)", () => {
    expect(parseRepoParam("some-repo")).toEqual({ name: "some-repo" });
    expect(parseRepoParam(parseRepoParam("next.js%40abc").name)).toEqual({ name: "next.js" });
  });

  it("never throws on a malformed percent sequence — falls back to the raw segment", () => {
    expect(() => parseRepoParam("foo%zz")).not.toThrow();
    expect(parseRepoParam("foo%zz")).toEqual({ name: "foo%zz" });
    expect(parseRepoParam("foo%")).toEqual({ name: "foo%" });
    // Malformed but still carrying a literal @: the raw fallback keeps the split working.
    expect(parseRepoParam("foo%zz@abc")).toEqual({ name: "foo%zz", sha: "abc" });
  });

  it("treats a trailing `@` with no sha as unpinned", () => {
    expect(parseRepoParam("next.js@")).toEqual({ name: "next.js", sha: undefined });
    expect(parseRepoParam("next.js%40")).toEqual({ name: "next.js", sha: undefined });
  });
});
