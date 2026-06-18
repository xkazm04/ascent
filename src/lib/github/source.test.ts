// parseRepoUrl is the SOLE sanitizer for repo coordinates (owner/repo) before they are
// interpolated into `https://api.github.com/repos/${owner}/${repo}` and the raw host. It guards
// 11+ untrusted API entry points (/api/scan, /api/history, /api/practices/*, …). A loosened
// scheme/host/charset guard here is an SSRF / request-path-rewrite vulnerability. These tests pin
// the EXACT accept/reject set so any regression that lets a hostile coordinate through turns red.
//
// `parseRepoUrl` is pure and has no side-effect imports at module top (only a `type` import), so we
// import and call it directly — no mocks needed.

import { describe, it, expect } from "vitest";
import { parseRepoUrl } from "./source";

// The hard security invariant the whole module rests on: a non-null result NEVER carries a coordinate
// that could rewrite the request path. owner and repo must each match the GitHub name charset — no
// slashes, traversal (`..` is two dots but a `/` would split it out), `@`, whitespace, control chars,
// query/fragment delimiters, or encoded escapes can survive into the result.
const NAME = /^[A-Za-z0-9_.-]+$/;
function assertSafe(result: ReturnType<typeof parseRepoUrl>) {
  if (result === null) return;
  expect(result.owner).toMatch(NAME);
  expect(result.repo).toMatch(NAME);
  // No path-rewriting characters can be present (redundant with NAME, asserted explicitly as the
  // security contract being pinned).
  for (const v of [result.owner, result.repo]) {
    expect(v).not.toMatch(/[/\\@:?#\s%]/);
    expect(v).not.toContain("..");
  }
}

describe("parseRepoUrl — valid forms parse to the correct {owner, repo}", () => {
  const accept: Array<[string, { owner: string; repo: string }]> = [
    ["bare owner/repo", { owner: "octocat", repo: "hello" }],
    ["github.com/o/r (scheme-less host)", { owner: "o", repo: "r" }],
    ["https://github.com/o/r", { owner: "o", repo: "r" }],
    ["https://github.com/o/r.git (.git stripped)", { owner: "o", repo: "r" }],
    ["git@github.com:o/r.git (scp-style rewritten)", { owner: "o", repo: "r" }],
    [" octocat/hello  (surrounding whitespace trimmed)", { owner: "octocat", repo: "hello" }],
    ["http://github.com/o/r (http accepted — guard is host-based, not https-only)", { owner: "o", repo: "r" }],
    ["HTTPS://GITHUB.COM/O/R (case preserved in coords)", { owner: "O", repo: "R" }],
    ["GitHub.com/o/r (host match is case-insensitive)", { owner: "o", repo: "r" }],
    ["dotted owner allowed by charset", { owner: "owner.with.dots", repo: "repo" }],
    ["underscores / hyphens / dots in repo", { owner: "o_o", repo: "r-r.r" }],
    ["legit subdomain sub.github.com/o/r", { owner: "o", repo: "r" }],
    ["extra trailing path segments ignored (owner/repo still clean)", { owner: "o", repo: "r" }],
  ];
  const inputs: Record<string, string> = {
    "bare owner/repo": "octocat/hello",
    "github.com/o/r (scheme-less host)": "github.com/o/r",
    "https://github.com/o/r": "https://github.com/o/r",
    "https://github.com/o/r.git (.git stripped)": "https://github.com/o/r.git",
    "git@github.com:o/r.git (scp-style rewritten)": "git@github.com:o/r.git",
    " octocat/hello  (surrounding whitespace trimmed)": "  octocat/hello  ",
    "http://github.com/o/r (http accepted — guard is host-based, not https-only)": "http://github.com/o/r",
    "HTTPS://GITHUB.COM/O/R (case preserved in coords)": "HTTPS://GITHUB.COM/O/R",
    "GitHub.com/o/r (host match is case-insensitive)": "GitHub.com/o/r",
    "dotted owner allowed by charset": "https://github.com/owner.with.dots/repo",
    "underscores / hyphens / dots in repo": "o_o/r-r.r",
    "legit subdomain sub.github.com/o/r": "sub.github.com/o/r",
    "extra trailing path segments ignored (owner/repo still clean)": "https://github.com/o/r/tree/main/src",
  };
  for (const [label, expected] of accept) {
    it(`accepts: ${label}`, () => {
      const out = parseRepoUrl(inputs[label]!);
      expect(out).toEqual(expected);
      assertSafe(out);
    });
  }
});

describe("parseRepoUrl — SSRF / injection vectors are rejected (return null)", () => {
  // The CORE security set. Each of these, if it slipped through, would rewrite the GitHub request path.
  const reject: Array<[string, string]> = [
    ["empty string", ""],
    ["different host with explicit scheme (the :88 reject)", "https://evil.com/a/b"],
    ["different host, http scheme", "http://evil.com/a/b"],
    ["non-github host shorthand (leading-dot heuristic)", "gitlab.com/a/b"],
    ["non-github host shorthand, dotted", "evil.com/a/b"],
    ["look-alike host suffix github.com.evil.com (explicit scheme)", "https://github.com.evil.com/a/b"],
    ["look-alike host suffix github.com.evil.com (with .git)", "https://github.com.evil.com/a/b.git"],
    ["look-alike host shorthand github.com.evil.com/o/r", "github.com.evil.com/o/r"],
    ["bare traversal ../../etc", "../../etc"],
    ["encoded traversal %2e%2e/x", "%2e%2e/x"],
    ["repo with encoded escape %2e%2e", "owner/repo%2e%2e"],
    ["CR-encoded payload in repo o/r%0d", "o/r%0d"],
    ["embedded @ in owner (@evil/x)", "@evil/x"],
    ["@ inside owner segment owner@x/r", "owner@x/r"],
    ["space inside owner (o /r)", "o /r"],
    ["space inside repo (o/ r)", "o/ r"],
    ["internal whitespace owner/re po", "owner/re po"],
    ["shell metachar in repo (o/r;rm)", "o/r;rm"],
    ["ampersand query-ish (o/r&x=1)", "o/r&x=1"],
    ["fragment delimiter in repo (o/r#frag)", "o/r#frag"],
    ["embedded newline mid-path (o/<LF>r)", "o/\nr"],
    ["only one segment (owner, no repo)", "octocat"],
    ["github.com/o with no repo", "https://github.com/o"],
    ["raw host is not github.com", "https://raw.githubusercontent.com/o/r/main/f"],
  ];
  for (const [label, input] of reject) {
    it(`rejects: ${label}`, () => {
      expect(parseRepoUrl(input)).toBeNull();
    });
  }
});

describe("parseRepoUrl — CURRENT-BEHAVIOR pins (documented quirks; safe because coords stay clean)", () => {
  // These inputs do NOT return null today, but the security invariant still holds: the owner/repo
  // that comes out is always charset-clean, so no traversal/credential/query material reaches the
  // request path. They are pinned to CURRENT behavior (no source change in scope) so an intentional
  // future tightening to `null` is a deliberate, visible decision rather than a silent drift the
  // other direction. assertSafe() guards every one — the moment a coordinate becomes unsafe, it fails.

  it("trailing-path traversal: extra `..` segments after owner/repo are dropped, owner/repo stay clean", () => {
    // `owner/repo/../x` → {owner:"owner", repo:"repo"}: the `..` is a 3rd+ segment, never interpolated.
    const a = parseRepoUrl("owner/repo/../x");
    expect(a).toEqual({ owner: "owner", repo: "repo" });
    assertSafe(a);
    const b = parseRepoUrl("o/r/../../admin");
    expect(b).toEqual({ owner: "o", repo: "r" });
    assertSafe(b);
  });

  it("userinfo/credentials are stripped by URL parsing, not leaked into coords", () => {
    // The host is still github.com, so this parses; the `user:pass@` userinfo is discarded by URL().
    const a = parseRepoUrl("https://user:pass@github.com/o/r");
    expect(a).toEqual({ owner: "o", repo: "r" });
    assertSafe(a);
    const b = parseRepoUrl("user:pass@github.com/o/r");
    expect(b).toEqual({ owner: "o", repo: "r" });
    assertSafe(b);
  });

  it("query/fragment on an otherwise-valid github URL are dropped, not injected", () => {
    const out = parseRepoUrl("https://github.com/o/r?x=1#frag");
    expect(out).toEqual({ owner: "o", repo: "r" });
    assertSafe(out);
  });

  it("trailing control chars / whitespace are trimmed away (leading/trailing only)", () => {
    expect(parseRepoUrl("o/r\r")).toEqual({ owner: "o", repo: "r" });
    expect(parseRepoUrl("o/r\t")).toEqual({ owner: "o", repo: "r" });
    expect(parseRepoUrl("o/r ")).toEqual({ owner: "o", repo: "r" });
  });

  it("ftp scheme on a github host is accepted (scheme is not restricted)", () => {
    const out = parseRepoUrl("ftp://github.com/o/r");
    expect(out).toEqual({ owner: "o", repo: "r" });
    assertSafe(out);
  });

  it("host-suffix gap: a host merely ENDING in 'github.com' matches (e.g. notgithub.com)", () => {
    // KNOWN LIMITATION pinned to current behavior: /github\.com$/ has no left boundary, so
    // `notgithub.com` satisfies it. Coords are still charset-clean, so this is not itself an SSRF
    // (the request would target notgithub.com only if that host were used downstream — it isn't here;
    // owner/repo are interpolated into the fixed api.github.com base). Pinned so any tightening of the
    // host check to a strict match is a conscious change that updates this assertion.
    const out = parseRepoUrl("notgithub.com/o/r");
    expect(out).toEqual({ owner: "o", repo: "r" });
    assertSafe(out);
  });
});
