# Environment recipe — reaching a known, reproducible start state

Everything downstream depends on a *reproducible* start state. Pin this before trusting any run.

## App + server
- Start: `npm run dev` (Next.js 16, http://localhost:3000). Reuse an already-running dev server; don't spawn a second.
- UI language: **English**. Drive with English role-based selectors.
- Health check: `GET /api/health` (poll for 200 before driving).
- Wedged-server recovery (after a `git checkout` swaps files, or a Turbopack cache error): kill the port, delete `.next/`, restart, re-poll.

### ⚠ Port is NOT guaranteed to be 3000 — resolve it before every run
This host runs several sibling Next.js projects. **3000 and 3001 were both occupied by a
different app** at the 2026-08-10 run (a `GET /api/health` on 3000 answered `200` with a
*foreign* schema — `{"tables":{"jobs":…,"profiles":…,"pipeline_entries":…}}` — which is
CandiDate's shape, not Ascent's). A driver that assumes 3000 will happily drive the wrong
product and report nonsense findings.

**Preflight, every run:**
1. Pick a free port: `netstat -ano | grep ":<port> "` → empty = free.
2. Start on it explicitly: `npx next dev -p <port>` (`npm run dev` has no port flag wired).
3. **Assert identity, not liveness** — Ascent's health payload has a distinctive shape:
   `{"status":"ok","db":"up","dbMode":"pglite","autoscan":{…}}`. A `200` alone proves
   only that *something* is listening. If `dbMode`/`autoscan` are absent, you are talking
   to another app — stop.
4. Export `BASE_URL=http://localhost:<port>` for every driver invocation.

2026-08-10 run used **port 3002**.

## LLM provider (for the *app's* own scoring, not the UAT driver) — RESOLVED: Claude Code CLI
- **UAT default: `LLM_PROVIDER=claude-cli`** (pinned in `.env.local`). The app's own scoring shells out to the local `claude` CLI in headless mode (`src/lib/llm/claude-cli.ts`), running under your **Claude Pro/Max subscription** (not pay-per-token — the provider deletes `ANTHROPIC_API_KEY` from the child env). Requires `claude` on PATH + logged in (`claude /login`). This is so **every LLM test reflects real Claude output**, not the deterministic floor — which is what makes the **senior-quality** dimension meaningful. ~~`LLM_FALLBACK_PROVIDER=mock` is set so a CLI hiccup (not logged in / rate-limited) degrades gracefully instead of failing a sweep.~~ **Corrected 2026-08-10: `LLM_FALLBACK_PROVIDER` is NOT set in `.env.local`.** `scan-assess.ts:283` therefore resolves `providerByName(undefined)` → null, and the chain falls through to the terminal `MockProvider` at `:355` anyway — so the *outcome* is still a graceful degrade, but the documented safety net does not exist as described. Set it explicitly if you want the intermediate hop.
- **Budget for latency**: a claude-cli scan calls the model once over sampled file content — typically tens of seconds, up to ~5–10 min on a large repo (`CLAUDE_CLI_TIMEOUT_MS`, default 150s; the seeders allow longer). The page streams progress over SSE; an early client-timeout would itself be a finding.
- Other modes if you need them: `mock` (deterministic, keyless — cheapest, fine for pure-structural L1), `gemini` (+`GEMINI_API_KEY`), `bedrock` (enterprise-privacy path Elena cares about).
- Note: the **UAT Character driver is a separate capable LLM** driving the browser — it does not collide with the app's claude-cli provider.

## Data / persistence / seed
- **No DB needed for the public funnel.** Single-repo scan, report, badge, gate all work with `DATABASE_URL` unset — every db helper is a safe no-op.
- **Authed/org features need persistence** (history, trends, org rollups, usage, audit). Easiest local path is the **embedded in-process PGlite** (Postgres-in-WASM, no install, no separate server):
  ```
  PGLITE_DATA_DIR=.pglite/ascent
  DATABASE_URL=postgresql://pglite@127.0.0.1:5432/ascent   # dummy URL; PGlite adapter provides the real connection
  npm run dev            # src/instrumentation.ts boots PGlite and persists to PGLITE_DATA_DIR (port 3000)
  ```
- **Two seeders (both drive the RUNNING dev server's real API path, so start `npm run dev` first):**
  - `node scripts/seed-org.mjs <org> [count]` → **the org dashboard.** Scans a public org's repos via POST `/api/org/import`; the dashboard then lives at **`/org/<org>`** (the slug is just the GitHub org login). Default = mock LLM (fast); `--live` uses the real provider. Example: `node scripts/seed-org.mjs vercel 20` → visit **`/org/vercel`**. This is the seed for the `/org/[slug]` journeys (Dana, Marcus, Priya, Raj, Nadia). `node scripts/seed-org-extras.mjs <org>` adds members/teams/segments for those facets. Defaults to base `http://localhost:3000`.
  - `npm run db:local:seed` (= `node scripts/seed-scans.mjs [baseUrl] [repo…]`) → **individual repo scans + history/trends** (default set: anthropics/claude-code, vercel/swr, prisma/prisma, tailwindlabs/tailwindcss, vercel/turbo). ⚠️ Its default baseUrl is `http://localhost:3001` — pass `http://localhost:3000` explicitly if your dev server is on 3000. Set `LLM_PROVIDER=claude-cli` for subscription-quality (not mock) data; expect 5–10 min/repo on a live provider.
- **⚠ KNOWN FIXTURE GAP — no seeded org can produce a forecast (found 2026-08-10).** Both seeders
  scan an org in a **single pass**, so every repo gets one scan on one calendar day.
  `forecastTrajectory` returns `null` below **2 distinct calendar days**, so `rollup.forecast` is
  null, so `briefing.ts:283` nulls `forecastHeadline`, so **no trajectory/ETA line renders anywhere** —
  verified across six generated board PDFs (`vercel`|`acme` × 30d|90d|180d, all HTTP 200, zero
  `Trajectory:` lines). Consequence: **every finding about trajectory/ETA honesty is untestable at
  L2** and must resolve `uncertain — not reproducible on this host` (DANA-L1-001, DANA-L1-002 in
  `runs/2026-08-10-ascent-first/`). To close it, a future run needs an org seeded with **≥3 scans of
  one repo spread across ≥2 calendar days** — and **≥14 days of span** to exercise `isProjectable`,
  the presentability gate `/trends` uses and the briefing path does not. Backdating `scannedAt` on
  seeded rows is the cheapest route.
- Public scan target for journeys: paste a real public repo (e.g. `vercel/next.js`, `facebook/react`). A `GITHUB_TOKEN` raises rate limits and unlocks PR + branch-governance signals; without it, public scans still run (lower rate limit).

## Auth — RESOLVED: bypassed, but backed by a real local profile
The active login is **Supabase GitHub OAuth**; org/private features sit behind it. Characters do **not** log in — auth is bypassed — but they operate on a *genuine* local profile + data, not a hollow open gate:
- **`ASCENT_AUTH_BYPASS=1`** — every auth gate passes as a synthetic "developer" viewer, so all `/org/*` and private functionality is reachable with no Supabase project and no GitHub sign-in (hard-gated off in production; `src/lib/access.ts`).
- **`ASCENT_OPEN_ORG_DASHBOARDS=1`** — open seeded org dashboard (`/org/<slug>`) reads when OAuth is not configured.
- **Local profile auto-seed (new):** visiting a *populated* `/org/<slug>` under the bypass persists "developer" as a real **owner `Membership`** (+ `User`) in PGlite — see `src/app/org/[slug]/layout.tsx`. So the **production schema** (`prisma/init.sql`, the same models the cloud runs) holds a real profile the Characters act as: the **Members** tab lists them, the role chip shows **owner**, and RBAC-gated surfaces resolve a real role. Idempotent, best-effort, dev-only (can't seed ghost owners in prod). The row appears on the **second** visit (first visit seeds it).
- Local-credit/dev seams for billing-gated paths: `ASCENT_ALLOW_CREDIT_GRANTS=1` (manual scan-credit grants), `POLAR_SERVER=sandbox` for the Polar buy-credits flow.

All of the above (plus `LLM_PROVIDER=claude-cli` and `SUPPLY_CHAIN_PROVIDER=mock`) are pinned in **`.env.local`** (git-ignored). Full-coverage recipe:
```
npm run dev                              # boots in-process PGlite + reads .env.local (port 3000)
node scripts/seed-org.mjs vercel 12      # seed an org → /org/vercel  (add --live to use claude-cli)
# then open http://localhost:3000/org/vercel  (twice: the first visit seeds the developer profile)
```

## Surfaces

### Public (free funnel — no auth)
`/` (landing + ScanForm) · `/launch` (fleet-map experience) · `/about` · `/pricing` · `/badge` (badge generator) ·
`/report` + `/report/[owner]/[repo]` (report) · `/report/compare` (diff two scans) · `/trends` (history) ·
`/onboarding` (scan a whole public org) · `/connect` (pick watched repos) ·
share/invite links: `/live/shared/[token]`, `/share/briefing/[token]`, `/invite/[token]`

### Authed product (`/org` + `/org/[slug]/*`) — reachable via the bypass above
`/org` (org picker) · `/org/[slug]` (overview: fleet maturity, adoption×rigor, trajectory forecast, gap, movers) ·
`/repositories` · `/contributors` · `/delivery` · `/practices` · `/plan` · `/governance` · `/security` · `/adoption` ·
`/teams` · `/segments` · `/members` · `/audit` · `/executive` · `/live` · `/backlog` · `/usage` (metering; IDOR-guarded)

## Grounding — the SHARED denominator (score every AI surface against THIS list)

> **Why this section exists.** Grounding scores from parallel Characters are only comparable if
> every Character uses the same ruler. Before this section existed, each walker enumerated its own
> context-source list and the same surface came back `8/10`, `15/16` and `5/8` in one run — three
> rulers, no trend. **The denominator below is canonical.** A Character may record a
> segment-specific source it thinks *should* be there as a **named addition** ("+ peer-cohort
> benchmark, absent"), but must never change the denominator. Derived from code 2026-08-10;
> re-derive on `update` when a prompt builder changes.

**Ascent has only four live LLM surfaces.** Several surfaces that *look* like AI are deterministic —
score those **"N/A — not an LLM surface"**, never invent a denominator for them:

| Looks like AI | Actually | Evidence |
|---|---|---|
| Roadmap / recommendations | a **field of the scan assessment** (same prompt); the standalone `recommendations.ts` is a static 9-template catalog ranked by `weight × (100-score)` | `src/lib/scoring/prompt.ts:171`; `src/lib/scoring/recommendations.ts:20-120,131,167` |
| Practices / starter-file PRs | deterministic + pure | `src/lib/practice-artifact.ts:6` |
| Org simulator · forecast | deterministic (OLS) | `src/lib/scoring/orgsim.ts:1-11`; `src/lib/maturity/forecast.ts` |

### Surface A — Repo scan scoring (and its roadmap field) → **score N/12**
`buildAssessmentPrompt` `src/lib/scoring/prompt.ts:186`; input `buildScanScoreInput` `src/lib/scan-score-input.ts:57,100-119`; the complete input type is `LlmScoreInput` `src/lib/llm/provider.ts:34-64` (nothing else can reach the prompt).

1. Rubric — 5 levels + 9 weighted dimensions + criteria (`prompt.ts:85-94`)
2. Task/output contract + auditor role (`prompt.ts:138-173`)
3. Repo metadata — owner/name, language, stars, pushedAt, description (`prompt.ts:230-232`)
4. Archetype solo/team/org (`prompt.ts:233`)
5. Standing org decisions — accepted/dismissed findings + rationale (`prompt.ts:125-132,234`)
6. Stack-fit caveat — ML/notebook · mobile · embedded (`prompt.ts:234`)
7. Detected tech stack — **FLAG-GATED, DEFAULT OFF** (`scan-score-input.ts:118`). With the flag
   off, score **N/11** and say so.
8. Deterministic per-dimension signal scores + evidence labels (`prompt.ts:192-199,236`)
9. PR stats — merge/reviewed/AI-involved rates, velocity (`prompt.ts:32-45,239`)
10. Branch governance — protection, approvals, checks, CODEOWNERS, signatures (`prompt.ts:46-53,239`)
11. Security D9 check battery — graded checks, risk, exposure (`prompt.ts:63-73,242`)
12. Untrusted repo evidence — commit sample + sampled file excerpts (`prompt.ts:216-225,245-251`)

**Caps that silently drop context (cite these, they are findings-in-waiting):** file excerpts
`PER_FILE=2200` chars, `OUTER=22000` chars total with a hard `break` (`prompt.ts:210-211,219`);
commits `.slice(0,15)` × 120 chars (`scan-score-input.ts:104`; `prompt.ts:224`). Ingestion pulls
`MAX_TOTAL_BYTES=280_000` (`src/lib/github/source.ts:73`) — so **~22 KB of ~280 KB reaches the
model**; the rest serves detectors only.

**Known-absent (available in the codebase/DB, demonstrably not wired in):** prior scans / score
history / trend · org profile, goals, peer cohort, benchmark percentile · org findings, governance
policy, practice library · shared org memory · simulator projections · contributor stats &
AI-change detection (resolved for the *report* at `scan.ts:280-281`, never for the prompt) · full
file tree manifest.

### Surface B — Executive Briefing narrative → **score N/15**
`src/lib/org/briefing-narrative.ts:136-152,178`; facts payload = `briefingMarkdown` cut at `## Ask`
(`briefing.ts:366`; `briefing-narrative.ts:53-56`). Sole input type `ExecBriefing` `briefing.ts:86-165`.
Sole caller `src/app/api/org/briefing/pdf/route.ts:67`.

1) org + period + date · 2) maturity/level/adoption/rigor + delta · 3) coverage counts · 4) value
realized · 5) fleet adoption · 6) corpus benchmark percentile · 7) peer cohort · 8) forecast
headline + R² · 9) engine mix / mock caveat · 10) prior period + per-dim deltas · 11) strengths ·
12) risks incl. D9 · 13) movement totals + top movers · 14) goals w/ pace + ETA · 15) ranked next
move + widest gaps.

