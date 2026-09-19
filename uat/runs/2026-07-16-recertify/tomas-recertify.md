# Recertify — Tomáš (prospective buyer) × "Evaluate whether to adopt"

Mode: `/uat recertify` · 2026-07-16 · Base URL `http://localhost:3000` (running dev server reused; see
"Environment incident" below for one sanctioned wedged-server recovery mid-run). Env per `uat/env.md`
(`ASCENT_AUTH_BYPASS=1`, PGlite, `LLM_PROVIDER=claude-cli` + mock fallback). Prior findings:
`uat/runs/2026-07-16-full-sweep/tomas-prospective-buyer--evaluate-whether-to-adopt.L2.md`.
Screenshots in `uat/runs/2026-07-16-recertify/shots/` (gitignored).

---

## Finding 1 — F4: landing register can disagree sharply (92 vs 15) with a fresh scan of the same repo

**Fix under test:** `persistScanReport` now calls `revalidateTag("public-scan-gallery", { expire: 0 })`
after a public-org persist — `src/lib/db/scans-persist.ts:441-449`; the tagged cache is
`loadPublicGalleryCards` (`src/lib/db/scans-read.ts:655-656`, `{ revalidate: 60, tags: ["public-scan-gallery"] }`).

**Live evidence (HTTP transcript, all times local):**

1. Baseline + cache warm — `GET /` at **19:22:13**. Register row (extracted from the SSR HTML,
   `scratchpad/landing-warm.html`):
   `05 | withastro/astro | Integrated · 3d ago | 82 69 82 68 73 | avg 74`
   (Incidentally, `vercel/next.js` — the repo of the original F4 92-vs-15 discrepancy — already read
   `today | 66 99 83 15 90 | 68`, i.e. Agentic 15, agreeing with the fresh scan the full sweep ran.)
2. Fresh scan — `GET /api/scan?url=https://github.com/withastro/astro&mock=1&fresh=1`, started
   **19:22:13**, finished **19:22:20** (7s). Response headers: `x-ascent-cache: miss`,
   `x-ascent-dedup: miss` → a NEW scan row was persisted (not deduped, not cache-served).
3. Immediate reload — `GET /` at **19:22:20**, i.e. **7 seconds after the cache was warmed** — the
   register row now reads:
   `06 | withastro/astro | Integrated · today | 58 100 100 40 56 | avg 69`
   Scores, average, rank position and the "as of" recency all reflect the just-persisted scan.

Because the reload landed 7s after the cache-filling request — far inside the 60s TTL — the TTL fallback
cannot explain the update; only the `revalidateTag` call can. The row also survived a later dev-server
restart (`scratchpad/landing-post-restart.html`: astro `today … 69`, next.js `today … 15 … 68`), so it is
the persisted truth, not a cache artifact.

**Resolution: `resolved-verified`.**

**Ceiling (honest limits that remain):**
- The invalidation is **best-effort and request-scoped**: `revalidateTag` throwing outside a Next request
  scope is swallowed (`scans-persist.ts:446-448`), where the 60s TTL is the only fallback; and it fires
  only for public-org persists (`orgSlug === DEFAULT_ORG_SLUG`) — correct for the register, but tenant
  scans rely on TTL alone if a surface ever shares the tag.
- A buyer with the landing page **already rendered** still sees the old numbers until they reload — the
  fix is invalidate-on-write, not push-to-client.
- The register is **engine-blind latest-scan-wins**: my fresh *mock* scan legitimately replaced a live
  claude-cli row's numbers with mock-floor numbers (82/69/82/68/73 → 58/100/100/40/56) on the public
  register. Consistency between surfaces is now prompt, but "latest" can still be a lower-fidelity
  engine's snapshot; nothing on the row discloses the engine.
- Root cause of the original 92-vs-15 (stale cache vs genuine scoring drift between the two persisted
  scans) remains formally unconfirmed; what is verified is that the register can no longer *lag* a fresh
  persist for up to its TTL — the trust-erosion mechanism Tomáš actually hit.

