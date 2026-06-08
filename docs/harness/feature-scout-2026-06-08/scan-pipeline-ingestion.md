# Feature Scout — Scan Pipeline & Ingestion

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Branch / ref selector for interactive web scans
- **Severity**: High
- **Category**: functionality
- **File**: src/components/ScanForm.tsx:57; src/app/api/scan/stream/route.ts:17; src/lib/scan.ts:39
- **Gap**: The ingestion core already fully supports scanning an arbitrary ref — `ScanOptions.ref` (scan.ts:39), `FetchOptions.ref` (source.ts:28), `encodeRef()` for `release/1.2`-style names, and the parallel pinned-ref fetch path (source.ts:368). But that power is reachable **only** by the internal PR-gate surfaces: `scanRepository(..., { ref })` is called from `api/app/webhook/route.ts:121` and `api/gate/[owner]/[repo]/route.ts:37`. The public `POST /api/scan`, `POST /api/scan/stream`, and `ScanForm` accept no `ref`/`branch` field, so a web user can only ever score the default branch — they cannot score `develop`, a release branch, or a feature branch.
- **User value**: Teams evaluating maturity on a long-lived `develop`/`staging` branch, or wanting to score a feature branch before merge, get a self-serve answer instead of needing the GitHub App + a PR. Removes the "default-branch only" ceiling for the most common power-user request.
- **Implementation sketch**: Add an optional `ref` to the stream/scan route body and thread it into the existing `scanRepository({ ref })`; add a compact branch input (or `owner/repo@ref` parse in `normalizeRepo`) to ScanForm. Extend `makeCacheKey` (cache.ts:51) with a ref segment so non-default refs don't collide with the default-branch entry.
- **Effort**: M

## 2. Surface "files inspected" and the coverage gap as evidence
- **Severity**: High
- **Category**: user_benefit
- **File**: src/components/report/ReportView.tsx:158; src/lib/github/source.ts:402; src/lib/types.ts:138
- **Gap**: Ingestion fetches a curated, budgeted set of file contents (`pickFilesToFetch`, source.ts:514) and computes `coverage` (source.ts:449), surfaced only as an opaque "confidence N%" chip (ReportView.tsx:158). The snapshot carries the full `files[]` list (types.ts:143) and the `tree`, but the report never tells the user *which* files actually informed the score, nor which high-signal files it looked for and **didn't** find. When confidence is low or the LLM disagrees, the user has no way to see what the engine read.
- **User value**: Trust + actionability. A skeptical engineer can confirm the scan read their real CI/test/AI-config files, and a low score becomes a concrete checklist ("we never found a CONTRIBUTING.md / eval harness") rather than a black-box number. Directly reinforces the product's "evidence behind every score" promise (page.tsx:107).
- **Implementation sketch**: Persist the inspected `files[].path` list (and `truncated`/`coverage`) onto the report, then render an "Inspected N files" expander in ReportView keyed off the existing `pickFilesToFetch` categories; flag the high-signal `exactNames` that were searched but absent.
- **Effort**: M

## 3. Expose GitHub rate-limit headroom and a token field on keyless scans
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/github/source.ts:256; src/app/api/scan/stream/route.ts:122
- **Gap**: `ghJson` reads `x-ratelimit-remaining` only to decide whether a 403 is a rate-limit error (source.ts:257) and otherwise discards it. A keyless scan that hits the limit returns a flat `RATE_LIMITED` error telling the user to "add a GITHUB_TOKEN" (source.ts:261) — but the public web UI (`ScanForm`) offers no way to supply one, even though `POST /api/scan` already accepts `token` in its body (route.ts:138). There's also no proactive headroom signal, so users discover the wall only by hitting it.
- **User value**: Power users scanning many repos in a session can paste a PAT to lift the limit instead of being blocked, and everyone gets an honest "limited — N scans left this hour" instead of an opaque failure. Turns a dead-end error into a recoverable path.
- **Implementation sketch**: Carry `x-ratelimit-remaining`/`reset` out of `ghJson` into the SSE error/progress payload; add an optional, session-only "GitHub token (optional)" disclosure to ScanForm that forwards to the route's existing `token` body field.
- **Effort**: S