> ⚠ **Environment precondition — this surface is GATED OFF by default.** It needs
> `BRIEFING_NARRATIVE=1` **and** `ANTHROPIC_API_KEY` (`briefing-narrative.ts:43-46`); otherwise
> `deterministicNarrative` (`:102`) runs and there is no LLM at all. Any `l2_priority` on this
> surface **must** declare that precondition; if the host can't satisfy it the verdict is
> `uncertain — not reproducible on this host`, never `refuted`.
> ⚠ It also **bypasses `src/lib/llm/` entirely** — raw `fetch` to `api.anthropic.com`
> (`:33,164,175-176`), model `claude-opus-5`, 20 s timeout. It therefore ignores `LLM_PROVIDER`
> and **is not covered by BYOM or the Bedrock "code never leaves the AWS boundary" path**.

### Surface C — Shared org memory, write gate → **score N/4**
`src/lib/memory/consolidation.ts:166,296,310`. 1) proposed content · 2) kind · 3) namespace ·
4) shortlisted existing memories (`SHORTLIST_MAX=6` `:83`, 600-char excerpts `:85,172`).

### Surface D — Shared org memory, reflection → **score N/1**
`src/lib/memory/reflection.ts:197,330,348`. 1) clustered memory members only
(`MAX_CLUSTERS=4` `:80`, 800-char excerpts `:82,207`). No LLM ⇒ zero proposals, no fallback (`:325-329`).

