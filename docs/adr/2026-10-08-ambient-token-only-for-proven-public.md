# The server's own GitHub token never touches a repo not proven public

- **Status:** Accepted (2026-10-08, the day the code landed)
- **Date:** 2026-10-08
- **Deciders:** App Master `ascent`, through the lite council's round 1 on `private-repo-scan`
  (2026-10-07). **The operator did not take this decision in any source this author could read.** The
  evidence below is the commit messages and the code at head `8dea9372`.

## Constraint

The server's own `GITHUB_TOKEN` (the "ambient" PAT) can read repos the caller cannot. Any answer derived
from it, for a caller who has no right to the repo, is a leak or an existence oracle. With the GitHub App
configured, a private repo is read only through an installation token, but an owner with no installation
still gets the ambient PAT on the anonymous scan path, because public lookups need its rate-limit headroom:
unauthenticated GitHub allows 60 requests an hour (`src/lib/github/visibility.ts:3-6`). The council found
two leaks:

- **An existence oracle.** `lookupCachedScan` resolved the head with `process.env.GITHUB_TOKEN`
  unconditionally, so an anonymous `GET /api/scan?peek=1` at an installed owner's private repo returned
  `x-ascent-head-sha` for a repo that exists and nothing for one that does not (`5297a9c0`).
  `visibility.ts:7-8` adds that a `?ref=` resolve answered 204 where a missing repo got 404.
- **A cross-caller cache write.** For an owner with no installation, a private report read on the ambient PAT
  was re-tenanted in the database but still passed to `cacheSet`, and the memory tier then served it to
  every later anonymous scan or peek of that commit (`f65d647b`).

## Decision

**The ambient token is used only for a repo proven public. Anything that cannot be proven public runs with
no credential, so it answers like a missing repo.** Four rules:

1. **A report read on the ambient token is refused if the repo is private.** With the App configured, no
   explicit token and no injected source, a private ingest throws `NOT_FOUND` ("Repository not found or is
   private.", 404), the same error a missing repo raises. It fires right after ingest, before the memory
   mirror, any model call, and any persist (`src/lib/scan.ts:246-255`, `68b66e65`). This is the backstop: it
   fires after the PAT has already read the repo.
2. **The repo is proven public before the token touches it.** `guardAmbientToken` makes one conditional
   `GET /repos/{owner}/{repo}` with the ambient token and reads `private` from the body. `"public"` keeps the
   token. `"private"`, and everything else (404, rate limit, network error, malformed body), drops it for the
   rest of the request (`src/lib/github/visibility.ts:109-121`, `:56-60`, `:79-96`; `7b40b8ec`). Both scan
   routes call it where they compute the scope token, after their own throttles, so the check is itself
   rate-limited (`src/app/api/scan/route.ts:124`; `src/app/api/scan/stream/route.ts:131`; the stream route
   has a test for it in `8f1e23d3`). Documented in `2560e20a` and `66445d82`.
3. **The cache head lookup takes the caller's credential, never the ambient PAT.** `lookupCachedScan` has a
   required `token` (undefined for an unauthenticated lookup) and reads nothing from the environment
   (`src/lib/scan-cache.ts:119`, `:146`; `5297a9c0`). The lifecycle passes the same guarded credential it used
   for the scope resolve (`src/lib/scan-lifecycle.ts:212-218`).
4. **A private report never enters the shared anonymous cache.** `cacheAndPersistScan` skips `cacheSet` when
   `report.repo?.isPrivate === true` (`src/lib/scan-finalize.ts:179`; `f65d647b`). A backstop treats a private
   report found in the memory tier as a miss in `lookupCachedScan` and `lookupScopedScan`, which serve
   anonymous callers only (`src/lib/scan-cache.ts:81`). The flag is read optional-chained, so a report with
   no `repo` block is not proven private and caches as before (`37538eaa`). The durable persist under the
   owner's org is unchanged.

## Alternatives that lost

- **Never use the ambient token for anonymous callers.** Closes the class entirely. It lost because the
  anonymous public funnel depends on the PAT's rate limit: at 60 unauthenticated requests an hour it would
  stop working for ordinary public scans (`visibility.ts:5-6`).
- **Rely on the post-ingest refusal alone (rule 1).** Already shipped as `68b66e65`. It lost as the sole
  guard because it runs after the PAT has read the repo, so the peek headers, the `?ref=` resolve and the
  cache head lookup all answer before it. Only the pre-check makes those answer like a missing repo.
- **Gate on installation status alone** (use the PAT only when the owner has no installation). That is the
  population that is already exposed: an owner with no installation is exactly who reaches the PAT. It also
  misses a just-uninstalled App (`68b66e65`'s message).
- **Tag cached reports by tenant and filter on read, instead of not caching.** Would let a private report be
  cached for its owner. It lost because the memory tier is the shared anonymous tier. Skipping the write plus
  a read-side miss is a rule with no tenant-matching code that could be wrong.
- **Give the operator PAT public-only scope.** Would make the leak impossible at the source. This is a
  deployment choice that the code cannot verify or require, so the code does not assume it. (Whether a given
  PAT is so scoped is not visible in the tree.)

The reasons above are the author's reading of the code and the commit messages; no source states that these
alternatives were weighed. A later record may correct them.

## Consequences the team accepts

- **GitHub calls per scan.** When the guard runs (App configured, no token resolved, not already
  `noAmbientToken`, a parseable GitHub coordinate, an ambient token present: `visibility.ts:100-108`,
  `:114-117`), a cold scan costs **one extra REST call** (`:15-17`). The ETag of each answer is remembered in
  memory, so an unchanged repo revalidates as a **304, which GitHub does not bill against the rate limit**
  when authorized (`:15-17`). An active repo's ETag moves more often than its head does, because the body
  carries counters (`:17-18`). The memo is per process, capped at 1000 entries (`:28`), and lost on restart.
  A dropped entry costs one billed 200, never a wrong answer. Each call has a 10 s timeout (`:26`).
  Self-hosted installs without the App skip the check (`:117`).
- **A stranger sees the same answer for a private repo as for a missing one.** `NOT_FOUND` / 404, no head
  sha, no `?ref=` confirmation. A stranger can no longer tell the two apart. Neither can the owner, if the
  owner has no installation: they get "not found" for a repo they own until the App is installed.
- **Fails closed means fails slow for public repos too.** A rate-limited, timed-out or errored check returns
  `"unknown"`, which drops the token (`visibility.ts:79-96`). That public repo then runs unauthenticated,
  with a lower rate limit, or fails, until the check can be answered.
- **The shared anonymous cache cannot hold a private report**, so a second anonymous request for a private
  repo is never a cache hit.

## Citations to add in code (not done here)

`src/lib/github/visibility.ts` (header), `src/lib/scan.ts:246`, `src/lib/scan-cache.ts:81` and `:119`,
`src/lib/scan-finalize.ts:179`, and the guard calls at `src/app/api/scan/route.ts:124` and
`src/app/api/scan/stream/route.ts:131` should cite this file by name.
