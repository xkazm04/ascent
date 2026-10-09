# Scan pipeline

The scan is Ascent's core engine. It takes a GitHub or GitLab repo URL, reads the repository over
the REST/GraphQL API (**no git clone**), extracts deterministic maturity signals across
**9 dimensions (D1–D9)**, asks an LLM to calibrate and explain, blends the two with
guardbanding, and returns a `ScanReport`: overall score (0–100), maturity level (L1–L5),
adoption/rigor axes, posture quadrant, evidence, strengths/risks, and a prioritized
roadmap. The whole thing runs in a stateless serverless function and is fully demoable
with **zero secrets** via the deterministic mock provider.

Orchestration lives in `src/lib/scan.ts:scanRepository`. The two HTTP entry points
(`/api/scan`, `/api/scan/stream`) are **protocol adapters** over one shared run sequence in
`src/lib/scan-lifecycle.ts` (coordinate, scope, head and cache lookup, cached return, coalesce,
classify, refund, cache and persist, salvage-on-failure); each owns only how it delivers the result
(a JSON body plus `x-ascent-*` headers, or SSE frames) and where its pre-scan gates sit. Everything
else here is pure, testable TypeScript.

## Entry points

### UI

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Landing scan box | `ScanForm` normalizes GitHub input (`owner/repo`, full URL, SSH) via `normalizeRepo()` and GitLab pastes (`https://gitlab.com/group/project`, `git@gitlab.com:…`, `gitlab:group/project`) via `parseGitlabUrl` (the same parser `scanRepository` already routes through `parseForgeUrl`) to `/report?repo=<normalized>` (`gitlab:group/project` for GitLab, subgroups kept whole). | `src/app/page.tsx`, `src/components/ScanForm.tsx`, `src/components/scan/normalizeScanRepo.ts` |
| Branch &amp; sub-path | A collapsed "Branch &amp; sub-path" disclosure under the scan box adds an optional git ref and monorepo sub-path, appended as `&ref=` / `&path=`. Pasting a `github.com/o/r/tree/<branch>` or GitLab `/-/tree/<branch>` link prefills the branch. See [Scan scope](#scan-scope-branch--sub-path). | `src/components/scan/ScanScopeFields.tsx` |
| Scan gallery | Curated/live examples on the landing page; live entries come from `getPublicScanGallery()`. | `src/components/landing/ScanGallery.tsx` |

The report page then drives the actual scan over the streaming endpoint; see
[report.md](../reporting/report.md).

### API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/scan` | `POST` (and `GET ?url=`) | Blocking scan. Returns a full `ScanReport` JSON. Handler: `runScan` in `src/app/api/scan/route.ts`. |
| `/api/scan/stream` | `POST` | Streaming scan over **Server-Sent Events** (progress + result). Handler: `src/app/api/scan/stream/route.ts`. |

**Request body** (shared shape):

```jsonc
{
  "url": "owner/repo | https://github.com/owner/repo | https://gitlab.com/group/project | gitlab:group/project",
  "token":          "optional GitHub token (private repos / PR signals)",
  "installationId": "optional GitHub App installation id",
  "mock":  true,    // force the deterministic provider
  "fresh": true,    // /api/scan only: skip the cached report, re-run
  "ref":     "develop",       // optional: score this branch/tag/commit, not the default branch
  "subPath": "packages/api"   // optional: aim the ingestion budget at this monorepo sub-tree
}
```

`ref` / `subPath` are also accepted on `GET /api/scan` as `?ref=` / `?path=` (which only reach a
real scan in `?mock=1` demo mode (`GET` is otherwise restricted to `peek=1`). Invalid values are
rejected **before** the quota block: `400 { code: "INVALID_REF" | "INVALID_SUBPATH" }`, and an
unresolvable ref is `404 { code: "REF_NOT_FOUND" }`, never a silent fall-back to the default branch.

`/api/scan` responses carry cache-provenance headers: `x-ascent-cache: hit | miss | hit-db`
and `x-ascent-dedup: hit | miss`.

Both routes reject an unparseable repo URL with `400 { code: "INVALID_URL" }` *before* any
quota is consumed, so a typo can never burn one of the free tier's monthly scan slots. (On
`/api/scan` this is checked after the cache-only `peek=1` probe, which keeps its cheap `204`.)

**Pre-scan gates, the same order on both routes** (`src/lib/scan-gates.ts`):

```
rate limit  →  sign-in wall  →  monthly quota                   →  credit reserve
   429            401              429 { code: "monthly_quota" }     402 INSUFFICIENT_CREDITS
                                                                     404 NOT_FOUND (missing org)
```

The **credit reserve** (`scanCreditGate`) is the last gate because it is the only one that mutates
an org's balance: every cheaper refusal is answered before a credit moves. It applies to a
**metered** scan only (private / installed-org, non-mock; `isMeteredScan`) and reserves one credit
*before* inference, then hands it back on every path that delivered nothing billable: cached hit,
coalesce join, degrade-to-mock, dedup, throw/abort. Public scans pay the monthly quota and never
reach it. Until 2026-09-05 this gate lived inline in `/api/scan` only, so `/api/scan/stream` (the
route the report UI drives) ran paid inference on private repos with no meter at all; both routes now
share the one gate. Both also answer `x-ascent-credits-remaining`: on `/api/scan` it is the
post-refund balance; on the SSE route the headers flush before `start()` can refund, so it is the
**pre-refund** figure (the same soft-header caveat the `x-ascent-quota-*` fields carry). The report
client renders the 402 as its own out-of-credits wall (see
[report.md](../reporting/report.md#failure-states-on-the-report-page-2026-09-05)). A missing org
(`orgExists: false` from `reserveScanCredit`) is `404 { code: "NOT_FOUND" }`, never that 402. A GitHub
network failure inside `ghJson` now crosses back as a fixed sentence; the raw error is logged server-side.

### The anonymous public scan is exempt from the sign-in wall

`scanAuthGate` walls a **private / installed-org** scan whenever `authGateEnabled()` is true, but an
**anonymous public** scan passes by default: the wall applies to it only when an operator opts back in
with `ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN=1`. That composed predicate is
`publicScanWallEnabled()` — `authGateEnabled() && publicScanSignInRequired()`, exported from
`src/lib/scan-gates.ts`.

The cost ceiling for the anonymous funnel does not depend on the flag: the shared burst limiter runs
before this gate and the rolling monthly free-scan quota runs after it, on this exact path either way.

**Every scan door reads that one predicate.** The three entry points a visitor can reach must agree
with the endpoint, because a wall painted on a door the server would have opened costs the vendor the
one visitor who used the front door and nobody else:

| Door | How it stays consistent |
| --- | --- |
| The landing hero's scan dialog (`src/app/page.tsx` → `ScanModal`) | The page computes `gated` from `publicScanWallEnabled()` server-side and passes it down. It renders the "Sign in to scan" panel **only** when the endpoint would answer `401`. |
| `/report?repo=…` (the scan form's destination) | No client-side predicate at all. It starts the scan and renders whatever the server answers — `auth_required` → `SignInNotice`, `monthly_quota` → `QuotaBlocked`. |
| `/report/{owner}/{repo}` cold permalink (`ColdScanGate`) | No wall; an explicit **Scan now** button so a shared permalink never auto-starts a multi-minute scan nobody asked for. Says "free for public repositories and needs no account". |

Pinned by `src/lib/scan-gates.wall-consistency.test.ts`, which drives the predicate and the gate across
the whole env matrix and asserts they never disagree. When the dialog is open (the default), the
`QuotaMeter` and the derived duration sentence render with it — both work signed-out (`/api/quota`
reports `scope: "anon"`), so an anonymous visitor is told the real allowance and the real wait
**before** committing a scan.

A caller who trips more than one gate gets the **first** one, so a throttled anonymous caller sees
`429` with `Retry-After` on **both** routes, not `401` on one and `429` on the other, which is what
they returned before the orders were unified. Rate limit wins the tie because it is the truthful
answer (the shared scan budget is exhausted regardless of who is asking) and signing in would not
lift it. The limiter also always precedes the quota counter, so a throttled request never burns a
free monthly slot, and it records a `rate_limit` quota event on both routes.

The two routes differ only in *where* that sequence sits: `/api/scan` runs it **after** its free
cache-hit / `peek=1` / salvage returns, so hydrating a saved report stays unthrottled and free even
while the burst budget is exhausted; `/api/scan/stream` runs it at the top of the handler, since
reaching the stream already means a real scan. One deliberate exception: on `/api/scan` a
**private/installation** scan's sign-in wall still runs before the limiter (moving it later would let
an unauthenticated caller drive a GitHub ref resolve against a private repo), so an anonymous caller
passing `installationId` while throttled gets `401` there and `429` on the stream.

Everything *after* the gates is one sequence, not two that agree by inspection: `runScanLifecycle` in
`src/lib/scan-lifecycle.ts` owns the run and takes each route's gate placement as the one declared
slot between the free cached return and the scan. That closed three divergences the two hand-kept
copies had already accumulated: the live SSE path parsed **GitHub** coordinates only (so every
`gitlab:group/project` the scan form emits died at a `400` on the one path `/report` drives), it had
no error salvage, and a coalesce joiner handed back the credit on one route and only the quota on the
other. The refund ledger is now a single object naming the five no-delivery situations
(`onCacheHit`, `onJoin`, `onDegrade`, `onDedup`, `onFailure`); its table is asserted in
`src/lib/scan-lifecycle.test.ts` and, route by route, in `src/app/api/scan/gate-order.test.ts`.

A **private** report is also re-tenanted under the repo owner's org before persistence on both
entry points now, not on the JSON one only: a scan can read a private repo while the resolved org is
still the shared `public` funnel (a body token, or, on a deployment without the App, the ambient
operator PAT), and persisting that under `public` would publish it to every anonymous visitor.
`scans-persist.ts` still refuses the write as the backstop.

### The peek contract, and how a private repo is answered (2026-10-08)

`GET /api/scan?peek=1` is the cache-only probe the `/report` page runs before opening a live scan.
It never scans and never consumes quota; it has its own per-IP limiter (`PEEK_RATE_LIMIT`, `429`).

| Request | Answer |
| --- | --- |
| `peek=1`, cached report at the current head | `200` + the report, `x-ascent-cache: hit` / `hit-db` |
| `peek=1`, no cached report | `204`, with `x-ascent-head-sha` / `x-ascent-head-etag` when the head resolved |
| `&recent=1` | also serves the last persisted **public** report within the cache-age window: `200`, `x-ascent-cache: hit-recent`, `x-ascent-stale: true` |
| `&latest=1` | the last persisted **public** report at any age (the quota-wall salvage): `200`, `x-ascent-stale: true` |
| `&ref=` / `&path=` (scoped) | bad input `400`, unresolvable ref `404 REF_NOT_FOUND`, otherwise a bare `204` (a ref that is the default head is an ordinary peek) |

**A private repo answers exactly like a missing one**, on the peek and on the live scan, unless the
caller holds an installation token for it. With the App configured, an owner with no installation
reaches GitHub on the server's own `GITHUB_TOKEN`, which can usually read private repos. Before that
token touches anything, `guardAmbientToken` (`src/lib/github/visibility.ts`) makes one conditional
`GET /repos/{owner}/{repo}` with it and reads `private`. A repo proven public keeps the token (public
lookups need its rate limit; unauthenticated GitHub allows 60 an hour). A private repo, or any answer
that cannot prove public (404, rate limit, network error), sets `noAmbientToken` for the rest of the
request: the ref resolve, the head lookup, the peek headers and the ingest all run with no
credential, so GitHub answers `404` for the private repo just as it does for a missing one. The peek
is then a bare `204` and a `?ref=` is `404 REF_NOT_FOUND` for both. Both routes call the guard where
they compute the scope token, after their own limiters (the peek limiter, the stream's burst limiter).

Cost for a public repo: one extra REST call cold, and a `304` warm (the ETag is remembered in memory
per instance; GitHub does not bill an authorized `304`). The repo body carries counters such as
`pushed_at`, so an active repo revalidates as a billed `200` more often than a quiet one. Callers
holding a token (an installation token, a body token), callers already refused the PAT, and
deployments without the App make no extra call. The ingest's own private-repo refusal (below, in
`runScanRepository`) stays as the backstop.

### What a private scan stores (2026-10-08)

A private repo's report is **stored without any text copied out of its files**. The report handed
back to the caller who ran the scan is the full one; only what is written changes. The rule is one
pure function, `storableScanReport` in `src/lib/private-scan-store.ts`, and `persistScanReport`
writes every `Scan` and `Repository` column from its output. For `repo.isPrivate === true`:

| Store | Kept | Dropped |
| --- | --- | --- |
| `ScanDimension.evidence` | every analyzer line; a cited-claim line's facet, points and path(s) | the verbatim quote (up to 200 chars) after each path |
| `guidanceGraphJson` (Scan + Repository) | nodes (path, vendor, bytes, pointers), canonical, projection states, coherence, penalties, the contradiction count, kind and paths | rule lines, literal commands, contradiction quotes (stored as `…`), rule subjects (numbered instead) |
| `manifestJson` (Scan + Repository) | capability names and their verified / placeholder / wiredAt facts, control placement, declared paths, agent entrypoints, `neverTouch` paths | capability commands, `repo.purpose`, `secretsFrom`, raw `generatedFrom` placeholders, parse notes that quote the file |

A public report passes through untouched. The `.ai/memory` mirror refuses a private repo at its own
gate (see [memory.md](../org-knowledge/memory.md)). The LLM-written prose (summary, strengths, gaps,
headline, risks) is model-authored, not a copy channel: the prompt asks for a verbatim quote only in
`claims`, which is the evidence line above.

**A local working copy is exempt** (operator decision 2026-10-08). `LocalFsSource` stamps its meta
`isPrivate: true` **and** `forge: "local"`, and `storableScanReport` returns a `forge: "local"`
report unchanged, so local and loop-lane scans keep their quotes, guidance graph and manifest (the loop
brief in `src/lib/db/lane-brief-read.ts` reads them). The marker is set at the source and never
inferred from the url, which is a github.com url for a working copy. `isPrivate` stays true, so the
mirror gate stays closed for local scans. Local mode exists only on self-hosted deployments.

**Section headings are kept.** `Scan.practiceShape` (`src/lib/analyze/practice-shape.ts`) stores the
heading outline (never the prose under it) of a private repo's guidance files, pull request template
and decision records, for practice matching. The operator's decision (2026-10-08) was to keep them and
say so; the [privacy page](../../../src/app/privacy/page.tsx) states it. The model-written commentary
(headline, strengths, risks, dimension summaries and gaps, roadmap notes) is stored and is disclosed on
/privacy (operator decision, 2026-10-09).

**Rows written before 2026-10-08: the scrub.** `src/lib/db/private-scan-scrub.ts` rewrites the same
columns of every `Repository.isPrivate` repo through the same transforms, and deletes the repo's
`RepoMemoryMirror` rows (through retention's `eraseRepoMemoryMirrorByRepo`) and the `repo-memory`
`OrgMemory` rows the mirror fed, citations first. It writes a value only when the transform changes
it, lists values that do not parse, never moves `Repository.updatedAt`, `lastScanAt` or
`scannedAt`, lists (never touches) `OrgMemory` rows linked to a deleted row by `supersededBy`, and
records one `data.private-scan-scrubbed` audit row per org it changed. A second run changes nothing.
Run it dry first, then apply:

```sh
npx vite-node --config vitest.config.js scripts/scrub-private-scan-content.mts            # dry run: host, then per-column counts
npx vite-node --config vitest.config.js scripts/scrub-private-scan-content.mts --apply    # writes; add --org <slug> for one org
```

`--apply` is **refused on a self-hosted deployment** (`selfHosted()`): a stored row does not record
whether a local or a GitHub scan wrote it, so the scrub cannot leave the exempt local rows alone.
Managed cloud has no local rows.

**SSE protocol** (`/api/scan/stream`): named events on the stream:

- `progress`: `{ stage, message, pct, provider?, region?, fallback? }` where `stage` ∈
  `fetch | tree | files | analyze | score | compose | done`.
- `persisted`: `{ ok: boolean }`, emitted **before** `result`. `ok` is true only when this
  scan is in the durable store (new row or commit dedup). The live-scan page rewrites
  `/report?repo=` to `/report/{owner}/{repo}` only then — a persist miss (DB off, scoped,
  degraded/low-coverage) leaves the job URL in the address bar so a reload cannot unfurl a
  cold permalink as a scored report. See [report.md](../reporting/report.md).
- `result`: the final `ScanReport`.
- `stale`: `{ fallback: "error" }`, emitted **before** a salvaged `result`. The live scan failed
  (transient upstream / LLM / rate limit) and the repo's most recent persisted public report is being
  served instead of a dead end, mirroring `/api/scan`'s `x-ascent-stale` + `x-ascent-fallback=error`
  headers. Never on a client abort, never on a scoped scan, and never a private snapshot: the
  lifecycle decides, so the two entry points cannot disagree. "Re-test" still forces a re-score.
- `joined`: `{ message }`, emitted the moment this connection ATTACHED to a run already under way
  instead of starting one, followed by the `progress` frame that moves the bar off 0%. Two frames on
  purpose: `joined` is the contract the client branches on to render its restored-work line, so the
  copy can change without silently switching that UI off. Reachable from a plain RELOAD since the
  linger window landed (see "Rejoining a live scan" below), not only from a second concurrent tab.
- `error`: `{ error, code? }`.
- A `: ping` comment is emitted every ~15s so idle proxies don't drop the connection.
  The stream respects client disconnect via an `AbortSignal`, cancelling in-flight fetches.

### The notify opt-in does not detach the run

**A scan is owned by the HTTP request, and the "email me the report link" opt-in does not change
that.** `request.signal` is threaded into `runScan`, the disconnect catch refunds the quota slot and
any credit reservation, and the completion email is dispatched inside `start()` after the result
frame. So closing the tab mid-scan yields no report, no persisted row and no email. The linger window
(see "Rejoining a live scan") buys a reload a few seconds to come back; it is not a detached run.

This is a **deliberate cost ceiling**, not an oversight: a run nobody is watching would keep spending
GitHub rate limit and LLM budget. A detachable run was designed as a real change (a keeper-owned entry
in `coalesceScan`, finalization handed to `after()` as the GitHub webhook path already does, re-attach
over the existing coalesce join) and **rejected on 2026-10-05** in favour of keeping the ceiling and
making the UI stop implying otherwise. `NotifyToggle` now states the tab-open requirement, and
`NotifyToggle.dom.test.tsx` pins the honest wording while forbidding the old promise.

If that trade is revisited, the card, its seven acceptance cases and its premise anchors are in
`.claude/scan-history/challenge-2026-10-05-cards.json`.

## Pipeline stages

`scanRepository` sequences four stages and emits progress between them.

### 1. Ingest (`src/lib/github/source.ts`)

`GitHubPublicSource.fetchSnapshot()` parses the URL (`parseRepoUrl`) and builds a
`RepoSnapshot`:

- `meta: RepoMeta`: owner, name, stars, forks, language, default branch, **head SHA**.
- `tree: RepoFile[]`: the full recursive git tree (`git/trees?recursive=1`, one call).
- `files: FetchedFile[]`: a **budgeted sample** (≤ 50 files + a reserved quota of ≤ 24 CI
  workflows, plus GitLab CI and the root Jenkins, CircleCI, Azure, Travis, Bitbucket and lefthook
  configs, ≤ 14 KB each, 60 KB for CODEOWNERS, ≤ 280 KB total) chosen by
  `pickFilesToFetch`: agent-guidance files, manifests, configs, CI workflows, tests, and a
  sample of source. Public repos read from `raw.githubusercontent.com`; private repos use the
  Contents API. The budget is a **fixed constant, deliberately**: it is what makes two repos'
  scores comparable, so it is not request-configurable (see [Known gaps](#known-gaps)).
  GitHub, GitLab, and local excerpts use UTF-8 byte counts and end on complete characters;
  each fetched file's `bytes` records its original UTF-8 size before truncation.
- `commits: CommitInfo[]`: up to 30 recent commits (message, author, login, date).
- `truncated`, `coverage`: flags that drive confidence + warnings.

Ingest accepts an optional `ref` (branch/tag/SHA) so the pipeline can score a **PR head**
instead of the default branch; this is what the [gate](./gate.md) and the App webhook use,
and what the public scan form's branch selector drives (below).

#### Ingest from a worktree (`src/lib/local/source.ts`)

`LocalFsSource` is the self-hosted twin: same `pickFilesToFetch`, same caps, reading a paired
working copy (or a loop worktree) from disk. One difference is deliberate and load-bearing. The
GitHub source reserves workflows a *file-count* quota by appending them after the 50-slot list; a
sequential disk read that stops at the 280 KB budget never reached them on a worktree with enough
large samples, so the loop's rescan scored "0/1 workflows" against a before-scan that had read all
of them and D9 fell forty points with no repository change. `readPicksWithReserve` now reads the
**reserved class** first and exempts it from the byte budget (still capped per file):
`.github/workflows/*`, `.github/dependabot.yml` / `renovate*`, `SECURITY.md`, everything under
`.ai/`, `CLAUDE.md`, `AGENTS.md`. The rest fill the remaining budget in pick order and the result is
restored to pick order, so the prompt window is unchanged for the files it was going to read anyway.
Test: `source.reserve.test.ts`.

**The GitHub byte budget is a plan, not a race (2026-09-05, rubric `r17`).** `fetchSnapshot` used to
spend `MAX_TOTAL_BYTES` inside the 8-wide fetch pool with an optimistic per-file claim reconciled
after each await, so which picks were displaced depended on network timing. `planFetchBudget` now
walks the picks in `fetchRank` order and admits each while `planned + min(listed blob size,
per-file cap) <= MAX_TOTAL_BYTES`, closing admission at the first pick that does not fit; only the
admitted set is fetched (through the shared `mapPool`). The set a scan reads is a pure function of
(tree, picks, budget): re-scanning the same commit reads the same files and produces the same score.
Displaced picks are disclosed through coverage as their own term (`attempted / (attempted +
displaced)`), the same depression they always caused, now reproducible. The GitLab source, whose
tree carries no sizes, reaches the same guarantee by deciding admission in strict pick order from a
single consumer (at most seven in-flight reads beyond the cut). See the `r17` entry in
[maturity-model.md](maturity-model.md#6-rubric-versioning-scoring_rubric_version) for why this is a
rubric bump.

The other half of worktree comparability is D9's GitHub-only inputs (branch protection, installed
Apps, org policy): an observed scan records them on `platformSignals.securityInputs`, a worktree
rescan re-runs the battery with them and discloses the carry on each check, and with nothing to
carry `computeSecurityChecks` **excludes** a check whose 0 only GitHub could refute instead of
scoring it (`platformUnobservable`). `attributeDimension("D9", …)` refuses a GitHub end against a
blind worktree end as `unmeasured`. Details in
[the loop's platform fold](../org-planning/live.md#platform-signals-carried-into-a-worktree-rescan).

## Scan scope (branch &amp; sub-path)

An interactive scan can target something other than "the whole repo at its default-branch head":

| Input | Effect |
| --- | --- |
| `ref` | Ingest a branch, tag or commit instead of the default branch. |
| `subPath` | Spend the per-file content budget on one sub-tree of a monorepo. |

**Sub-path is a budget re-aim, not a filter.** The tree, commit history and every repo-level
enrichment (PR stats, governance, security posture/exposure) stay repo-wide, and repo-wide files
(root README/manifests, `CODEOWNERS`, `SECURITY.md`, and **every CI workflow**) are still read, so
the deterministic batteries that depend on them (notably D9's workflow battery) don't go blind. Only
the docs/test/source *sample* slots are scoped, plus the sub-tree's own manifests, which take prompt
priority over the root's. Prefix matching is exact-segment: `packages/api` never sweeps in
`packages/api-client`.

Three invariants hold, and are unit-tested (`src/lib/scan-scope.test.ts`,
`src/lib/scan-scope-cache.test.ts`, `src/lib/scan-scope-server.test.ts`):

1. **Identity.** The ref is resolved **server-side** to its own 40-char commit SHA
   (`resolveRefSha`), and that SHA keys the cache, never the default branch's head. A sub-path adds
   an explicit `!path:<dir>` key segment, because it reads a different file set at the *same* commit.
   So a ref/sub-path entry can neither collide with nor be served to a whole-repo reader.
2. **Subject.** A scoped report is **never persisted**. The corpus (leaderboard, `/report`'s
   "latest", org rollups, the regression-alert baseline) reads a repo's most recent persisted row, so
   saving a branch or single-package score would silently redefine what the repo scores. The scoped
   report is stamped with a warning saying it isn't comparable and wasn't saved, the completion email
   is suppressed (its permalink wouldn't resolve), and the peek / error-salvage paths return `204`
   rather than a whole-repo report.
3. **Trust.** Because it never enters the corpus, a client-supplied ref can't get a flattering
   cherry-picked commit scored, saved and later served as the repo's public reading, the same attack
   `/api/scan/stream` refuses a client-supplied `headSha` for.

A ref that resolves to the **default branch's head** is not scoped: same commit, same tree, same
score, so `?ref=main` keeps full cache reuse and normal persistence.

Definitions live in `src/lib/scan-scope.ts` (pure, shared with the form) and
`src/lib/scan-scope-server.ts` (validation + resolution, shared by both routes).

### 2. Analyze (`src/lib/analyze/index.ts`)

`analyzeSignals()` runs the **9 deterministic detectors** (one per dimension), each
returning a `DimensionSignals { id, signalScore (0–100), signals[], notes? }`. Detectors
are wrapped individually in try/catch: a pathological file fails *one* dimension to a
zero score plus a warning, never the whole scan.

| Dim | Name | What it detects (deterministically) |
| --- | --- | --- |
| D1 | AI Tooling & Conventions | Quality + presence of machine-readable agent guidance (CLAUDE.md, AGENTS.md, .cursorrules…): commands, architecture, constraints, MCP/hooks, examples |
| D2 | Automated Testing | Test file count, test:source ratio, frameworks, e2e, coverage config, advanced rigor (mutation, contract, perf, a11y) |
| D3 | CI/CD & Delivery | Pipelines + stages, release automation, IaC, policy-as-code, GitOps, progressive delivery, migrations |
| D4 | Agentic Workflows | AI code-review agents, LLM-in-CI, auto-fix/auto-PR bots, dependency automation |
| D5 | Documentation & Knowledge | README depth, `/docs`, ADRs, CONTRIBUTING, CHANGELOG, API docs, examples |
| D6 | Code Quality & Guardrails | Linters, formatters, strict types, pre-commit hooks, CODEOWNERS, commitlint — plus **enforcement**: guardrails run inline in CI, a quality ratchet / debt ceiling, a zero-warning lint gate (see [D6: presence vs enforcement](#d6-presence-vs-enforcement)) |
| D7 | Commit & Velocity Signals | AI-attributed commits, conventional commits, cadence, recency |
| D8 | AI Process & Harness | Evals/golden tests, prompt/agent library, runbooks, AI contribution process |
| D9 | Supply Chain & Security | SAST, SCA, secret/container scanning, SBOM, signing, SECURITY.md, threat models |

#### D6: presence vs enforcement

D6 grades two different things, and the difference is load-bearing. **Presence** signals ask whether a
tool is installed — `Linter configured` (20), `Formatter configured` (10), `TypeScript strict mode`
(20) / `TypeScript configured` (10) / `Static type checking (mypy/pyright)` (15), `Pre-commit hooks`
(15), `CODEOWNERS` (15), `Commit linting / conventions` (10), `PR template` (5). **Enforcement**
signals ask whether it *operates* — the same "installed vs operating" distinction the assessment
prompt already insists on for the model:

| Signal | Points | What it reads |
| --- | --- | --- |
| `Lint/format/type-check enforced in CI` (or `... in a git hook`) | 20 (or **+5** when a standalone linter config already scored) | lint/format/type commands in a CI config (`idx.enforcementMatch`): `.github/workflows/**` first, then `.gitlab-ci.yml` / `.gitlab/ci/*`, a root `Jenkinsfile`, `.circleci/config.yml`, `azure-pipelines.yml`, `.travis.yml`, `bitbucket-pipelines.yml`; else `lefthook.yml`, which earns the same points under the *git hook* label (`r20`) |
| `Quality ratchet / debt ceiling enforced` | 15 | a ratchet/ceiling/budget/`no-new-*`/suppression/baseline artifact: a **parsed `package.json` script** entry, a checked-in baseline (`.betterer.*`, `eslint-baseline.json`, `*-ceiling.json`, `knip.json`), or the same terms in any of those CI or hook configs (cited by file off Actions) |
| `Lint/type gate fails on warnings (zero-warning policy)` | 5 | `--max-warnings 0`, `-D warnings`, `--deny warnings`, `--error-on-warnings`… in any of those CI or hook configs or a parsed script body |

**Why the ratchet signal exists.** Measured over a 21-run campaign (2026-08): two repos gained ESLint
import-boundary rules, a blocking ruff ignore-ceiling ratchet, a blocking TypeScript suppression
ratchet, exception lists and several gates wired into `check:ci` — and D6 moved 66 → 68 on one and
81 → 81 on the other. Every artifact mapped onto a presence signal **already awarded** (the linter
config the repo already had), and the ratchets — the only artifacts that actually block a build —
mapped onto no signal at all. A repo can carry an `.eslintrc` for years while its warning count
climbs; a ceiling that fails `check:ci` cannot.

Scripts are **parsed** out of `package.json` (`packageScripts`), never regexed out of the manifest
blob: a dependency named `@acme/budget-ratchet-ui` is not a gate, and a script entry is runnable by
construction. An unparseable manifest yields no scripts rather than a guess.

#### Evidence has to be checkable

A signal is `{ label, detail? }` and renders as `label (detail)`. UAT `SAM-L1-01` (2026-08-10)
recorded the evidence lines as **unsourced labels** — an instant-trust-failure — because a presence
check (`RepoIndex.has`) computed which path matched and then discarded it, leaving the reader to
re-derive the regex by hand.

`RepoIndex.first(...res)` returns that path, and the presence signals cite it: *"Found CLAUDE.md
(Claude Code guidance) (docs/claude.md)"*. The **quality** claims about a guidance file cite the file
they were read from, since the claim is about that file's contents.

**A workflow-body signal cites the WORKFLOW FILE.** `RepoIndex.workflowMatch(re)` is `first()`'s twin
for the other trigger: workflow bodies are kept per file (`workflowFiles`) as well as concatenated
(`workflowText`), so *"CI runs tests"* names `.github/workflows/main.yml` rather than the blob. This
is exact, not plausible — it names the file the matching line was actually read from. UAT `SAM-L1-01`
recurrence 2 (2026-08-30) reframed the gap this way: the LLM narrative above the evidence list already
cited the workflow paths, so *the deterministic detectors were lagging the model*, not the UI.

**A signal fired by MANIFEST text stays unsourced, deliberately.** Several detectors match a path, a
workflow body, *or* the manifest blob. A dependency named in `package.json` is not a standalone
config a reader can open, so no detail is attached — naming a plausible file would be a fabrication in
the one place the product is asking to be trusted. `evidence-source.test.ts` pins both directions.

Covered: D1 (all presence + quality signals, plus the `.ai/` manifest awards), D2's
framework/e2e/coverage config, **all of D3** (the CI presence path, the named workflow list, the
tests/lint/build jobs, release/deploy, IaC and the delivery-as-code cluster), D5's document set, D6's
linter/formatter/tsconfig configs and the CI guardrail's workflow, **all of D8** (eval harness, prompt
library, runbooks/ADRs, contribution process, issue templates, `.ai/doctor.mjs` + the file that wires
it, and the memory entries), and D9's SAST / SCA / SECURITY.md / threat-model.

Still bare, and each for a stated reason rather than by omission: D9's text-only checks (the same
manifest-blob case above); D2's assertion-substance sample, whose `detail` is a measurement rather than
a path and is deliberately left untouched (guardrail **G6**); and the count/ratio signals, whose detail
is already a number.

The same pass also computes `classifyArchetype()` (**solo / team / org**, selects the
weighting lens later), `detectAiUsage()` (AI-commit fraction, tracked separately from the
score), and `computeContributors()`.

Two **token-gated** enrichments run alongside the detectors and fold into dimensions:

- `src/lib/analyze/pulls.ts:fetchPrStats`: recent PR stats over GraphQL (merge/review
  rates, time-to-merge, AI-involved/AI-governed rates, tool taxonomy). Folds into D6/D7/D8.
  `PR_QUERY` fetches each PR's title/body/labels/reviews **plus (W2) the merge-commit
  message, the PR's last ≤15 commit messages, and `__typename` on review authors**: the
  inputs for trailer attribution and AI pre-review below.
  AI involvement is detected through **three channels** (one shared predicate,
  `readAiInvolvement`, precedence `authored > marked > trailer`):
  `authored`: an AI agent bot opened the PR; `marked`: AI fingerprints in
  title/body/labels; `trailer` (W2): a **merged** PR whose merge-commit or PR-commit
  messages carry an AI attribution trailer (`Co-Authored-By:` / `Assisted-By:` naming a
  tool, the squash-merge case the self-declared markers structurally miss). The trailer
  vocabulary is shared with the commit-level detector via `ai-tools.ts:AI_TRAILER_SOURCE`.
  Two merged-PR-denominated rates land in `PrStats` behind the same ≥5-sample floor as
  their siblings (null below it, never a fabricated 0): `aiTrailerRate` (share of merged
  PRs carrying a trailer, precedence-independent) and `aiPreReviewedRate` (share of merged
  PRs an AI/bot reviewer (`ai-tools.ts:AI_REVIEW_BOTS`: CodeRabbit, Copilot code review,
  Greptile, …) reviewed **before the first human review**). Per-channel counts
  (`aiAuthoredPrs`/`aiMarkedPrs`/`aiTrailerPrs`) sum to the AI-involved population.
  **Revert linkage (W5, `pulls.ts:linkReverts`)** matches merged revert PRs to the merged
  PRs they roll back, entirely within the fetched window (zero extra API calls): by title
  (`Revert "<original title>"`, with a merged-before-the-revert chronology guard) and by
  message (`This reverts commit <sha>` in the revert's body / commit messages, resolved
  prefix-tolerantly against the targets' merge-commit + PR-commit SHAs; `PR_QUERY` fetches
  `oid` alongside each commit message for this). Two more rates ride the same floors:
  `reworkRate` (share of merged PRs later reverted; ≥5 merged) and `aiReworkRate` (the same
  over AI-involved merged PRs; additionally ≥5 AI-involved merged). Both are **lower
  bounds**: a renamed revert, or a revert merged outside the window, escapes the matcher,
  and are documented as "at least this share", never a census.
  The same call also returns `aiChanges`, the **AI-change population** (`extractAiChanges`):
  one evidence row per AI-attributed PR carrying the author, how it was identified
  (`authored` by an agent, `marked` by a human, or `trailer` from commit messages), the
  tools named, and **who approved it and when**. Same shared predicate as the rates, so the
  row count always reconciles with `aiInvolvedRate`. Persisted (never scored) as `AiChange`;
  costs no extra GitHub calls: the PR nodes were already fetched and previously discarded.
  `approved: false` with a null approver is the finding an auditor is looking for, and
  `reviewCount` distinguishes it from "never reviewed at all". W5 adds a revert stamp to
  each row (`revertedByPr`/`revertedAt`, from the same `linkReverts` pass as the rates, so
  the stamped population always reconciles with `aiReworkRate`); null means "no revert
  matched in the window", never "was never reverted".
- `src/lib/github/governance.ts:fetchBranchGovernance`: branch protection + rulesets.
  Folds into D6/D3/D8. `fetchCommitActivity` adds 52-week commit history.
- `src/lib/github/check-suites.ts:fetchAppInventory` (deepening pass, r7): the **installed-App
  inventory**, read from the check suites posted on the *scored commit*
  (`GET /repos/{o}/{r}/commits/{sha}/check-suites`, one page, deduped by `app.slug`). This is the
  Settings-configured tooling a file scan structurally cannot see: default-setup CodeQL posts as
  `github-code-scanning`, org-installed Socket/Snyk/Wiz/GitGuardian, Codecov, the Claude /
  CodeRabbit / Greptile review Apps, Vercel/Netlify, Azure Pipelines/CircleCI/Buildkite. Public
  repos answer an ordinary token; private repos ride the App's existing **Checks: read**.
  `classifyApp` maps a slug to a conservative category (`ai-review · sast · supply-chain ·
  coverage · ci · deploy · observability · actions · other`); an unknown slug earns nothing.
  Folds ADDITIVELY into D2/D3/D4 (`analyze/platform-signals.ts:applyAppInventorySignals`) and
  into the D9 battery (`security/checks.ts`, SAST + dependency-updates). Null = "not observable"
  (anonymous scan / read failed) and never means "no Apps"; an empty list on a 200 is a real zero.
  **PR heads (2026-09-24):** the same read also runs on up to 3 recent merged PR head commits
  (`PR_HEAD_INVENTORY_CAP`), taken from the PR page ingestion already fetched
  (`analyze/pulls.ts:recentPrHeadShas`, the last node of `commits(last:15)`, so no list call; no
  PR page means no extra read). The at most 3 extra calls run concurrently once the PR page lands.
  Apps seen only there land in `prHeadApps` (with `prHeadShas`, and `prHeadTruncated` when a head
  read failed or was truncated), beside the scored commit's `apps`. Since r22 they are credited
  for the PR-gate categories only (AI review, coverage, code scanning, supply-chain) with the same
  award as on the scored commit, once per capability (`check-suites.ts:prHeadAppsOf`); a CI or
  deploy App seen only on a PR head earns nothing. See the r22 row in
  [`maturity-model.md`](maturity-model.md). A failed head read never marks the sensor failed and
  never removes credit.
- `src/lib/github/actions-health.ts:fetchCiHealth` (deepening pass, r7): **default-branch CI
  health** from the last 50 non-PR Actions runs (`GET /repos/{o}/{r}/actions/runs?branch=…&
  exclude_pull_requests=true`): success rate over completed runs with a verdict (cancelled /
  skipped / neutral / stale / action_required leave the sample), median duration, distinct
  workflows, and the workflows whose *most recent* run is red. Public repos answer an ordinary
  token; private repos need the optional **Actions: read** App permission, otherwise null. Folds
  additively into D3 (`applyCiHealthSignals`: +8 at ≥90% green, +4 at 75–89%, a named "red" line
  with no penalty below; `sampled < 5` is evidence only, `sampled: 0` says nothing). The
  penalty-free shape is deliberate: an anonymous scan cannot observe runs, and a token-gated
  penalty would make the same repo score lower the more it lets Ascent see.
- `applyPrSignals` (deepening pass, r7) now also folds the already-computed `aiPreReviewedRate`
  into **D4**: `min(20, rate × 0.4)`, capped at 8 when a review bot is configured in committed
  files (behavioural confirmation, not a second discovery).

Both `applyPrSignals` and `applyGovernanceSignals` (`pulls.ts`) skip a dimension outright
when `signals.failed` is set: a crashed detector's placeholder `signalScore: 0` is never
blended with real PR/governance evidence or decorated with evidence text that would make a
non-measurement look like a real, evidenced score.

D2's "sampled tests assert nothing" −15 penalty (a high case count with zero substantive
assertions in the content-sampled slice) only fires when the sampled test files cover at
least `MIN_SAMPLE_FRACTION` (0.3) of the repo's *total* detected test files (by path, not
just the ≤32-file content-ingest budget). Below that fraction the penalty downgrades to a
neutral, non-scoring note: a small, unlucky slice of a large suite can't indict the whole
suite as untested.

### 3. Score with the LLM (`src/lib/scoring/prompt.ts` + a provider)

`buildAssessmentPrompt()` renders a compact prompt: the rubric (levels + dimensions), the
deterministic signal block, the sampled file contents, and a commit sample. The selected
`LLMProvider.assess()` returns an `LlmAssessment`: per-dimension score + summary +
strengths/gaps, an overall headline, cross-cutting strengths/risks, an invitational
`roadmap`, and `discrepancies` (signals the LLM thinks the detectors got wrong).

**Summary format (r6, 2026-08-17).** A dimension summary is asked for as *markdown-lite* — 2-4
short paragraphs or `- ` bullets, `**bold**` for the one finding not to miss, `` `code` `` for
files/commands — never one paragraph. `MarkdownLite` (`src/components/report/MarkdownLite.tsx`)
renders exactly those four constructs and nothing else (no links, no HTML: the text describes
untrusted repository content), and a marker-free legacy summary renders as one paragraph as
before. Gaps and evidence render as lists.

**Follow-up guarantee (r6).** Every dimension scoring below `FOLLOW_UP_BELOW` (65, the L4 floor —
the first green band) carries at least one roadmap entry naming it. The prompt asks for it
(*ROADMAP COVERAGE*); `buildDimensionFollowUps` (`recommendations.ts`) enforces it after
assembly, appending an entry per uncovered below-green dimension — titled with the dimension's
own first gap when the model gave one, else the catalog template — lowest score first, after the
model's own entries. Before this, 3-5 roadmap entries over nine dimensions left most mediocre
dimensions with an empty "Next steps", which the drill-in read as "not a current gap".

**Craft entries and the craft ladder (r12, 2026-08-30).** Every dimension **at or above** the floor
with no gap entry gets one `kind: "craft"` roadmap entry — what would make it exemplary — and each
one names a `craftAxis`: `architecture` · `performance` · `robustness` · `design` · `security-depth`
· `dx` (`src/lib/scoring/craft.ts`), persisted on `Recommendation.craftAxis`. Two prompt rules make
the entries a *ladder* rather than the same suggestion re-answered every scan:

- the stable TASK block requires the axis, requires the entry to name **the artefact it would leave
  behind**, forbids a rung two steps above a missing one, and at or above `GREEN_MIN_SCORE` (85)
  shifts the voice from "adopt the practice" to *raise the ceiling* (a performance budget that fails
  rather than another measurement, a chaos drill rather than another retry, an architecture-decay
  check, a dependency-freshness SLO, design/API ergonomics);
- a per-repo **`CRAFT ALREADY BUILT`** block lists the rungs the repository has completed with their
  axis and instructs the model to propose the *next* one ("a k6 smoke baseline exists → the next rung
  is a budget that fails CI, not another smoke test"). It is fed by `getCraftBuilt` from the same
  read path that supplies `orgDecisions`, rendered into the **user** message only — never the cached
  SYSTEM prefix — and `neutralize`d exactly like the standing-decisions block.

Craft entries get their own roadmap budget (6 gaps + 6 craft) so gaps cannot starve the ladder, and
`buildDimensionFollowUps` counts only **gap** entries as coverage, so a stray craft entry on a
below-green dimension can never suppress the follow-up that dimension is guaranteed. A craft entry
never touches a score or the fleet's debt; since r12 it *is* dispatchable by the loop's craft lane.
Full mechanics — the ledger, the resolve rule, the debt exclusions — in
[maturity-model.md §4d](./maturity-model.md#4d-the-craft-ladder--craft-becomes-dispatchable-work-r12-2026-08-30).

**Ranking includes effort (2026-08-20).** The fallback roadmap ranks by `weight × headroom ×
effort`, where effort discounts the weighted upside by 10% per ordinal (low ×1.0, medium ×0.9,
high ×0.8, off the shared `IMPACT_RANK`). Effort was previously displayed but absent from the
ordering, so the first thing a team was told to do could be the most expensive item on the board.
The discount is deliberately gentle: it only reorders gaps already within ~20% of each other, so a
dominant high-effort gap still leads.

**Framing lint (2026-08-20).** The invitational-framing rules — an observation not an imperative,
no supervisory voice, a title that does not contradict its own rationale — are checked
deterministically by `lintRoadmapFraming` (`recommendations.ts`) on every roadmap that passes
through `buildDimensionFollowUps`, model-written and synthesised entries alike. Violations are
reported (`console.warn`) and the entry ships **unchanged**: rejecting on phrasing would lose an
evidence-grounded finding to the fallback template, and rewriting it would put words in the model's
mouth that no longer match the evidence it cited. No model judges the model here.

If the LLM fails or returns an unusable result (`isAssessmentUsable()` requires ≥ 50% of
dimensions), `scanRepository` automatically falls back to `MockProvider` and adds a
warning. Provider selection and the abstraction are documented in
[llm-providers.md](./llm-providers.md).

### Outcome counters (`src/lib/scan-outcome.ts`)

The `Scan` table holds **successes only**: there is no status column, and a run that throws
persists nothing. `scanRepository` therefore wraps the pipeline in four best-effort `QuotaEvent`
tallies so a failure is not invisible:

| Kind | Meaning |
| --- | --- |
| `scan_started` | Every attempt: the raw denominator. |
| `scan_rejected` | User-side and correctly handled: bad URL, private/missing repo, empty repo, client disconnect. |
| `scan_failed` | The pipeline itself: GitHub rate-limit, upstream 4xx/5xx, unhandled throw. |
| `scan_degraded` | Fell back to the mock floor: a report rendered *without* the model. |

The error rate is `scan_failed / (scan_started − scan_rejected)`: folding rejections into the
numerator would make the metric track funnel traffic rather than reliability. Read it back via
`scanPipelineErrorRate()` in [`src/lib/db/kpi-metrics.ts`](../../../src/lib/db/kpi-metrics.ts).
These are running all-time totals, not a time series, so the rate is a lifetime figure.

### 4. Blend, roll up & compose (`src/lib/scoring/engine.ts`)

`assembleReport()` produces the final `ScanReport`:

- **Per-dimension blend**: the LLM score is guardbanded to within `LLM_GUARDBAND` (±6 since
  the `r8` rubric — sized below the narrowest maturity band so the model cannot move a level)
  of the signal score, then blended: `final = SCORE_BLEND·guarded + (1−SCORE_BLEND)·signal`
  with `SCORE_BLEND = 0.6` (60% LLM / 40% deterministic). This keeps the LLM honest while
  still letting it add nuance.
- **Overall**: a renormalized, archetype-weighted mean of the dimensions
  (`levelForScore()` maps it to L1–L5).
- **Two axes**: `adoptionScore` (D1, D4, D7) and `rigorScore` (D2, D3, D5, D6, D8, D9),
  combined into a **posture quadrant** at the 50-point threshold: *AI-Native*,
  *Ungoverned*, *Solid but Manual*, *Getting Started* (`postureFor`).
- **Warnings**: appended for no token (PR signals skipped), LLM fallback, truncated
  tree, low coverage (< 50%), or a detector error.

#### Provenance: which engine produced the score, and what moved it

Three facts travel with every persisted scan so a run-over-run delta can be *attributed* rather than
assumed (see [the loop's attribution rule](../org-planning/live.md#is-this-lift-real-the-attribution-rule)):

| Field | Column | Says |
| --- | --- | --- |
| `engine.provider` / `engine.model` | `engineProvider`, `engineModel` | which engine answered |
| `engine.degraded` | `engineDegraded` | an LLM **was requested and never answered**, so the provider above is the deterministic *floor*, not a choice |
| `report.scoreIntegrity` | `scoreIntegrityJson` | the levers that can move a headline on an **unchanged** commit: `d9Unmeasurable`, `widenedDims`, `widenCapped`, `unmeasuredDims`, `effectiveBlend` |
| `report.platformSignals` | `platformSignalsJson` | what this scan could see of **GitHub** — `observed`, `carried` (from which scan, how old, `stale`), or `unavailable` |
| `headSha` | `headSha` | the commit this scan pinned to — the **only** base evidence a scan carries, and what lets the loop refuse a pair whose two ends were taken on divergent trees ([incomparable bases](../org-planning/live.md#a-pair-that-crosses-a-base-change-is-not-comparable-2026-08-31)). Nullable: a sha-less scan makes the base question `unknown`, which refuses nothing. There is **no branch column** on a `Scan`, and the base rule does not invent one. |

The fourth row is the one a *worktree* scan needs. D2/D3/D4 are credited partly for tooling that is
**installed rather than committed** — review/CI/coverage Apps posting check suites, default-branch
Actions health (`src/lib/analyze/platform-signals.ts`) — and a scan reading a local filesystem cannot
observe any of it. `applyPlatformSignals` therefore records what the fold was worth (points +
evidence, per dimension); a later local scan **replays** that record with its provenance and age on
every line (`src/lib/analyze/platform-carry.ts`, stale past `PLATFORM_FOLD_STALE_DAYS` = 14), and when
there is nothing to replay the record says `unavailable` — which excludes those three dimensions from
the green verdict instead of scoring them at a floor the repository cannot raise. The same record
carries D9's GitHub-side battery inputs (`securityInputs`) so the security score is on one ruler on
both ends of a loop pair. See
[the loop's platform fold](../org-planning/live.md#platform-signals-carried-into-a-worktree-rescan).

### Unobservable is not failing

A blind worktree rescan can measure everything a file scan can see — guidance, tests, configs, docs,
conventions, history, the D9 checks whose evidence is committed. What it cannot measure is the half of
D2/D3/D4 that is *installed rather than committed*, and with nothing to carry it has no reading of
those dimensions at all.

`dimensionObservability(record, dimId)` (`src/lib/analyze/platform-carry.ts`) is the single rule for
which of the two a dimension is in: `observed`, `carried` (replayed from an earlier observed scan —
still a measurement, and disclosed as a borrowed one), or `unobservable` (the fold was unavailable
*and* nothing was carried). Every dimension outside the folds is `observed`, because the file scan
reads it as well locally as it does through GitHub, and an *unknown* record is `observed` too: a
legacy row is not evidence of blindness.

The consequence is stated once and applied everywhere: **unmeasured is not the same as bad, so it must
not be turned into work.** An unobservable dimension is excluded from the green verdict
(`repoGreenness`), is owed **no** manufactured roadmap coverage entry (`buildDimensionFollowUps` — a
gap the *model* raised from evidence it could see still stands), and is not armed by the loop
(`openBatch`). It is never silent about it: the list is recorded on `scoreIntegrity.unmeasuredDims`
and the report header's integrity chip prints `D2, D3, D4 not measured`, so a low number there reads
as missing evidence rather than as a finding. **No score moves** — D4 keeps whatever it computes; what
changes is what becomes work. See
[the loop does not arm what it cannot verify](../org-planning/live.md#the-loop-does-not-arm-what-it-cannot-verify-2026-08-30).

**D9 with nothing to grade is not measured, not 0 (2026-10-05).** The one dimension outside the folds
a reading can fail to see entirely. On a blind reading (no GitHub side, nothing carried) the battery
excludes SAST, dependency updates and security policy unless their evidence is committed, and a repo
with no `.github/workflows` and no container files has every other check n/a too. The posture mean
then had no denominator and fell to 0, and the overall carried that 0 as a measured absence (three
real local scans, all D9 = 0). Now `computeSecurityChecks` returns `unmeasured: true` in exactly that
case (blind, no CI- or container-derived check, exposure unknown — a committed `SECURITY.md` or update
config alone does not count, because with every refutable check excluded it would be the whole
denominator and one file would read D9 100), `buildScanScoreInput` withholds the battery's number from
the prompt, stamps
`securityUnobservable` on the platform record, and `dimensionObservability(record, "D9")` answers
`unobservable`. Because the record is the persisted answer, everything that reads the rule sees it:
the engine drops D9 and renormalizes the overall (named on `scoreIntegrity.unmeasuredDims`, so the
integrity chip reads `D2, D3, D4, D9 not measured`), no D9 roadmap row survives from the model or
the fallback, and `openBatch` will not arm one. The on-disk absences the blind reading withheld (no
committed `SECURITY.md`, no Dependabot/Renovate config) come back as **unverified** notes in the
engine's D9 warning, never as gaps. A scan that could see GitHub, or a blind one with any gradable
CI or container file (one workflow, one Dockerfile), is measured exactly as before.

### A failed sensor read is unknown, never zero (2026-09-05)

The token-gated enrichments (branch governance, security posture, dependency exposure, the
installed-App inventory, CI health, deployments) each degrade to the same `null` / `[]` a
successful-but-empty read produces. Until 2026-09-05 only the PR sensor recorded the difference
(`prFetchFailed`); a failed posture read on a repo whose org has a `SECURITY.md` persisted score 0,
"No security policy found" and a remediation for a control the repo has, and a failed governance
read silently dropped the D3/D6/D8 credit. Now `ingestRepository` records every sensor whose read
threw on `IngestPhaseResult.sensorFailures` (typed `ScanSensorId[]`, carried on
`ScanReport.sensorFailures`), and:

- `buildScanWarnings` emits **one** caveat naming the failed reads in reader words ("GitHub signal
  reads FAILED during this scan (…), so the signals they feed are missing - this reflects failed
  reads, not controls the repository lacks"). It persists through `warningsJson` like every other
  caveat, and the typed list persists beside it (see the last bullet).
- D9 checks whose only GitHub-side refutation came from a failed sensor (security policy from
  posture; SAST and dependency updates from the App inventory) return `score: null` with evidence
  "not observable: <sensor> read failed" and are **excluded** from the blend, through the same
  `githubCanRefuteZero` path a structurally blind scan already uses. A sensor that ran and found
  nothing scores exactly as before.
- **`fetchSecurityExposure` lets lockfile/OSV read failures throw.** It checks npm, pnpm and Cargo
  lockfiles in that order and queries OSV with `npm` or `crates.io` ecosystems. If none has a
  parseable dependency, exposure is `known:false` = UNKNOWN (neutral, never "clean"). A
  non-404 GitHub lockfile status, an OSV `querybatch` that is not ok, a network blip, or a
  parse error **throws**, so ingest records `securityExposure` on `sensorFailures` and degrades
  the value to `null`. Until this, those failures were swallowed into the same UNKNOWN a missing
  lockfile produces, so the scan published "no lockfile / no alert access" for a read that did
  not run (G4: a failed read is not empty findings).
- **`fetchSecurityPosture` rejects on a failed read** (r25). A network error or timeout, an
  advisory status other than 200/404, a malformed 200 body, or an org-policy probe that threw or
  answered other than 200/404 with no path answering 200 all reject, so ingest records
  `securityPosture` on `sensorFailures` and the security-policy check is `score: null`. A 404 stays a
  real zero / false. Until this the function resolved `null` on every failure and D9 published a
  false "No security policy" 0.
- **The display-only enrichments use the same recorder** (2026-10-07). Commit activity, guidance
  freshness and the PR-head App inventory used a bare `.catch(() => null)`, which the module's own
  comment forbids. Their failures now go through `sensorFailed` and are logged. They do **not** join
  `sensorFailures` (no caveat, no score change): their degraded value is already a typed unknown
  (no activity chart, per-file freshness unknown, `prHeadTruncated`), not an absence the scorer
  reads as "none".

### Every failed read in the scan span reaches a door (2026-10-07)

Two council rounds each found a catch that turned a failed read into a successful answer and told
nobody. Round 2 found the next sibling of round 1's defect, so the whole span (the four
context-map contexts the council reviews) was swept for the shape. Every catch site is in one of
three classes:

- **The failure becomes a visible state.** On the report permalink, a failed read renders
  `PermalinkReadError` or "couldn't load", or it leaves a prop unresolved so the client fetch takes
  over. It is reported with `reportFailedRead` (`src/lib/scan-read-door.ts`). See
  [report.md](../reporting/report.md#cold-permalink-coldscangate--coldscanteaser).
- **A best-effort degrade keeps its value and gains a door.** These are the cache tiers (a thrown
  persisted read is a cache miss), the regression baseline, the latest-public-report salvage, org
  decisions and craft for the prompt (an empty list is *omitted* from the prompt, never sent as "none"),
  the alert side paths, the OSV per-vuln severity (counted `high`), the landing gallery, and
  persisted-JSON parsers that read a corrupt blob as "not assessed". Server code reports through
  `degradeTo` / `reportDegradedRead`, which log plus `reportHandledError`. Pure and client modules,
  which cannot import `respond.ts`, log with `console.warn`.
- **Legitimately silent, with a one-line reason.** These are a request-body parse that then answers
  400, an SSE controller or reader that is already closed, browser storage, a best-effort telemetry
  tally, an unreadable error-response body that still lands in the error state, and a scanned repo's
  own malformed `package.json`, which is a fact about the repo and not a failed read.

`src/lib/scan-silent-catch.guard.test.ts` holds the line. It derives the span from
`context-map.json` and parses each source with the TypeScript compiler, so comments and strings cannot
satisfy it. It then fails on any silent catch that is not on its allowlist, which records a reason
for each entry. A silent catch is one of three shapes: `.catch(() => null | [] | {} | false |
undefined | EMPTY_*)`, an empty `catch {}`, or a `catch { return … }` with no door.
- Governance and platform folds are not given partial credit; the caveat is the record. An absent
  `platformSignals` record **plus** `appInventory`/`ciHealth` in `sensorFailures` means
  *unmeasured*; an absent record with nothing listed means the scan looked and measured nothing.
- `fetchDeployments` now accepts the scan's abort signal and joins the enrichment `Promise.all`
  (its loop stays sequential for the secondary rate limit); the two score-input DB reads run in
  parallel (measured on a modelled fixture: 268 ms → 134 ms); the outcome counters no longer block
  the hot path. The ingest emits "Reading GitHub signals…" at 52 before the enrichment await and
  "Analyzing signals…" at 62 after it, so the UI no longer claims to analyze during GitHub I/O.
- **The typed list survives persistence (2026-09-24).** `scanRepository` now stamps
  `report.sensorFailures` on every scan (`[]` when nothing threw), and `persistScanReport` writes it
  to the nullable `Scan.sensorFailuresJson` column. `getScanReportByCommit` reads it back, so a
  DB-tier gate hit (`lookupPersistedScanByCommit`, after the in-memory cache expires or on another
  instance) still skips a bar whose read failed with "read FAILED" and still carries the gate caveat
  naming it, instead of reading the null as "not read". A row written before the column (NULL, or
  unparseable) leaves `sensorFailures` absent on the rebuilt report: unknown, never `[]`. Tests:
  `src/lib/db/scan-sensor-failures.test.ts`, and the `sensorFailures` cases in
  `scans-persist.test.ts` / `scans-read.test.ts`.

**Keyless skips are not failures.** With no token the token-gated sensors are never asked; `IngestPhaseResult.sensorSkips` records which (only those the forge can answer), is not persisted, and feeds the D9 battery (checks only GitHub could refute are excluded, not scored 0) and the keyless warning, which names the skipped org-policy and App-inventory reads.

`engineProvider = "mock"` cannot carry the second on its own: it is also what a keyless deploy and an
explicit `?mock=1` demo look like, and neither of those is a failure. All three are nullable — a row
written before the columns is **unknown**, which is deliberately not the same value as "not degraded"
/ "nothing widened" / "unavailable", and the readers keep it `undefined` rather than defaulting it.
That asymmetry is load-bearing for the last row: `unavailable` *removes dimensions from a verdict*,
and no historical row is entitled to make that claim.

### App Readiness Passport & autonomy tier (`src/lib/analyze/passport*.ts`)

`scan-compose.ts` also attaches `report.passport = buildPassport(report, snapshot)`, a pure,
deterministic, display/persist-only projection (never fed back to the prompt or the score). Passport
**0.3.0** added two structured artifact booleans and a derived autonomy verdict:

- **`artifacts.sandbox`**: a committed, reproducible environment definition: `.devcontainer/` /
  `devcontainer.json`, `Dockerfile`, `docker-compose`/`compose` files, `flake.nix`/`shell.nix`/
  `default.nix`, or `.tool-versions` (tree-index presence).
- **`artifacts.hooks`**: guardrail hooks: `.husky/`, `lefthook.*`, `.pre-commit-config.*`, or a
  `"hooks"` block in `.claude/settings.json`; the settings file counts **only when its content was
  fetched** (presence alone proves nothing about hooks).
- **`autonomy`** (`src/lib/analyze/passport-autonomy.ts`): the per-repo autonomy tier: "what can
  you safely hand an agent in this repo?" A cumulative T0→T3 ladder:
  - **T0 observe-only**: the default.
  - **T1 tests/docs/refactors**: agent instructions committed + a one-command `test` script +
    `tests.level ≥ partial`.
  - **T2 features with review**: T1 + `ci.level ≥ gated` + `tests.level ≥ substantial` +
    (`hooks` OR `sandbox`).
  - **T3 scheduled autonomous**: T2 + `aiInWorkflow` + `evals ≠ none` + versioned migrations.

  Each unmet predicate emits a human-readable `missing` string in `autonomy.unlocks` (cumulative per
  tier, the checklist that unblocks it), and `autonomy.inputs` records the raw predicates so the
  grant is auditable. **Token honesty**: a tokenless scan (`governance` null) caps the grant at T1
  and names the limitation in `missing`. **Migration honesty**: `upgradePassport` (applied read-time
  via `parsePassportJson`) derives tiers for stored pre-0.3.0
  rows *without* a rescan, but leaves `sandbox`/`hooks` absent (unknown, never a fabricated false);
  the T2 checklist then names the re-scan instead of a missing artifact.

Passport **0.4.0** (`PASSPORT_VERSION`; design doc `APP_READINESS_PASSPORT.md` §2e-§2g) ends four
places where one slot carried two facts:

- **Findings carry a minted id.** `automationReadiness.findings[]` / `productionReadiness.findings[]`
  each hold `{ id, code, text, severity }` — `id` is the axis-scoped CAUSE (`prod.zero-observability`),
  `code` the same without its axis, `text` the rendered sentence *as of this generation*, and
  `severity` one of `info | warn | block | critical`. `blockers[]` is unchanged and is now simply
  `findings.map(f => f.text)`, so every pre-0.4.0 reader keeps working. Everything that persists a
  *judgment* — an owner's decline, the fleet Pareto bucket — joins on `id`/`code`; before this it
  joined on the prose, so a copy edit silently orphaned declines and split rollup buckets. `critical`
  is never emitted by a scan: it is what a `block` finding *becomes* under the owner's
  criticality/lifecycle escalation in the overlay.
- **Three-valued named fields.** `stack.monitoring.*` and `stack.hosting` distinguish a vendor name
  (observed) from `null` (the scan looked; the app has none) from `"unknown"` (the evidence was
  outside the snapshot). Consumers deriving a rung go through `isNamed()` — a truthiness test reads
  `"unknown"` as a vendor. Unclassifiable monitoring emits `prod.observability-unassessable` (`info`,
  an evidence limitation) instead of `prod.zero-observability` (`block`, a real gap).
- **Per-field evidence.** `evidence.fields[path]` rates the named/heuristic fields on four fixed
  rungs — `observed` 1.0, `declared` 0.8, `inferred` 0.5, `unobserved` 0 — keyed by the same dotted
  paths `declined[]` uses. Deliberately non-exhaustive; a reader prefers `fields[path]` and falls back
  to the whole-artifact `evidence.confidence` when the path is absent.
- **A decline expires.** `passport-overlay.ts` re-surfaces an accepted gap — the blocker **stays** in
  `blockers[]` and the `declined[]` entry gains `needsReconfirm` + `reconfirmReason` — on exactly
  three triggers: the finding's `code` changed, its (escalated) `severity` outranks the stored one, or
  `at` is more than `DECLINE_MAX_AGE_DAYS` (**365**) before `generatedAt`. Never on a rewording. A
  pre-0.4.0 decline carries no `code`/`severity` baseline; that absence reads as **unknown** and skips
  those two comparisons rather than fabricating either answer.

**Render surface** (`src/features/standing/passports/`): `PassportsTab` copies `findings` and
`declined` onto each `PassportRow.detail`; `PassportRowDetail` lists the accepted gaps beside — never
inside — the open blockers, flagging a re-surfaced one as needing re-confirmation (it appears in both
lists on purpose); and `PassportBlockerPareto` draws `declinedRepos` as hollow marks with their own
count, because `aggregateBlockers` deliberately stopped subtracting declines from a bucket and the
display must not put that subtraction back.

### Context Health (`src/lib/analyze/context-health.ts`) — W4

`scan-compose.ts` also attaches `report.contextHealth = deriveContextHealth(…)`, the
quality-over-presence read of the repo's agent-context layer (CLAUDE.md / AGENTS.md /
`.cursorrules` / Copilot instructions). Like `passport` it is **display/persist-only** (`techStack`
was too until r21, which sends it to the prompt by default):
it never feeds the score or the LLM prompt (pinned by the "stays display-only" test in
`context-health.test.ts`); folding it into D1 later is a deliberate `SCORING_RUBRIC_VERSION` event.

- **Ingest cost**: at most **3 extra REST calls per scan**: `pickGuidanceFiles` selects ≤3
  guidance files from the already-fetched tree (root-first, CLAUDE.md > AGENTS.md > rules files) and
  `fetchGuidanceFreshness` (`src/lib/github/source.ts`) asks
  `GET /repos/{o}/{r}/commits?path=<file>&per_page=1&sha=<ref>` for each, the file's last-modified
  date + last-commit SHA. Works **keylessly** within rate limits; the promise overlaps the LLM stage
  (awaited at compose time, like commit activity). File **size in bytes** comes free from the tree.
- **Degrade, never fail**: any per-file lookup failure (rate limit, timeout, empty history) yields
  a `path`-only entry that derives as *freshness unknown* (`freshness.score: null`); the composite
  renormalizes over quality+drift. A scan is never failed or a date fabricated for this signal.
- **Staleness is approximate by design**: `commitsSinceEdit` is read off the scan's weekly
  `commitActivity` buckets since the guidance's last edit (partial week pro-rated), flagged
  `approximate: true` always and `windowCapped` (a lower bound) when the edit predates the ~12-week
  window. Tokenless scans have no activity blob → age is reported, potency stays unknown.
- **Quality** reuses `guidanceQuality()` (the D1 content grader, exported from
  `src/lib/analyze/index.ts`) normalized to 0..100; the two surfaces can't disagree about what
  good guidance means.
- **Drift**: `@file`-style path references in the guidance are extracted and checked against the
  tree index (zero extra fetches); a **dead ref** (guidance pointing at a deleted file) is the
  measurable drift signal.
  The score uses the full dead-reference count (`deadRefsTotal`), while `deadRefs` keeps at most
  12 examples. Older stored scans lack the exact count; their example list is only a lower bound.
  On read, malformed nested fields or inconsistent counts make the blob unassessed, preserving
  the existing re-scan recovery instead of passing unreadable measurements into fleet views.
- **Shape**: `ContextHealth { version, present, files[{path, lastModifiedAt?, lastCommitSha?,
  bytes?, sectionsScore}], freshness{score|null, ageDays, commitsSinceEdit, approximate,
  windowCapped?}, quality{score, signals}, drift{score, refsTotal, deadRefsTotal?, deadRefs}, score }`. Persisted as
  `Scan.contextHealthJson`, latest cached on `Repository.contextHealthJson`
  ([data-model.md](../data/data-model.md)); surfaced as the Repositories tab's Half-life panel
  ([org-intelligence.md](../org-dashboard/org-intelligence.md)).

## Maturity model (`src/lib/maturity/model.ts`)

The model file is configuration, not logic: a single source of truth for levels,
dimensions, weights, and the scoring constants.

**Levels** (`LEVELS`): L1 Manual `[0–24]` · L2 Assisted `[25–44]` · L3 Augmented
`[45–64]` · L4 Integrated `[65–84]` · L5 Autonomous `[85–100]`.

**Archetype weighting** (`ARCHETYPE_WEIGHTS`): each archetype (`solo`/`team`/`org`)
defines a full set of D1–D9 weights summing to 1 (validated by `weightsAreValid()` outside
prod). The *org* lens (default) leans on D1/D2/D3/D8; *solo* leans on D1/D2/D6. Forecasting
helpers (`src/lib/maturity/forecast.ts`) project a maturity trend line and ETA to the next
level, used by the org [Trajectory](../org-dashboard/org-intelligence.md).

## Caching (`src/lib/cache.ts`, `src/lib/scan-cache.ts`)

Two tiers, keyed by `owner/repo@sha[!scope]::{llm|mock}#fp` (`makeCacheKey`), where `#fp` fingerprints
the {provider, model, rubric} scoring identity and the optional `!scope` segment carries a sub-path
(see [Scan scope](#scan-scope-branch--sub-path)):

1. **In-memory LRU** (`src/lib/cache.ts`): 100 entries, 15-min TTL, plus a separate
   `HeadHint` LRU (ETag + SHA, 6-hr TTL) for cheap conditional head requests.
2. **Persistent** (`src/lib/scan-cache.ts:lookupCachedScan`): shared by both scan routes.
   It resolves the current head with a conditional request (`304 Not Modified` → free,
   unchanged) using the credential its **caller** resolved and nothing from the environment: a
   `noAmbientToken` scan or peek (an anonymous caller at an installed owner, or any repo the
   ambient-token guard could not prove public) resolves it as nobody, so `GET /api/scan?peek=1`
   answers a private repo exactly like a missing one, with no `x-ascent-head-sha` on either (see
   [the peek contract](#the-peek-contract-and-how-a-private-repo-is-answered-2026-10-08)). It then looks up the in-memory tier, then the DB
   (`getScanReportByCommit`), then falls through to a fresh scan. `fresh=true` skips the
   cached *report* but still resolves the key/ETag.

Both tiers apply the same **max cache age** (`SCAN_MAX_CACHE_AGE_DAYS`, default 7; set 0 to
disable): a report older than the gate is a miss and re-scans even when the head hasn't moved.
Blank, invalid, negative or overflowing overrides use the seven-day default; disabling the gate
requires an explicit zero.
The memory TTL bounds how long an *entry* lives; the age gate bounds how old the *report*
inside it may be, so a DB hit that warms memory can't keep serving a report past the gate.

This makes re-scans of an unchanged commit instant and dodges GitHub rate limits.

The in-memory tier is the **shared anonymous** cache, so a private report never enters it:
`cacheAndPersistScan` skips `cacheSet` when `repo.isPrivate` is true (a private repo can still reach
the anonymous path through a caller-supplied body token, or through the ambient operator PAT on a
deployment without the App), and both lookups treat a private report found there as a miss.

**Coalescing.** Concurrent scans of the same uncached commit share ONE run
(`coalesceScan`): the first caller computes, later callers join and await the same result
(their quota slot is refunded; metering is on commit, not attempt). A joined SSE caller
receives the *same* live progress frames as the computing owner: it gets a "joining a scan
already in progress" frame, then a replay of the latest frame, then every subsequent one, so
a shared scan never looks stalled to the second viewer. Abort is refcounted: the shared run is
cancelled only when the last interested caller disconnects.
A request arriving after that cancellation starts a new computation even if the old promise is
still settling; the old run cannot evict the replacement when its cleanup finishes.

### Rejoining a live scan (a reload does not pay for the scan twice)

A reload closes the old SSE connection **strictly before** the new request opens, so the coalescer's
refcount always passes through zero. That used to abort the shared run at that instant, which made the
join path above unreachable from a reload: refresh `/report?repo=` four minutes into a six-minute scan
and the whole run was discarded, then started again from zero. At the measured `claude-cli` median
(360s) that is six more minutes of wall clock and a second inference bill for a page refresh.

Two halves close it.

**Server: a bounded linger window.** When the last waiter releases, `coalesceScan` no longer aborts; it
schedules the abort `INFLIGHT_LINGER_MS` (**30s**, `src/lib/cache.ts`) later and leaves the entry
joinable. A connection arriving inside the window cancels that timer and attaches to the run, is
replayed the latest progress frame, and receives every frame after it. The window **always closes**: on
expiry the run is aborted *and evicted*, so `inflightScanCount()` returns to zero and an abandoned tab
cannot leak a six-minute scan. 30s is deliberately short for that reason - it covers a reload plus a
slow page load and nothing longer. Setting the constant to 0 restores the old synchronous abort exactly.

**Client: a resume anchor.** `src/components/report/scanResume.ts` keeps one `sessionStorage` slot
naming the scan subject this tab started (repo, `fresh`, `ref`, `subPath` - a ref or a sub-path is a
*different* scan, so it never matches) plus its real start time. TTL is `scanClientTimeoutMs()`: past
the client's own give-up horizon there is nothing left to rejoin. A storage accessor that throws
(private mode, blocked site data) reads as *no anchor*, so the degrade is an ordinary cold load.
`useReportScan` writes the anchor at scan start, and on remount with a live anchor it **skips the cache
peek** (which cannot hit - nothing is persisted mid-scan) and POSTs the stream directly. The anchor is
cleared the moment the scan settles, success or failure, so the next visit cannot claim a rejoin of a
run that no longer exists.

**What the user sees.** The `joined` frame sets `resumed`, and the loading view renders a named
restored-work line (`ScanResumeNotice`): the repo, how long the scan has really been running, and a
**Start a fresh scan** control that retires the anchor and re-scores from scratch. The elapsed clock and
the time-driven progress curve are anchored on the scan's real start, not on the new mount, so a rejoin
does not reset to 0:00 and walk the bar backwards.

One consequence worth stating: a run whose watchers all left keeps consuming inference for up to the
window. That is the price of the rejoin, and it is what bounds the window's size.

## Key files

| File | Role |
| --- | --- |
| `src/lib/scan.ts` | `scanRepository()`: top-level orchestrator, auth resolution, stage sequencing, progress emission, LLM call + fallback, warnings. |
| `src/app/api/scan/route.ts` | `POST`/`GET` blocking endpoint; cache lookup, persistence, provenance headers. |
| `src/app/api/scan/stream/route.ts` | SSE streaming endpoint with heartbeat + abort handling. |
| `src/lib/github/source.ts` | `GitHubPublicSource.fetchSnapshot()`: metadata, tree, file sampling, commits, conditional head. |
| `src/lib/analyze/index.ts` | `analyzeSignals()`: the 9 detectors, `classifyArchetype`, `detectAiUsage`, `computeContributors`. |
| `src/lib/analyze/pulls.ts` | PR stats over GraphQL; folds into D4/D6/D7/D8. |
| `src/lib/analyze/platform-signals.ts` | Additive folds of the installed-App inventory (D2/D3/D4) and default-branch CI health (D3). |
| `src/lib/github/check-suites.ts` | `fetchAppInventory()` + `classifyApp()`: the Apps that posted check suites on the scored commit. |
| `src/lib/github/actions-health.ts` | `fetchCiHealth()`: default-branch Actions run health (success rate, median duration, currently-red workflows). |
| `src/lib/analyze/passport.ts` | `buildPassport()`: the pure App Readiness Passport projection (barrel for grades/score/autonomy/overlay/migrate siblings), incl. the 0.3.0 sandbox/hooks detectors. |
| `src/lib/analyze/passport-autonomy.ts` | `deriveAutonomyTier()`: the T0–T3 per-repo autonomy ladder + unlock checklists (token-capped; read-time derivation for stored rows). |
| `src/lib/analyze/context-health.ts` | `deriveContextHealth()`: guidance freshness/quality/drift (W4); `pickGuidanceFiles`, `commitsSince`, decay math, `parseContextHealthJson`. Display-only. |
| `src/lib/github/governance.ts` | Branch protection / rulesets / commit activity. |
| `src/lib/scoring/engine.ts` | `assembleReport()`: guardband, blend, rollup, axes, posture. |
| `src/lib/scoring/prompt.ts` | `buildAssessmentPrompt()`: renders the LLM prompt. |
| `src/lib/scoring/recommendations.ts` | Deterministic fallback roadmap (per-dimension templates ranked by weight × headroom × effort), the follow-up guarantee, and the invitational-framing lint. |
| `src/lib/maturity/model.ts` | `LEVELS`, `DIMENSIONS`, `ARCHETYPE_WEIGHTS`, `levelForScore`, `postureFor`, constants. |
| `src/lib/maturity/forecast.ts` | Trend projection + ETA to next level. |
| `src/lib/cache.ts` / `src/lib/scan-cache.ts` | In-memory LRU + tiered cache orchestration (incl. `lookupScopedScan`). |
| `src/lib/scan-scope.ts` | Pure scope predicates: ref/sub-path validation, `isScopedScan`, the cache-key segment, the report caveat. Shared with the scan form. |
| `src/lib/github/visibility.ts` | `guardAmbientToken()` / `resolveRepoVisibility()`: the conditional repo read that decides whether the server's own token may serve an anonymous scan request. |
| `src/lib/scan-scope-server.ts` | `resolveScanScope()`: validates + server-side-resolves a request's ref/sub-path for both scan routes. |
| `src/lib/private-scan-store.ts` | `storableScanReport()`: the pure rule for what a private repo's scan may store (no copied file text). |
| `src/lib/scan-lifecycle.ts` | `runScanLifecycle()`: the ONE post-gate run sequence both entry points execute, plus `resolveScanCoordinate` (forge routing), the refund ledger, `resolveScanTarget`, `latestPublicReport` / `salvageScanFailure` and `finalizeScanRun`. |
| `src/lib/types.ts` | All domain types (`RepoSnapshot`, `DimensionSignals`, `LlmAssessment`, `ScanReport`, …). |

## Cited claims (r9, 2026-08-26)

The assessment JSON carries a `claims` array beside `discrepancies`. For a **claim-scored**
dimension (D4 today — `src/lib/scoring/claims.ts`, `CLAIM_SCORED_DIMENSIONS`) the model does not
move the score through its `score` field at all; it asserts a practice *facet* and cites a sampled
file path plus a verbatim quote, and the engine verifies the quote exists in that file before
awarding the facet's points. Rejected claims are rendered in the dimension's evidence with a reason.
The D4 detector (`src/lib/analyze/index.ts` `d4`) reports the facets it evidenced on
`DimensionSignals.facets`, so a verified claim on an already-found facet is confirmation rather than
a second award; the r7 platform folds in `pulls.ts` and `platform-signals.ts` tag their facets the
same way. Design and the adversarial case: [`docs/SCORING-VALIDITY.md`](../../SCORING-VALIDITY.md);
the facet table itself: [`maturity-model.md` §D4](maturity-model.md#d4-agentic-workflows-12--scored-from-verified-citations-r9-2026-08-26).

### A claim can only cite what the prompt window showed (r13, 2026-08-31)

The verifier checks a citation against `RepoSnapshot.files` — the whole 50-file-plus-workflows
sample. The **model** only sees `buildFileExcerptBlock`'s output: per-file excerpts of
`PROMPT_PER_FILE_CHARS` (2,200) up to `PROMPT_FILE_WINDOW_CHARS` (22,000), i.e. roughly ten files,
filled in `pickFilesToFetch` order. Those two populations are not the same set, and D4 was the
dimension that paid for the difference: `pickFilesToFetch` adds CI workflows **last** (a reserved
*fetch* quota, ranked last for the prompt so README/manifests/source stay front-loaded), so they sat
past position forty and never entered the window — while four of D4's seven facets have nowhere else
in a normal repo to be cited from. Across 34 campaign readings the model cited eight distinct paths
and not one was a workflow; D4 came out bistable (10/20 on a Python repo, 65/85 on a Node one with
equivalent machinery, the difference being that `package.json` scripts described the automation and
`pyproject`/`ruff.toml` did not).

`buildFileExcerptBlock` now reserves **three excerpts of the window** for `.github/workflows/*.y(a)ml`
before filling the rest in fetch-rank order. **Admission is reordered; emission is not**, so a scan
that was not already dropping files (and any repo with no workflows) produces a byte-identical
prompt — GitHub and worktree alike, since both sources feed the same builder. Tests:
`src/lib/scoring/prompt-workflow-reserve.test.ts` (the window rule and the byte-identity oracle) and
`src/lib/scoring/engine.d4-convergence.test.ts` (the composition, both arms of the old bistability,
and the absence of a not-applicable hatch for D4).

**The rule for anyone adding a claim-scored facet:** name the file class the facet must be cited
from, and check it can reach the window. A facet whose only evidence sorts past position ten is not a
facet the model can claim, however well the verifier would accept it. Residual: a repo with more than
three workflows shows its first three in pick order.

## Known gaps

- **Coverage is a heuristic.** `estimateCoverage` caps confidence on truncated/large
  repos; it isn't ground truth, and reports below 50% coverage carry an "indicative only"
  warning.
- **GitLab pagination must advance.** Invalid, repeated or backward next-page indexes stop
  enumeration with `truncated: true`; collected items are retained without re-reading a page.
- **A forge is scored on what it can be asked, and the gaps are NULLS.** The pipeline reads GitHub,
  GitLab and a local working copy through one `Forge` registry (`src/lib/forge/**`). A signal a forge
  cannot answer — GitLab has no platform security posture, no dependency-exposure read and no
  check-suite inventory — reaches the report through the same paths a token-less scan uses, so it is
  *unknown*, never zero, and no score is adjusted to compensate. That makes a lower-observability
  forge a **floor**, not a penalty — but it also means a cross-forge score comparison is partly an
  artifact of observability. The per-forge capability table and that disclosure live in
  [`docs/features/github/forges.md`](../github/forges.md).
- **PR + governance + platform signals require a token.** Anonymous scans skip PR stats,
  governance, security posture/exposure, deployments, the installed-App inventory and CI
  health, and warn. Every token-gated fold is additive, so an anonymous scan is a floor, not a
  different rubric. A *failed* token-gated read is reported separately from an empty one since
  2026-09-05 (see "A failed sensor read is unknown, never zero").
- **The App inventory is a bounded sample.** It reads one page (≤100, `truncated` flags a
  floor) on the *scored* commit and on up to 3 recent merged PR heads. An App that posted only on
  older PRs, or only on open ones, is not seen, and a CI or deploy App that posts only on pull
  requests is seen but not credited.
- **Code-scanning REST endpoints are not read.** `/code-scanning/default-setup` and
  `/code-scanning/alerts` return 403 for an ordinary token on public repos (they need
  `security_events`, which the App does not request), so default-setup CodeQL is credited only
  when it posted a `github-code-scanning` check suite on the scored commit.
- **LLM fallback is automatic but lossy.** A failed LLM swaps to the deterministic mock;
  the report still renders but with `engine.provider: "mock"` and a warning. It is no longer
  *silent*: each fallback bumps a `scan_degraded` tally (see [Outcome
  counters](#outcome-counters-srclibscan-outcomets)), writes a `warn`-level line naming the repo and
  the provider that was supposed to answer, and is recorded **per row** as `Scan.engineDegraded` — but
  the tally rate is still all-time, so there is no way to ask "did degradations spike this week"
  without a real event table.
- **D6 does not read husky hook bodies, and D3's CI sub-signals are still Actions-only.** Since `r20`
  D6's enforcement signals read GitLab, Jenkins, CircleCI, Azure, Travis and Bitbucket configs and
  `lefthook.yml`. A gate that lives only in `.husky/pre-push` is still invisible (the path earns
  `Pre-commit hooks`, but its body is never fetched), and D3's `CI runs tests` / `CI runs linting` /
  `CI runs a build` still search `.github/workflows/**` only. The local worktree source also does not
  exempt the off-Actions CI configs from its byte budget (`RESERVED_PICK_RE`), so a budget-bound worktree can
  miss one a GitHub scan reads.
- **Enforcement is worth +5 on top of presence, not more.** A linter that gates scores 25 where one
  that merely exists scores 20 — a ratio that says a config file is 80% of the value of a gate. That
  is a **rubric decision** (it would move weights, not add signals), so it is recorded here rather
  than changed: raising the enforcement top-up, or splitting `Linter configured` into
  configured/enforced tiers, needs a `SCORING_RUBRIC_VERSION` bump and a corpus recalibration.
- **No raw file is persisted**; only the derived report (see
  [data-model.md](../data/data-model.md)). A **public** report's stored evidence still carries cited
  quotes (up to 200 chars) and its guidance graph and manifest carry the lines they compared; a
  private report's do not (see [What a private scan stores](#what-a-private-scan-stores-2026-10-08)).
  Private rows written before 2026-10-08 hold that text until the operator runs the one-off scrub
  described there; on a self-hosted deployment the scrub's `--apply` refuses, so those rows stay.
- **The ingestion budget is not configurable per request, on purpose.** A bigger budget changes
  which files the *deterministic* detectors see (they read whole file bodies with length
  thresholds), so it changes the score: two repos scanned under different budgets would not be
  comparable, and the persisted corpus has no column to mark which budget produced a row. Raising
  the budget for large repos is therefore a *global, versioned* decision (bump
  `SCORING_RUBRIC_VERSION`, which self-invalidates both cache tiers), not a request knob. A
  per-scan budget would need a schema column recording it plus comparability handling in every
  rollup that averages across repos.
- **Sub-path scans are not saved.** They're a diagnostic lens on one package, not a second score
  for the repo, so there is no per-package history or trend (that would need a first-class
  "component" object, not a scan flag).
- **Lockfiles are read for exposure, not for pinning.** `src/lib/security/exposure.ts`
  fetches and parses `package-lock.json`, `pnpm-lock.yaml` and `Cargo.lock` out-of-band and grades
  open known vulns via OSV (a stronger signal than pinned-vs-floating). Other ecosystems
  (`go.sum`, `poetry.lock`) and a missing supported lockfile return `known:false` = UNKNOWN,
  treated as neutral, never "clean". A lockfile or OSV *read* that fails throws so ingest
  records `securityExposure` as failed rather than collapsing into that UNKNOWN (see
  [A failed sensor read is unknown, never zero](#a-failed-sensor-read-is-unknown-never-zero-2026-09-05)).
  Lockfiles are deliberately **not** added to `pickFilesToFetch`: they are large, low-signal-
  per-byte, and would displace README/manifests/source from the prompt window.

### Numbered repository memory

Memory selection, quarantine and presence-only detection share the numbered-entry format with
the upkeep writer. IDs have a minimum width of four digits (`9999`, `10000`, `10001`); only
flat `.ai/memory/<id>-<slug>.md` entries count. The newest 12 remain separately quarantined
from scoring file contents, including entries whose IDs exceed four digits.