### Provider / failover facts every walker should hold
`resolveProviderChoice` `src/lib/llm/index.ts:69` · failover primary → same-provider retry →
`LLM_FALLBACK_PROVIDER` → **Mock** (`src/lib/scan-assess.ts:286-292,355`), which sets `llmFailed`
+ a report warning (`:345-353`) · usability gate `MIN_ASSESSMENT_COVERAGE=0.5`
(`llm/provider.ts:282,295`) · `claude-cli` is **dev-only** (dead-code-pruned in production,
`llm/index.ts:54-59,132`) and deletes `ANTHROPIC_API_KEY` to force subscription auth
(`llm/claude-cli.ts:166`) · timeouts: per-call 60 s, claude-cli 600 s, scan-wide budget 15 min for
claude-cli / 90 s otherwise (`scan-assess.ts:34-39`) · BYOM fails closed, never falls back to the
platform (`llm/index.ts:243-249`; `scan-assess.ts:283`) · **dead seam:**
`resolveTextRunnerForOrg` (`llm/text-org.ts:28`) has no production caller, so memory surfaces run
on the platform provider even for BYOM orgs.

## Driver mechanism
- Prefer an interactive browser MCP (chrome-devtools / playwright) if connected.
- Else the bundled portable driver: `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3000 SHOT_DIR=uat/runs/<id>/shots node uat/driver/drive.mjs /pricing pricing` (navigate → screenshot + ARIA + text + optional one click). For multi-step flows (paste repo → submit → watch SSE → read report) write a short bespoke driver reusing its patterns; budget for the streaming scan to take time.
