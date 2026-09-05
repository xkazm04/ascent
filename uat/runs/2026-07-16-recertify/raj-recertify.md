# Recertify — Raj (DevOps/SRE) × L2-RAJ-01 (gate/dashboard verdict identity)

cert_level: L2 (empirical, live server + live GitHub + live claude-cli)
prior: uat/runs/2026-07-16-full-sweep/raj-devops-sre--delivery-and-governance-health.L2.md (L2-RAJ-01, open)
fix under test: src/app/api/gate/[owner]/[repo]/route.ts:86-103 — serve the org's PERSISTED scan when (a) token-less head-sha resolution matches the persisted scan's commit, (b) repo not private, (c) for ?mock=0 the persisted row is not mock.

## 0. Environment / start state

- Dev server reused at session start (`GET /api/health` → 200, dbMode pglite).
- **One wedged-server recovery restart** (documented, per env.md "Wedged-server recovery", NOT a code swap): mid-session every `/org/*` SSR render and every not-yet-compiled route (including `/api/gate/*`) started returning 500 "Jest worker encountered 2 child process exceptions, exceeding retry limit" — the Next dev render-worker pool had died (likely from the day's heavy parallel UAT load; already-compiled API routes like /api/health and /api/history kept working). Recovery: killed PID 46864 on :3000, deleted `.next/`, `npm run dev` again on the SAME working tree (git status untouched), re-polled health → 200, `/org/vercel/governance` → 200. All verdict evidence below was captured AFTER recovery on the fixed code.

## 1. Fixture selection (sha-match precondition)

Persisted headSha (GET /api/history?repo=...) vs live GitHub head (api.github.com, token-less):

| repo | persisted headSha | current GitHub head | sha-matched? | engine |
|---|---|---|---|---|
| vercel/eve | 5f8818b4… (09:32Z) | 42d3166a… | NO (moved) → re-ingested live, see §4 | claude-cli |
| vercel/ai | e8043b4f… (09:32Z) | 341616a3… | NO (moved) | claude-cli |
| vercel/next.js | 153bf8ac… | 491f7809… | NO (moved) — used for the ceiling demo | mock |
| vercel/v0-sdk | 001fae4d36b3b627c9e89af0e00a55f31c2b9c70 | 001fae4d36b3b627c9e89af0e00a55f31c2b9c70 | **YES** | mock |
| vercel/workflow | 6f032d73… | 5554c253… | NO (moved) | mock |

Both live-scanned repos from this morning (eve, ai) had already moved head by 17:30Z — so I re-ingested vercel/eve live (claude-cli) via POST /api/org/import `{"org":"vercel","repos":["vercel/eve"],"mock":false}` to restore a sha-matched, non-mock persisted row for the ?mock=0 check. SSE result: `{"repo":"vercel/eve","level":"L4","overall":74,...}`, persisted headSha now 42d3166a… = current GitHub head, engineProvider claude-cli/sonnet (scannedAt 2026-07-16T17:43:52Z).

## 2. Identity check — sha-matched repo #1: vercel/v0-sdk (mock row, default gate)

Dashboard (`/org/vercel/governance`, shots/vercel-governance.text.txt lines 93-101 and after re-ingest shots/vercel-governance-after.text.txt lines 93-104):

> vercel/v0-sdk — L3 · overall 50
> ✕ D1 AI Tooling & Conventions scored 0, below the required 40.
> ✕ D4 Agentic Workflows scored 15, below the required 40.
> ✕ D8 AI Process & Harness scored 28, below the required 40.

Gate (live, 3.5s — no fresh multi-minute ingest):

```
GET http://localhost:3000/api/gate/vercel/v0-sdk
→ HTTP 422
{"repo":"vercel/v0-sdk","pass":false,"degraded":false,"level":"L3","overallScore":50,
 "archetype":"team","policy":{"minLevel":"L3","minDimension":35},
 "failures":[D1 "scored 0, below the required 35", D4 "scored 15, below the required 35", D8 "scored 28, below the required 35"],
 "engine":{"provider":"mock","model":"deterministic-rubric"},"confidence":0.85}
```

**Level (L3), overall (50), failing dimension set {D1, D4, D8}, and pass/fail (fail) all MATCH** the dashboard. `/report/vercel/v0-sdk` agrees too (shots/v0sdk-report.text.txt: "L3", "50/100"). The gate answered from the persisted verdict (sub-4s response; a fresh v0-sdk ingest is not that fast, and confidence 0.85 equals the persisted row's).

⚠ Residual noticed (goes into the ceiling): the QUOTED FLOORS differ — dashboard says "required 40", gate says "required 35". With no persisted org gate policy, the two surfaces fall back differently: `buildGovernanceOverview` uses `defaultGatePolicy("org")` = minDimension 40 fleet-wide (src/lib/org/governance.ts:67,92), while the gate route falls back to the REPO's archetype default (`policyFromParams(searchParams, report.archetype)`, src/app/api/gate/[owner]/[repo]/route.ts:130-132 → "team" = minDimension 35, src/lib/scoring/gate.ts:138-141). Same failing set here only because all three dims are below both floors; a sha-matched team-archetype repo with a dimension in [35,40) would PASS the gate while the dashboard lists it failing. (eve/ai escape this only because their archetype resolves to "org" → 40 on both sides.)

## 3. Identity check — sha-matched repo #2: vercel/eve (claude-cli row) + the ?mock=0 / degraded-guard interaction

After the live re-ingest (§1), dashboard (shots/vercel-governance-after.text.txt lines 105-108):

> vercel/eve — L4 · overall 74
> ✕ D4 Agentic Workflows scored 39, below the required 40.

Gate, real-grade mode (live):

```
GET http://localhost:3000/api/gate/vercel/eve?mock=0
→ HTTP 422 in 0.48s
{"repo":"vercel/eve","pass":false,"degraded":false,"level":"L4","overallScore":74,
 "archetype":"org","policy":{"minLevel":"L3","minDimension":40,"forbidPostures":["ungoverned"]},
 "failures":[{"code":"dimension","message":"D4 Agentic Workflows scored 39, below the required 40."}],
 "engine":{"provider":"claude-cli","model":"sonnet"},"confidence":0.85,"warnings":[]}
```

**Exact verdict identity with the dashboard** — level L4, overall 74, failing set {D4}, even the same floor wording (archetype "org" → 40 matches the fleet default). And the degraded-guard interaction is confirmed: `?mock=0` served the persisted claude-cli verdict `degraded:false`, **HTTP 422 not 503**, `engine.provider:"claude-cli"` — in 0.48s, i.e. no fresh LLM scan was run and the honesty guard (`provider==="mock" && !mock`) correctly did NOT trip, because the served engine is the real provider. The default (mock) gate call returned the identical persisted verdict in 0.15s.

## 4. Ceiling demo — moved head still diverges (by design): vercel/next.js

Persisted/dashboard: next.js **L4 · overall 68**, failing **D4 only** ("D4 Agentic Workflows scored 15, below the required 40", shots/vercel-governance-after.text.txt; /api/history: headSha 153bf8ac…, L4, 68, mock engine). Current GitHub canary head: 491f7809… — moved.

```
GET http://localhost:3000/api/gate/vercel/next.js   (5.5s — warm scan cache from earlier ingest of the new head)
→ HTTP 422
{"level":"L3","overallScore":61, "failures":[D4 "scored 15, below the required 40", D9 "Supply Chain & Security scored 20, below the required 40"],
 "engine":{"provider":"mock"},"confidence":0.63,
 "warnings":["Pull-request signals were skipped — they need a GitHub token (GraphQL has no anonymous access)."]}
```

The prior finding's exact numbers, reproduced: gate says **L3/61 failing D4+D9** while the dashboard says **L4/68 failing D4 only** — a full level, 7 points, and an extra failing dimension apart. This is now the *documented, sha-scoped* residual: a moved head falls through to a fresh token-less scan (which sees strictly less — the warning says so in-band) until the org re-ingests. The warnings field at least discloses the degraded GitHub coverage to a body-reading CI consumer; `curl --fail` alone still can't tell.

## 5. Verdicts

- **L2-RAJ-01 (verdict identity)** → **resolved-verified**. Two sha-matched repos (v0-sdk mock, eve claude-cli) return gate verdicts identical to the Governance dashboard in level, overall score, and failing dimensions; the moved-head fallthrough behaves exactly as the fix documents. Ceiling: (1) any repo whose head moved since ingest diverges again until re-ingest — demonstrated live on next.js (gate L3/61 D4+D9 vs dashboard L4/68 D4-only); ~4 of the 6 seeded vercel repos had moved within hours, so on an active fleet this is the COMMON case, not the corner; (2) with no persisted org gate policy, the dashboard's fleet fallback (org default, floor 40) and the gate's per-repo-archetype fallback (team → floor 35) are different bars — quoted floors already disagree on v0-sdk, and a team-archetype dim in [35,40) would flip pass/fail between surfaces; persisting a policy via GatePolicyEditor closes this; (3) the "no drift" Governance-page copy is still unqualified — it doesn't mention the moved-head window.
- **?mock=0 degraded-guard interaction** → **resolved-verified**. Persisted claude-cli row served under ?mock=0 with degraded:false, HTTP 422 (not 503), engine claude-cli/sonnet, 0.48s. Ceiling: holds only while the persisted head matches — a moved head under ?mock=0 runs a fresh LIVE scan (minutes; 503 degraded if the LLM is down), and a persisted MOCK row is by-design skipped under ?mock=0, so mock-only-ingest orgs never benefit on the real-grade path.

## 6. Raj — first-person (live)

Last time I curled the gate URL the Governance page told me to paste into CI and got a different level, a different score, and a failing dimension my dashboard had never heard of. Today, on the repos whose ingest commit still IS the repo's head, the gate hands me back the byte-for-byte dashboard verdict — same L4/74 on eve, same single D4 failure, same floor, and it does it in half a second because it's serving the org's real scan instead of re-scanning blind. Even better: `?mock=0` on eve came back `engine: claude-cli, degraded: false` — the real AI grade my org already paid for, not a 503, not a mock floor. That's the contract I asked for.

What I'd still put in the runbook: heads move. Four of our six repos drifted within hours, and the moment a head moves, the public gate quietly goes back to its token-less fresh scan — I reproduced the old L4/68-vs-L3/61 split on next.js on demand. So the honest operating rule is "keep the org re-ingest fresh (autoscan), or expect the gate to be stricter than the dashboard between pushes and re-scans." And one papercut I want fixed before I roll this to every team: if nobody has saved an org gate policy, the dashboard grades the fleet at floor 40 while the gate grades a 'team' repo at floor 35 — v0-sdk's failure messages literally quote different numbers on the two surfaces. Same verdict today by luck of the scores; save the policy in the editor and the seam closes, but the default shouldn't have a seam at all.

Would I wire it into required checks now? For repos under autoscan, yes — pilot-yes, with the re-ingest freshness caveat written down. That's a real upgrade from last week's "reconcile three repos by hand before you trust it."
