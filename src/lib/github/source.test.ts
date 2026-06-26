// parseRepoUrl is the SOLE sanitizer for repo coordinates (owner/repo) before they are
// interpolated into `https://api.github.com/repos/${owner}/${repo}` and the raw host. It guards
// 11+ untrusted API entry points (/api/scan, /api/history, /api/practices/*, …). A loosened
// scheme/host/charset guard here is an SSRF / request-path-rewrite vulnerability. These tests pin
// the EXACT accept/reject set so any regression that lets a hostile coordinate through turns red.
//
// `parseRepoUrl` is pure and has no side-effect imports at module top (only a `type` import), so we
// import and call it directly — no mocks needed.

import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRepoUrl, GitHubPublicSource, resolveHead } from "./source";
import { fetchBranchGovernance } from "./governance";
import { fetchPullRequests, type PrNode } from "./graphql";
import { summarizePullRequests } from "@/lib/analyze/pulls";

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
    ["repo is the parent-dir token (o/..)", "o/.."],
    ["repo contains a traversal segment (o/a..b)", "o/a..b"],
    ["owner is the parent-dir token (../r equivalent o..o/r)", "o..o/r"],
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

  it("host-suffix look-alike is rejected: a host merely ENDING in 'github.com' is NOT github.com (e.g. notgithub.com)", () => {
    // The host check is anchored to the EXACT host `github.com` (or a real `*.github.com` subdomain),
    // so a suffix look-alike like `notgithub.com` has no left boundary at `github.com` and is rejected.
    // As a scheme-less shorthand it also fails the bare parser's leading-dot heuristic, so it returns null.
    expect(parseRepoUrl("notgithub.com/o/r")).toBeNull();
    expect(parseRepoUrl("https://notgithub.com/o/r")).toBeNull();
    expect(parseRepoUrl("https://evilgithub.com/o/r")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// estimateCoverage — the cache-poison gate (finding test-mastery #2, source.ts:630)
// ---------------------------------------------------------------------------------------------------
// estimateCoverage is module-PRIVATE (no source change is in scope to export it), so we pin its
// behaviour through the only public surface that exercises it: GitHubPublicSource.fetchSnapshot().
// fetchSnapshot computes `coverage = estimateCoverage(blobs.length, files.length, picks.length,
// truncated)` and returns it on the snapshot — and the scan routes' cache-pin guard keys off exactly
// this number. The invariant under test: a TRANSIENT raw-host blip that drops some picked files must
// scale coverage DOWN (fetched/attempted) so a degraded snapshot can't be cached at ~0.95 as if it
// were a real, fully-read scan. A genuinely-empty repo (no files picked) is distinguished from a blip
// because it leaves `attempted = 0`, which takes the `*1` rate branch rather than poisoning to 0.
//
// We mock the global `fetch` (the same seam list.test.ts/resolveHead use) and route by URL:
//   api.github.com/repos/o/r            -> repo metadata (size kept small => totalBlobs <= MAX_FILES)
//   api.github.com/repos/o/r/git/trees  -> the tree (controls totalBlobs, picks, and `truncated`)
//   api.github.com/repos/o/r/commits    -> [] (irrelevant to coverage)
//   raw.githubusercontent.com/...        -> per-file content: 200 = a successful pick, non-2xx OR a
//                                          thrown network error = a transient blip (file dropped)

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

/** A Response-like object (mirrors list.test.ts's helper) that also supports .text() for raw files. */
function res(
  body: unknown,
  init: { status?: number; headers?: Record<string, string>; text?: string } = {},
): Response {
  const status = init.status ?? 200;
  const h = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => init.text ?? (typeof body === "string" ? body : JSON.stringify(body)),
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
  } as unknown as Response;
}

const repoMetaBody = {
  name: "r",
  owner: { login: "o" },
  html_url: "https://github.com/o/r",
  description: null,
  private: false,
  stargazers_count: 0,
  forks_count: 0,
  open_issues_count: 0,
  language: "TypeScript",
  pushed_at: "2026-01-01T00:00:00Z",
  default_branch: "main",
  size: 100,
  license: null,
  topics: [],
};

function treeBody(paths: string[], truncated: boolean) {
  return {
    sha: "a".repeat(40),
    truncated,
    tree: paths.map((p) => ({ path: p, type: "blob", size: 10, sha: "b".repeat(40) })),
  };
}

/**
 * Build a fetch mock for a fixed tree. `rawOutcome(path)` decides each raw-host file fetch:
 *   "ok"    -> 200 with content (a successful pick → counts toward `fetched`)
 *   "blip"  -> 503 (non-2xx → fetchRaw returns null → file dropped, a transient blip)
 *   "throw" -> the fetch itself rejects (network error → caught → file dropped, a transient blip)
 */
function makeFetch(paths: string[], truncated: boolean, rawOutcome: (path: string) => "ok" | "blip" | "throw") {
  return vi.fn(async (url: string) => {
    if (url.startsWith(`${API}/repos/o/r/git/trees/`)) return res(treeBody(paths, truncated));
    if (url.startsWith(`${API}/repos/o/r/commits`)) return res([]);
    if (url === `${API}/repos/o/r`) return res(repoMetaBody);
    if (url.startsWith(`${RAW}/o/r/`)) {
      // The raw URL is `${RAW}/o/r/<ref>/<encoded path>`; recover the path tail for the outcome map.
      const tail = decodeURIComponent(url.slice(`${RAW}/o/r/main/`.length));
      const outcome = rawOutcome(tail);
      if (outcome === "throw") throw new Error("transient raw-host network blip");
      if (outcome === "blip") return res("", { status: 503 });
      return res(null, { text: `// content of ${tail}\n` });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

// 8 exact-high-signal filenames: pickFilesToFetch adds each exactly once (none has a source/test
// extension, so no extra sample-bucket picks sneak in) → a DETERMINISTIC attempted=8.
const EIGHT_PICKS = [
  "readme.md",
  "package.json",
  "tsconfig.json",
  "dockerfile",
  "security.md",
  "changelog.md",
  "contributing.md",
  "renovate.json",
];

afterEach(() => vi.unstubAllGlobals());

describe("estimateCoverage (via GitHubPublicSource.fetchSnapshot) — transient blip must not poison the cache", () => {
  it("(a) small repo, ALL picks succeed → 0.95 (full confidence)", async () => {
    vi.stubGlobal("fetch", makeFetch(EIGHT_PICKS, false, () => "ok"));
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.files).toHaveLength(8); // fetched === attempted
    expect(snap.coverage).toBe(0.95);
  });

  it("(b) small repo, HALF the picks blip out (fetched=4/attempted=8) → coverage scaled DOWN, below the cache-pin threshold (NOT a false 0.95)", async () => {
    // The exact regression the function's comment was written to prevent: a transient raw-host blip
    // dropping half the files must NOT still read as ~0.95 and get cached for the full TTL.
    const drop = new Set(EIGHT_PICKS.slice(0, 4)); // first 4 fail (503)
    vi.stubGlobal("fetch", makeFetch(EIGHT_PICKS, false, (p) => (drop.has(p) ? "blip" : "ok")));
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.files).toHaveLength(4); // fetched=4, attempted=8 → fetchRate=0.5
    expect(snap.coverage).toBeLessThan(0.95); // the cache-poison guard: degraded ≠ full
    expect(snap.coverage).toBeLessThan(0.6); // well under any sane cache-pin threshold
    expect(snap.coverage).toBe(0.48); // pin the exact math: round(0.95 * 0.5) = 0.48
  });

  it("(b') a THROWN network blip (not just non-2xx) is also caught and scales coverage down identically", async () => {
    // fetchRaw swallows both a non-2xx AND a thrown fetch → same degrade path. Proven so a refactor
    // that handles only one error shape still keeps the poison gate closed for the other.
    const drop = new Set(EIGHT_PICKS.slice(0, 4));
    vi.stubGlobal("fetch", makeFetch(EIGHT_PICKS, false, (p) => (drop.has(p) ? "throw" : "ok")));
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.files).toHaveLength(4);
    expect(snap.coverage).toBe(0.48);
  });

  it("(c) a TRUNCATED tree clamps coverage to ≤ 0.6 regardless of a perfect fetch rate", async () => {
    vi.stubGlobal("fetch", makeFetch(EIGHT_PICKS, true, () => "ok"));
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.truncated).toBe(true);
    expect(snap.coverage).toBeLessThanOrEqual(0.6);
    expect(snap.coverage).toBe(0.6); // min(0.95, 0.6)
  });

  it("(d) GENUINELY-empty signal (a repo with files but NONE worth picking) → attempted=0 takes the *1 branch, NOT a poisoned 0 or NaN", async () => {
    // This is the empty-but-SUCCESSFUL case the finding asks to distinguish from a fetch failure: the
    // repo has a blob, but it's an opaque binary nothing picks, so picks.length===0. The fetchRate
    // guard (`attempted > 0 ? … : 1`) must keep coverage finite and high, never NaN and never a
    // confident-low number a blip would have produced.
    const fetchMock = makeFetch(["assets/logo.bin"], false, () => "ok");
    vi.stubGlobal("fetch", fetchMock);
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.files).toHaveLength(0); // attempted = 0
    expect(Number.isNaN(snap.coverage)).toBe(false); // no NaN
    expect(snap.coverage).toBe(0.95); // the `*1` branch, distinct from a blip's degraded number
    // No raw-host fetch should have fired at all (nothing was picked) — proves attempted=0 is real,
    // not a silent all-blip.
    const rawCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith(`${RAW}/`));
    expect(rawCalls).toHaveLength(0);
  });

  it("(e) LARGE repo (totalBlobs > MAX_FILES) uses the 0.4 + fetched/totalBlobs branch, capped at 0.9", async () => {
    // 40 plain source files → totalBlobs=40 (> MAX_FILES=32); the sample bucket caps picks at 6.
    const big = Array.from({ length: 40 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
    vi.stubGlobal("fetch", makeFetch(big, false, () => "ok"));
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.tree.length).toBe(40);
    expect(snap.files).toHaveLength(6); // sample bucket .slice(0, 6)
    // 0.4 + fetched/totalBlobs = 0.4 + 6/40 = 0.55, under the 0.9 cap.
    expect(snap.coverage).toBe(0.55);
    expect(snap.coverage).toBeLessThanOrEqual(0.9);
  });

  it("(e') LARGE repo where the picks blip out scores LOWER still (degrade survives the large-repo branch too)", async () => {
    const big = Array.from({ length: 40 }, (_, i) => `src/f${String(i).padStart(2, "0")}.ts`);
    vi.stubGlobal("fetch", makeFetch(big, false, () => "blip")); // all 6 picks fail
    const snap = await new GitHubPublicSource().fetchSnapshot({ owner: "o", repo: "r" });
    expect(snap.files).toHaveLength(0); // fetched=0
    // 0.4 + 0/40 = 0.4 — still a finite, sub-perfect number, never 0.9.
    expect(snap.coverage).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------------------------------
// resolveHead — the status→HeadLookup mapping that keys cache freshness (finding test-mastery #3, src/lib/github/source.ts:185)
// ---------------------------------------------------------------------------------------------------
// resolveHead is only ever MOCKED elsewhere (scan-cache.test.ts); its real status→HeadLookup mapping is
// never exercised. This block pins the producer contract directly. The returned `ok.sha` becomes the
// `owner/repo@sha::mode` cache key, so a wrong status→SHA mapping silently defeats invalidation (a stale
// report served after a push) or fragments/poisons the cache with a bogus SHA. We stub the global `fetch`
// (the seam list.test.ts uses) and pin status→result per case. Invariants:
//   - a returned ok.sha ALWAYS matches /^[0-9a-f]{7,40}$/ and is lowercased;
//   - 304 maps to `unmodified` (the free-revalidation promise — GitHub doesn't bill a 304), and only then
//     is `If-None-Match` sent (so the 304 path can actually be reached on a quiet repo);
//   - every non-ok / non-304 status (404, 403, 500) AND a non-SHA 200 body AND a thrown fetch map to
//     `error` — NEVER a fabricated `ok` SHA that would key (and serve) a stale scan.

const SHA40 = /^[0-9a-f]{7,40}$/;

/** Capture the single request resolveHead makes so we can assert the headers/url it sent. */
function captureHeadFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string, init: RequestInit = {}) => impl(url, init));
}

describe("resolveHead — status→HeadLookup mapping keys cache freshness; a wrong map can't serve a stale scan", () => {
  it("304 → {status:'unmodified'} and sends If-None-Match (the free re-validation promise on a quiet repo)", async () => {
    const fetchMock = captureHeadFetch(() => res("", { status: 304 }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await resolveHead({ owner: "o", repo: "r" }, { etag: 'W/"abc123"' });
    expect(out).toEqual({ status: "unmodified" }); // no sha echoed back — caller owns it via the ETag
    // The conditional request MUST carry the supplied ETag, else GitHub can never answer 304 and the
    // "costs zero quota" re-scan promise is dead.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.github.com/repos/o/r/commits/HEAD");
    const sentHeaders = (init as RequestInit).headers as Record<string, string>;
    expect(sentHeaders["If-None-Match"]).toBe('W/"abc123"');
    // The cheap-lookup media type + no-store are load-bearing (sha-only body, no framework cache).
    expect(sentHeaders["Accept"]).toBe("application/vnd.github.sha");
    expect((init as RequestInit).cache).toBe("no-store");
  });

  it("no etag passed → NO If-None-Match header (an unconditional first lookup)", async () => {
    const fetchMock = captureHeadFetch(() => res("c".repeat(40), { headers: { etag: 'W/"e"' } }));
    vi.stubGlobal("fetch", fetchMock);

    await resolveHead({ owner: "o", repo: "r" });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const sentHeaders = init.headers as Record<string, string>;
    expect("If-None-Match" in sentHeaders).toBe(false);
  });

  it("200 + a 40-hex body → {status:'ok', sha:lowercased, etag} (the SHA that keys the cache)", async () => {
    const upper = "ABCDEF0123456789ABCDEF0123456789ABCDEF01"; // 40 hex, mixed case
    const fetchMock = captureHeadFetch(() => res(upper, { headers: { etag: 'W/"fresh"' } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await resolveHead({ owner: "o", repo: "r" });
    expect(out.status).toBe("ok");
    if (out.status !== "ok") throw new Error("unreachable");
    expect(out.sha).toBe(upper.toLowerCase()); // lowercased so the cache key is canonical
    expect(out.sha).toMatch(SHA40); // invariant: a returned sha is always SHA-shaped
    expect(out.etag).toBe('W/"fresh"'); // captured for the next conditional lookup
  });

  it("200 + a short-but-valid 7-hex body still maps to ok (the 7..40 guard lower bound)", async () => {
    vi.stubGlobal("fetch", captureHeadFetch(() => res("abc1234")));
    const out = await resolveHead({ owner: "o", repo: "r" });
    expect(out.status).toBe("ok");
    if (out.status === "ok") expect(out.sha).toMatch(SHA40);
  });

  it("200 + a NON-SHA body (an HTML error page) → {status:'error'} — a bogus SHA must NEVER key the cache", async () => {
    // The exact cache-poison vector: if the SHA-shape guard loosens, an HTML/error body becomes a cache
    // key, colliding or fragmenting scans. It must be rejected as `error`, not returned as `ok`.
    vi.stubGlobal("fetch", captureHeadFetch(() => res("<!DOCTYPE html><html>nope</html>")));
    const out = await resolveHead({ owner: "o", repo: "r" });
    expect(out).toEqual({ status: "error" });
  });

  it("200 + a truncated/garbage body (too long, non-hex chars) → {status:'error'}", async () => {
    vi.stubGlobal("fetch", captureHeadFetch(() => res("z".repeat(41))));
    const out = await resolveHead({ owner: "o", repo: "r" });
    expect(out).toEqual({ status: "error" });
  });

  it("404 (missing/private repo) → {status:'error'} — falls back to a SHA-less key, not a fake ok", async () => {
    vi.stubGlobal("fetch", captureHeadFetch(() => res("Not Found", { status: 404 })));
    expect(await resolveHead({ owner: "o", repo: "r" })).toEqual({ status: "error" });
  });

  it("403 (rate-limited/denied) → {status:'error'} — a denial is unreadable, NOT a confident head", async () => {
    vi.stubGlobal("fetch", captureHeadFetch(() => res("rate limited", { status: 403 })));
    expect(await resolveHead({ owner: "o", repo: "r" })).toEqual({ status: "error" });
  });

  it("500 (upstream error) → {status:'error'}", async () => {
    vi.stubGlobal("fetch", captureHeadFetch(() => res("boom", { status: 500 })));
    expect(await resolveHead({ owner: "o", repo: "r" })).toEqual({ status: "error" });
  });

  it("a thrown/aborted fetch (network/timeout) → {status:'error'}, never a leaked rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await resolveHead({ owner: "o", repo: "r" })).toEqual({ status: "error" });
  });
});

// ---------------------------------------------------------------------------------------------------
// fetchBranchGovernance — protection-rule extraction + the readable-vs-null contract (finding test-mastery #4,
// src/lib/github/governance.ts:47). Lives in a sibling module but shares the global-fetch seam, so it is
// pinned here alongside the rest of the GitHub I/O contract (RULES: extend only source.test.ts).
// ---------------------------------------------------------------------------------------------------
// Governance posture feeds the maturity score, the org security/governance dashboards, and exec PDFs.
// A regression in the ruleset parsing or the branch-read gate makes a PROTECTED branch read as
// "no protection" — a credibility-critical false negative — or returns null="unknown" when the
// protection-bearing read actually succeeded. The hard invariant (github-repo-data-access #4): the
// `protected` flag and the "unprotected" verdict come ONLY from the branch read, so `null` is returned
// whenever that branch read did NOT return 200 (a denied/renamed branch is "unknown", NOT "unprotected"),
// even if the rulesets call succeeded; an empty-but-readable {readable:true} result therefore REQUIRES a
// 200 branch read. We mock the two paired REST calls (branches/{branch} + rules/branches/{branch}) with
// vi.fn() and route by URL.

const GAPI = "https://api.github.com";
const branchUrl = (b: string) => `${GAPI}/repos/o/r/branches/${b}`;
const rulesUrl = (b: string) => `${GAPI}/repos/o/r/rules/branches/${b}`;

/** Full applied ruleset: PR (with approvals + code-owner), status checks, signatures, linear history. */
const FULL_RULES = [
  {
    type: "pull_request",
    parameters: { required_approving_review_count: 2, require_code_owner_review: true },
  },
  { type: "required_status_checks", parameters: { required_status_checks: [{ context: "ci" }] } },
  { type: "required_signatures" },
  { type: "required_linear_history" },
];

/**
 * Mock the two paired governance fetches. `branch` and `rules` each give a status + body; either may be
 * a non-200 to simulate a partial/denied read.
 */
function makeGovFetch(
  branch: { status: number; body: unknown },
  rules: { status: number; body: unknown },
) {
  return vi.fn(async (url: string) => {
    if (url === branchUrl("main")) return res(branch.body, { status: branch.status });
    if (url === rulesUrl("main")) return res(rules.body, { status: rules.status });
    throw new Error(`unexpected governance fetch in test: ${url}`);
  });
}

describe("fetchBranchGovernance — rule extraction + the readable-vs-null contract (null when the protection-bearing branch read isn't 200)", () => {
  it("full ruleset, both 200 → every flag true and requiredApprovals plucked from parameters", async () => {
    vi.stubGlobal(
      "fetch",
      makeGovFetch({ status: 200, body: { protected: true } }, { status: 200, body: FULL_RULES }),
    );
    const gov = await fetchBranchGovernance("o", "r", "main", "tok");
    expect(gov).toEqual({
      defaultBranch: "main",
      protected: true,
      requiresPullRequest: true,
      requiredApprovals: 2, // plucked from pull_request.parameters, not defaulted to 0
      requiresCodeOwnerReview: true,
      requiresStatusChecks: true,
      requiresSignatures: true,
      linearHistory: true,
      ruleCount: 4,
      readable: true,
    });
  });

  it("readable but NO pull_request rule → requiresPullRequest:false & requiredApprovals:0 (not a crash, not null)", async () => {
    // An empty-but-readable result: the calls succeeded, the branch just has no PR rule. This is the
    // case that MUST stay distinct from the unreadable→null case below.
    vi.stubGlobal(
      "fetch",
      makeGovFetch(
        { status: 200, body: { protected: false } },
        { status: 200, body: [{ type: "required_signatures" }] },
      ),
    );
    const gov = await fetchBranchGovernance("o", "r", "main", "tok");
    expect(gov).not.toBeNull();
    expect(gov!.readable).toBe(true);
    expect(gov!.requiresPullRequest).toBe(false);
    expect(gov!.requiredApprovals).toBe(0);
    expect(gov!.requiresSignatures).toBe(true);
    expect(gov!.ruleCount).toBe(1);
  });

  it("one call 200 / one 404 → readable:true object (a partial read is still authoritative, not null)", async () => {
    // branch 200, rules 404: readable === (200 || 404===200) === true. The rules array is empty (404
    // body isn't an array) so PR flags are false — but the result is a real object, NOT the null="unknown".
    vi.stubGlobal(
      "fetch",
      makeGovFetch({ status: 200, body: { protected: true } }, { status: 404, body: { message: "Not Found" } }),
    );
    const gov = await fetchBranchGovernance("o", "r", "main", "tok");
    expect(gov).not.toBeNull();
    expect(gov!.readable).toBe(true);
    expect(gov!.protected).toBe(true);
    expect(gov!.requiresPullRequest).toBe(false);
    expect(gov!.ruleCount).toBe(0);
  });

  it("the protection-bearing branch read DENIED (branch 404 / rules 200) → null, NOT a false protected:false (github-repo-data-access #4)", async () => {
    // PREVIOUSLY this returned a readable:true object with protected:false (the `protected` flag absent
    // from a failed branch read defaulted to false) — a credibility-critical false negative that reported
    // a repo which actually enforces protection as wide open whenever the token's branch read is restricted.
    // The branch read is the ONLY authority for the `protected` flag, so a non-200 branch read is now
    // "protection unknown" → null (governance omitted), even though the rulesets call succeeded.
    vi.stubGlobal(
      "fetch",
      makeGovFetch({ status: 404, body: { message: "Not Found" } }, { status: 200, body: FULL_RULES }),
    );
    expect(await fetchBranchGovernance("o", "r", "main", "tok")).toBeNull();
  });

  it("BOTH calls 404 → null (unreadable/unknown), NOT a false readable:false 'no rules' object", async () => {
    // The core invariant: neither call returned 200, so posture is UNKNOWN and must be null. Returning a
    // {readable:false, requiresPullRequest:false,…} object here would misreport an unknown as "no protection".
    vi.stubGlobal(
      "fetch",
      makeGovFetch({ status: 404, body: { message: "Not Found" } }, { status: 404, body: { message: "Not Found" } }),
    );
    expect(await fetchBranchGovernance("o", "r", "main", "tok")).toBeNull();
  });

  it("a DENIED read (both 403) → null, never a false 'no rules' (a denial is unreadable, not unprotected)", async () => {
    vi.stubGlobal(
      "fetch",
      makeGovFetch({ status: 403, body: { message: "Forbidden" } }, { status: 403, body: { message: "Forbidden" } }),
    );
    expect(await fetchBranchGovernance("o", "r", "main", "tok")).toBeNull();
  });

  it("a thrown fetch is swallowed → null (no leaked rejection into the scan)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await fetchBranchGovernance("o", "r", "main", "tok")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------
// fetchPullRequests — cursor pagination + partial-data resilience (finding test-mastery #
// github-repo-data-access MEDIUM, src/lib/github/graphql.ts:110). Sibling module, same global-fetch
// seam, so pinned here alongside the rest of the GitHub I/O contract (RULES: extend only source.test.ts).
// ---------------------------------------------------------------------------------------------------
// fetchPullRequests walks the GraphQL `pullRequests` connection with a cursor until it has `limit`
// nodes or the repo runs out, instead of silently truncating at GraphQL's 100/page cap. A regression
// here means the maturity score is computed off a non-representative PR slice. The hard invariants:
//   - it FOLLOWS the cursor across pages, requesting `min(100, target-have)` each page and passing the
//     prior page's endCursor as `after`, accumulating up to `limit` nodes;
//   - it STOPS on a short page (hasNextPage:false) OR an empty page (nodes:[]) — never loops forever
//     (bounded by MAX_PAGES) and never over-fetches past `limit`;
//   - `data.repository === null` (missing/denied repo) → break with whatever accumulated; a zero-PR
//     repo → totalCount/nodes both empty, NOT a crash;
//   - a non-2xx mid-pagination PROPAGATES (githubGraphql throws on !res.ok) — the partial pages already
//     pushed are discarded by the throw, which is the real code's behaviour (the scan fails loudly
//     rather than scoring a half-read window);
//   - a partial-data response (PR nodes missing fields) is tolerated by the summarize step downstream:
//     malformed PRs are skipped/defaulted, not a crash.
//
// We stub the global `fetch` (the same seam every block above uses). fetchPullRequests POSTs to the
// GraphQL endpoint; we decode the request body to read the `after` cursor + `num` and answer per page.

const GQL = "https://api.github.com/graphql";

/** A minimal-but-complete PR node (every field PrNode requires), parameterized by number. */
function prNode(n: number, over: Partial<PrNode> = {}): PrNode {
  return {
    number: n,
    title: `PR ${n}`,
    bodyText: "",
    isDraft: false,
    state: "MERGED",
    createdAt: "2026-01-01T00:00:00Z",
    mergedAt: "2026-01-02T00:00:00Z",
    closedAt: null,
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    author: { login: "octocat", __typename: "User" },
    labels: { nodes: [] },
    reviews: { totalCount: 1, nodes: [{ state: "APPROVED", submittedAt: "2026-01-01T06:00:00Z" }] },
    comments: { totalCount: 0 },
    ...over,
  };
}

/** A GraphQL `pullRequests` page payload wrapped in the {data:{repository:{pullRequests}}} envelope. */
function gqlPage(
  nodes: PrNode[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null },
  totalCount: number,
) {
  return {
    data: { repository: { pullRequests: { totalCount, pageInfo, nodes } } },
  };
}

/** Read `after` (cursor) + `num` out of the POSTed GraphQL request body. */
function readVars(init: RequestInit | undefined): { after: string | null; num: number } {
  const body = JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) as {
    variables?: { after?: string | null; num?: number };
  };
  return { after: body.variables?.after ?? null, num: body.variables?.num ?? 0 };
}

/** Build a fetch mock that serves a list of pages in order, keyed by the incoming `after` cursor. */
function makePagedFetch(pages: ReturnType<typeof gqlPage>[]) {
  // Page 0 answers when after===null; subsequent pages answer when after===`cur<i>` (the endCursor we
  // handed out for the prior page). This proves the function actually threads the cursor forward.
  const cursorFor = (i: number) => `cur${i}`;
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== GQL) throw new Error(`unexpected fetch in test: ${url}`);
    const { after } = readVars(init);
    const idx = after === null ? 0 : pages.findIndex((_, i) => cursorFor(i) === after) + 1;
    const page = pages[idx];
    if (!page) throw new Error(`no page for after=${after}`);
    return res(page);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchPullRequests — cursor pagination across pages, accumulating up to `limit`", () => {
  it("follows the cursor across 3 pages and accumulates exactly `limit` nodes", async () => {
    // limit=250 over a 100/page cap → 3 pages: 100 + 100 + 50. Each page hands out endCursor curN so
    // the next request must arrive with after===curN, proving real cursor threading (not 3 identical
    // first-page reads). totalCount is the repo-wide count, constant across pages.
    const page = (start: number, count: number, hasNext: boolean, i: number) =>
      gqlPage(
        Array.from({ length: count }, (_, k) => prNode(start + k)),
        { hasNextPage: hasNext, endCursor: hasNext ? `cur${i}` : null },
        1000,
      );
    const fetchMock = makePagedFetch([
      page(0, 100, true, 0),
      page(100, 100, true, 1),
      page(200, 50, false, 2),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 250);
    expect(out.totalCount).toBe(1000);
    expect(out.nodes).toHaveLength(250);
    expect(out.nodes[0]!.number).toBe(0);
    expect(out.nodes[249]!.number).toBe(249); // every page's nodes are in order, no gaps/dupes
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Page 1 asked for the full 100 (after=null); page 2 carried cur0; page 3 carried cur1 and asked
    // for only the remaining 50 (min(100, 250-200)) — proves both the cursor AND the per-page `num`.
    const v0 = readVars(fetchMock.mock.calls[0]![1]);
    const v1 = readVars(fetchMock.mock.calls[1]![1]);
    const v2 = readVars(fetchMock.mock.calls[2]![1]);
    expect([v0.after, v0.num]).toEqual([null, 100]);
    expect([v1.after, v1.num]).toEqual(["cur0", 100]);
    expect([v2.after, v2.num]).toEqual(["cur1", 50]);
  });

  it("stops early on a SHORT page (hasNextPage:false) even when `limit` is not yet reached", async () => {
    // limit=200 but the repo only has 30 PRs → one short page ends it; no second fetch, no loop.
    const fetchMock = makePagedFetch([
      gqlPage(Array.from({ length: 30 }, (_, k) => prNode(k)), { hasNextPage: false, endCursor: null }, 30),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 200);
    expect(out.nodes).toHaveLength(30);
    expect(out.totalCount).toBe(30);
    expect(fetchMock).toHaveBeenCalledTimes(1); // stopped on the short page, didn't keep paging
  });

  it("stops on an EMPTY page (nodes:[]) even if the server lies that hasNextPage is true", async () => {
    // A defensive stop: an empty node array with hasNextPage:true would otherwise advance the cursor
    // forever (or until MAX_PAGES). The `pr.nodes.length === 0` guard breaks the loop.
    const fetchMock = makePagedFetch([
      gqlPage([prNode(0)], { hasNextPage: true, endCursor: "cur0" }, 5),
      gqlPage([], { hasNextPage: true, endCursor: "cur1" }, 5), // empty → break
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 50);
    expect(out.nodes).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // fetched the empty page once, then stopped
  });

  it("never paginates past MAX_PAGES even if the server always claims hasNextPage (no infinite loop)", async () => {
    // Every page returns a full 100 with hasNextPage:true forever. The MAX_PAGES=10 bound must cap it
    // at 10 calls / 1000 nodes, not spin. (limit huge so `nodes.length < target` never trips first.)
    let call = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url !== GQL) throw new Error(`unexpected fetch: ${url}`);
      readVars(init); // body is well-formed
      const base = call * 100;
      call++;
      return res(
        gqlPage(
          Array.from({ length: 100 }, (_, k) => prNode(base + k)),
          { hasNextPage: true, endCursor: `cur${call}` },
          100000,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 100000);
    expect(fetchMock).toHaveBeenCalledTimes(10); // MAX_PAGES
    expect(out.nodes).toHaveLength(1000); // 10 * 100, hard ceiling
  });

  it("an EMPTY repo (zero PRs) → totalCount 0 + empty nodes array, no crash", async () => {
    const fetchMock = makePagedFetch([
      gqlPage([], { hasNextPage: false, endCursor: null }, 0),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 40);
    expect(out.totalCount).toBe(0);
    expect(out.nodes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("data.repository === null (missing/denied repo) → break with empty result, not a throw", async () => {
    // GraphQL can resolve `data` with `repository:null` (repo not found / not visible to the token).
    // The function must break cleanly and return an empty result, never dereference null.
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== GQL) throw new Error(`unexpected fetch: ${url}`);
      return res({ data: { repository: null } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 40);
    expect(out).toEqual({ totalCount: 0, nodes: [] });
  });

  it("a NON-2xx mid-pagination (page 2 = 502) PROPAGATES — the scan fails loudly, not on a half-read window", async () => {
    // Page 1 is a full 100 with more to come; page 2 returns 502. githubGraphql throws on !res.ok, so
    // the whole fetch rejects rather than silently returning the first 100 as if complete.
    let call = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== GQL) throw new Error(`unexpected fetch: ${url}`);
      call++;
      if (call === 1) {
        return res(
          gqlPage(Array.from({ length: 100 }, (_, k) => prNode(k)), { hasNextPage: true, endCursor: "cur0" }, 500),
        );
      }
      return res({ message: "Bad Gateway" }, { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPullRequests("o", "r", "tok", 250)).rejects.toThrow(/502/);
    expect(fetchMock).toHaveBeenCalledTimes(2); // it did attempt page 2 before throwing
  });

  it("a GraphQL transport error with NO data (errors-only body) propagates the joined error message", async () => {
    // githubGraphql throws when `data` is absent, surfacing the errors[].message — the scan can't score
    // a window it never received.
    const fetchMock = vi.fn(async (url: string) => {
      if (url !== GQL) throw new Error(`unexpected fetch: ${url}`);
      return res({ errors: [{ message: "Something went wrong" }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchPullRequests("o", "r", "tok", 40)).rejects.toThrow(/Something went wrong/);
  });

  it("PARTIAL DATA (some PR nodes missing fields) survives summarization — malformed PRs are skipped/defaulted, never a crash", async () => {
    // GraphQL returns BOTH partial `data` AND `errors` when one node fails to resolve; githubGraphql
    // keeps the resolved nodes. Those nodes can carry malformed/absent fields. fetchPullRequests passes
    // them straight through (it doesn't validate), so the resilience contract is at the summarize step:
    // a missing author, a malformed/missing timestamp, or an empty reviews set must NOT throw — the bad
    // PR is just defaulted out of the velocity medians / authorship tallies.
    const malformed: PrNode[] = [
      prNode(1), // a clean baseline PR
      // author null (no login/__typename) — must not NPE on author?.login / __typename
      prNode(2, { author: null }),
      // garbage timestamps — hoursBetween returns null, so they're dropped from the medians, no NaN
      prNode(3, { createdAt: "not-a-date", mergedAt: "also-bad" }),
      // a review with a null submittedAt — the .filter((s): s is string => !!s) drops it
      prNode(4, { reviews: { totalCount: 1, nodes: [{ state: "COMMENTED", submittedAt: null }] } }),
    ];
    const fetchMock = makePagedFetch([
      gqlPage(malformed, { hasNextPage: false, endCursor: null }, 4),
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const out = await fetchPullRequests("o", "r", "tok", 40);
    expect(out.nodes).toHaveLength(4); // all 4 passed through unfiltered by the fetcher itself

    // The real resilience assertion: summarizePullRequests over the partial set does not throw and
    // produces finite, sane stats (no NaN leaking from the bad timestamps; the null-author PR counted).
    const stats = summarizePullRequests(out.nodes, out.totalCount);
    expect(stats.analyzed).toBe(4);
    expect(Number.isNaN(stats.avgReviews)).toBe(false);
    // medianHoursToMerge is computed only from the PRs with VALID createdAt+mergedAt (PRs 1, 2, 4 here;
    // PR 3's bad dates are dropped) — a number, never NaN, never throwing.
    expect(stats.medianHoursToMerge === null || Number.isFinite(stats.medianHoursToMerge)).toBe(true);
    expect(stats.medianHoursToFirstReview === null || Number.isFinite(stats.medianHoursToFirstReview)).toBe(true);
  });
});