**Metric delta:** the F4 trust-erosion (`high`) drops to residual (`low`) — the buyer's first
cross-check (front page vs own fresh scan) now reconciles within one page reload. No change to
time-saved or grounding (the fix is consistency, not capability).

---

## Finding 2 — F1 residual: ColdScanGate "about a minute" contradicts the honest "a few minutes"

**Fix under test:** `src/components/report/ColdScanGate.tsx:33` and both `ScanModal` intro lines
(`src/components/landing/prototypes/index/ScanModal.tsx:194-195`) now say "a few minutes".

**Live evidence:**

- **ColdScanGate** — `GET /report/koajs/koa` (repo with no persisted scan) renders the gate, quoted from
  the live page (screenshot `shots/coldgate-koa-fixed.png`, text `shots/coldgate-koa-fixed.text.txt`):
  > "No report yet for koajs/koa — This repository hasn't been scanned on Ascent. A fresh scan reads it
  > through the GitHub API (no clone, nothing stored) — **a live AI scan usually takes a few minutes.**"
- **Landing scan modal** — `GET /?scan=1` opens the modal (screenshot `shots/scanmodal-open.png`, text
  `shots/scanmodal-open.text.txt`), intro line quoted live:
  > "Scan a repository — Paste any public GitHub repo. **In a few minutes**, Ascent reads it and returns:"
  (The gated variant, `ScanModal.tsx:194` "…reads it in a few minutes…", is code-verified — it renders
  only when the sign-in gate is live, which the dev bypass disables; same string, same fix.)
- Codebase-wide: `grep "about a minute"` over `src/` → **zero hits**; every latency promise now says
  "a few minutes" (`NotifyToggle.tsx:41,63`, `scanEstimate.ts:59`, `ColdScanGate.tsx:33`,
  `ScanModal.tsx:194-195`).

**Resolution: `resolved-verified`.**

**Ceiling:** "a few minutes" is honest for the observed 3-minute median-ish run but still undersells the
documented worst case (~6 min median on large repos per `scanEstimate.ts:7-9`, one >11-min outlier in the
reference scan); the copy is now *consistent everywhere*, not *adaptive* (no per-repo-size estimate
before the scan starts). The gated ScanModal variant was verified in code, not rendered live (dev bypass
makes `locked` unreachable).

**Metric delta:** F1 residual (minor, cross-copy contradiction) closes fully; the journey's clarity/trust
read is unchanged from the L2 run's already-positive "the copy he actually sees is honest".

---

## Environment incident (disclosed, not a finding against either fix)

During the first ColdScanGate check, `/report/koajs/koa` returned **HTTP 500** (Next dev overlay:
"Jest worker encountered 2 child process exceptions, exceeding retry limit", captured in
`shots/coldgate-koa.aria.yaml`), and the crashed worker then poisoned the whole `/report/[owner]/[repo]`
segment (a previously-200 scanned-repo permalink, `expressjs/express`, began 500ing too) while `/`,
`/pricing` and `/report?repo=…` stayed healthy. This matches the `env.md` "wedged server" class
(Next 16.3 preview / Turbopack dev worker crash), not the copy fix. Applied the sanctioned recovery —
killed PID 1872 on :3000, restarted `npm run dev` (same clean working tree, same fixed code; log at
scratchpad `devserver.log`), healthy in ~12s — after which the ColdScanGate rendered 200 with the fixed
copy on the first request and stayed stable across a browser-driver visit. Recorded as a dev-environment
flake with a known recovery, reproducibility unowned by this recertify; if it recurs it deserves its own
finding against the permalink segment.

## Verdict summary

| Finding | Resolution | Evidence |
|---|---|---|
| F4 register vs fresh scan | resolved-verified | 7s-after-warm register update transcript (above) |
| F1 residual "about a minute" | resolved-verified | live quotes + `shots/coldgate-koa-fixed.png`, `shots/scanmodal-open.png` |
