# L2 preflight — 2026-08-30-moonshot-cert

| Arm / precondition | State on this host | Resolution |
|---|---|---|
| Server identity | :3000 answers Ascent's health shape (`dbMode: "pglite"`, `autoscan{…}`) — verified, not assumed | drive against :3000 (shared dev server; reuse, never restart) |
| `LLM_PROVIDER` | `claude-cli` (subscription-billed, real model output) | senior-quality dimension is meaningful; budget 30s–5min per scan |
| `ASCENT_SELF_HOSTED` / `ASCENT_AUTOPILOT` | both `1` | loop-to-l5 L2 arm SATISFIED on the shared instance |
| `ASCENT_AUTH_BYPASS` | `1` on the shared server | Tomáš's anonymous journey is INVALID there (identity chrome) → construct the arm: `npx next dev -p <free port>` with `ASCENT_AUTH_BYPASS=` unset, assert no signed-in chrome before trusting any evidence |
| GitHub App | `autoscan.githubApp: false` | #35 secrets provisioning + pr-batch live flow **not reproducible on this host** — needs an installed App with `secrets: write`; L1-only verdicts there resolve `uncertain — not reproducible`, fixture named |
| Seeded org + usage lanes | to verify before driving: org rows, ≥1 scan history, UsageEvent rows across ≥2 lanes, control observations | seed via scripts/seed-scans.mjs + seed-org.mjs if empty; lane spend may need one live Athena turn / memory check to mint real UsageEvents; treat any pre-existing singleton rows as suspect provenance (residue rule) |
| MCP work tools | need an org API token with `followups:write` | mint via the tokens panel or db helper during L2; record what we create (residue rule) |

---

## Arm A — ANONYMOUS (constructed 2026-08-30)

The shared `:3000` server is INVALID for Tomáš: `ASCENT_AUTH_BYPASS=1` makes `authGateEnabled()`
false and mints a synthetic *developer* viewer. A second, isolated dev instance was stood up with
the three invalidating flags neutralized. `:3000` was never touched.

| | Value |
|---|---|
| Port | **3100** (free per `netstat -ano \| grep ":3100 "`) |
| Command | `ASCENT_EMPTY=1 PGLITE_DATA_DIR=.pglite/uat-armA ASCENT_AUTH_BYPASS= PUBLIC_SCAN_QUOTA_DISABLED= ASCENT_SELF_HOSTED=0 npx next dev -p 3100` |
| `ASCENT_AUTH_BYPASS` | **empty string** (exported, so Next's dotenv loader cannot re-apply `.env.local`'s `1`; `envBool("") === false`) |
| `PUBLIC_SCAN_QUOTA_DISABLED` | **empty string** → quota enforced (verified: `/api/quota` → `{"enforced":true,"remaining":4,"limit":5,"scope":"anon"}`) |
| `ASCENT_SELF_HOSTED` | **`0`** → `/pricing` renders the four cloud cards, not `SelfHostPricingBlueprint` |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | inherited from `.env.local` (present) → `supabaseAuthConfigured()` true → `authGateEnabled()` **true** — the wall is ON |
| `LLM_PROVIDER` | `claude-cli` (inherited) — real Opus output |
| `NODE_ENV` | `development` (a prod build was not required: with bypass empty, `authGateEnabled()` is already true, which is the whole predicate the finding turns on) |
| `ASCENT_EMPTY=1` | **isolation only.** `grep -rn emptyTenantEnabled src` → the gate has **zero non-test callers**, so the flag is behaviourally inert; it exists here solely because `next.config.ts:47` switches `distDir` to `.next-empty` on it, which is what keeps this instance's build cache off the shared `:3000` server's `.next`. Same trick `scripts/dev-empty.mjs` already uses. |
| PGlite | isolated throwaway dir `.pglite/uat-armA` — the shared `.pglite/ascent` was not opened |

**Identity assertion (not liveness):** `GET :3100/api/health` →
`{"status":"ok","db":"up","reconnected":false,"dbMode":"pglite","autoscan":{"ready":false,"cronSecret":false,"githubApp":false,"db":true}}`
— Ascent's shape (`dbMode` + `autoscan` both present), not a foreign app.

**Anonymity assertion (before any evidence was trusted):** rendered `/` ARIA carries
`button "Sign in"` in the banner, no org name, no avatar, no identity menu
(`shots/armA-landing.aria.yaml:16-18`). Header nav is the public set only
(Leaderboard · Pricing · For orgs · About · Org demo). **Arm A is valid.**