## 4. Lockfile / dependency-manifest ingestion for richer supply-chain + stack signals
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/github/source.ts:534; src/lib/analyze/index.ts:42
- **Gap**: `pickFilesToFetch` grabs *manifests* (`package.json`, `pyproject.toml`, `go.mod`, etc., source.ts:534) but never their **lockfiles** (`package-lock.json`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum`). The D9 supply-chain detector (analyze/index.ts:514) and the practice-artifact builder therefore can't see pinned/unpinned dependencies, dependency count, or ecosystem depth. Several ecosystems are also unscanned for content (no `.nvmrc`, `.tool-versions`, `Makefile`, `taskfile.yml`, `.env.example`), so version-pinning and reproducible-environment signals are invisible.
- **User value**: More accurate D9 (security) and D6 (guardrails) scores, and the ability to flag unpinned/floating dependencies — a concrete, high-credibility maturity signal that competitors (Snyk, Socket) lead with. Benefits every scanned repo with no extra API cost (lockfiles come from the raw host).
- **Implementation sketch**: Add lockfile + environment-pin filenames to the `exactNames` pick list (they fit the existing raw-host fetch + `MAX_FILE_BYTES` truncation), then add lockfile-aware checks to the D9/D6 detectors using the already-indexed `RepoIndex.content()`.
- **Effort**: M

## 5. Stale-cache transparency + one-click "Re-test" affordance from a cached hit
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/lib/cache.ts:12; src/app/api/scan/stream/route.ts:78; src/components/report/ReportClient.tsx:54
- **Gap**: A cache/DB hit streams "Loaded from cache / a saved scan" (stream/route.ts:79) and renders instantly, but the report never shows *how old* the cached snapshot is — `report.scannedAt` exists (types.ts:324) yet the user can't tell a 30-second-old scan from a 14-minute-old one (TTL is 15 min, cache.ts:12). The `fresh=1` re-test flow exists in `ReportClient` (line 54) and a `ReportView onRetest` button is wired, but nothing on a *cached* render nudges the user that a re-test is available when the snapshot is near-stale.
- **User value**: Users who just pushed a commit understand why their score didn't move (served from the per-commit cache) and have an obvious "re-scan latest" path. Removes confusion around the otherwise-invisible cache.
- **Implementation sketch**: Render a relative "scanned 12 min ago · cached" line from the existing `report.scannedAt` and the `x-ascent-cache` header, with the already-built `onRetest`/`fresh=1` button promoted when the age exceeds a threshold.
- **Effort**: S

## 6. Configurable ingestion budget for large/monorepo repositories
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/github/source.ts:35; src/lib/scan.ts:222
- **Gap**: Ingestion budgets are hard-coded module constants — `MAX_FILES = 32`, `MAX_TOTAL_BYTES = 180_000`, `COMMIT_COUNT = 30` (source.ts:35-38) — and there is **no** way to scope a scan to a subdirectory. On a large monorepo, `estimateCoverage` (source.ts:624) drops and the scan emits a "could only inspect ~X%" warning (scan.ts:226), but the user can't do anything about it: they can't raise the budget, can't target `packages/api`, and can't re-run deeper. `pickFilesToFetch` samples globally, so a 12-package monorepo gets ~6 source files total across all of them. (Grep confirms no `subdir`/`path=`/`monorepo` parameter anywhere in the scan path.)
- **User value**: Monorepo and large-org users — exactly the high-value private-tier customers in the pricing model (page.tsx:205) — get a meaningful score instead of a low-confidence one. Sub-path scanning lets them score one service/team's slice precisely.
- **Implementation sketch**: Thread an optional `subPath` (prefix-filter `pickFilesToFetch` + the tree) and a `depth`/budget tier through `FetchOptions` → `ScanOptions`, keying the cache by sub-path; expose it on the private-tier scan path first since budget bumps cost more LLM tokens.
- **Effort**: L
