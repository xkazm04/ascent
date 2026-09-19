import { describe, it, expect } from "vitest";
import { repoKey } from "./repoKey";

describe("repoKey — cross-repo identity guard", () => {
  // --- Identity: variants of the SAME repo the code intends to treat as equal collapse to one key ---
  it("canonicalizes URL / .git / casing / surrounding slashes to the same key", () => {
    const canonical = "acme/app";
    expect(repoKey("acme/app")).toBe(canonical);
    expect(repoKey("Acme/App")).toBe(canonical); // lowercased
    expect(repoKey("https://github.com/Acme/App.git")).toBe(canonical); // https + .git stripped
    expect(repoKey("http://github.com/acme/app")).toBe(canonical); // http variant
    expect(repoKey("github.com/acme/app")).toBe(canonical); // bare host prefix
    expect(repoKey("/acme/app/")).toBe(canonical); // leading + trailing slashes trimmed
    expect(repoKey("https://github.com/Acme/App.git")).toBe(canonical); // no trailing slash → .git stripped
  });

  // Pin the exact rule ordering: `.git$` is end-anchored and runs BEFORE the slash trim, so a
  // trailing slash after `.git` keeps the `.git` literal (it no longer matches end-of-string).
  it("strips .git only when it is the literal end of the string (order: .git$ before slash-trim)", () => {
    expect(repoKey("https://github.com/Acme/App.git/")).toBe("acme/app.git");
  });

  it("is idempotent — re-keying an already-canonical key is a no-op", () => {
    const k = repoKey("acme/app");
    expect(repoKey(k)).toBe(k);
  });

  // --- No collisions: two DIFFERENT repos must NEVER produce the same key (else cross-repo render) ---
  it("keeps distinct repos distinct (different repo name)", () => {
    expect(repoKey("owner/a")).not.toBe(repoKey("owner/b"));
  });

  it("keeps distinct repos distinct (different owner, same repo name)", () => {
    expect(repoKey("o1/r")).not.toBe(repoKey("o2/r"));
  });

  // --- Crafted near-collision: the owner/name boundary is the literal `/`; `-` is never special ---
  // A naive normalization that flattened separators could conflate these; the real one must not.
  it("does not collide a crafted owner/name vs name shift (a/b-c vs a-b/c)", () => {
    expect(repoKey("a/b-c")).not.toBe(repoKey("a-b/c"));
    expect(repoKey("a/b-c")).toBe("a/b-c");
    expect(repoKey("a-b/c")).toBe("a-b/c");
  });

  // --- The exact normalization the call sites depend on (gotKey === reqKey) ---
  it("only strips the github.com host prefix once and only at the start", () => {
    // a repo literally named with the host segment internally is NOT a host prefix
    expect(repoKey("owner/github.com")).toBe("owner/github.com");
  });

  it("only strips a trailing .git, not an internal one", () => {
    expect(repoKey("owner/foo.git.bar")).toBe("owner/foo.git.bar");
    expect(repoKey("owner/foo.git")).toBe("owner/foo");
  });
});
