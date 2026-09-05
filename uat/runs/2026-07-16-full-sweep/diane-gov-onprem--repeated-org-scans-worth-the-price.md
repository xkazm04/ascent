# L1 report — Diane (gov / on-prem eng lead) × "Repeated org scans worth the price"

cert_level: L1 (theoretical, code-grounded, no browser)
date: 2026-07-16

---

## 1. Surface model (import-chain traced, file:line cited)

### 1a. Deployability / air-gap (the gate that sits upstream of everything else for Diane)

- **Provider selection**: `src/lib/llm/index.ts`
  - `resolveProviderChoice()` (`src/lib/llm/index.ts:66-72`) reads `LLM_PROVIDER` — `claude-cli` is explicitly commented as **"LOCAL-DEV-ONLY … throws in production builds"** (`src/lib/llm/index.ts:9,32-58`).
  - `providerAvailable("claude-cli")` (`src/lib/llm/index.ts:~119-124`): gates on `NODE_ENV !== "production"` — i.e. `claude-cli` is architecturally incapable of running in a deployed instance, which is consistent with Diane's read ("that shells out to a login… dead on arrival inside the boundary").
  - `providerAvailable("bedrock")` sniffs AWS env signals (`src/lib/llm/index.ts:~95-110`) — network-dependent, correctly requires explicit AWS wiring.
  - `mock` is always available (`case "mock": return true;`) — the one keyless, no-network path.
  - **Honest-labeling machinery exists and is real**: `getProvider()` never silently pre-degrades an *explicit* operator choice to mock (`src/lib/llm/index.ts:~150-175`, comment: "A genuinely broken config instead fails fast at assess(), and the retry → failover → mock chain degrades WITH honest accounting"). `scan.ts:519-522` explicitly flags "Keyless / unconfigured deploy: the engine fell back to the deterministic mock from the START."
  - **Where this is surfaced downstream**: `engineMixLabel()` / `engineMixDegraded()` (`src/lib/org/briefing.ts:21-31`) compute "Claude CLI ×18, Mock ×2" and flag **partial** mock degrade; rendered on the Executive Briefing page (`src/app/org/[slug]/executive/page.tsx:142-149`, `⚠ some scores used the deterministic mock engine`) and in the markdown export (`src/lib/org/briefing.ts:333`).
  - **What is NOT reachable**: none of this air-gap/engine-labeling logic is surfaced as **product-facing documentation**. `Grep` across `src/app/**` for `air-gap|GHES|Enterprise Server|offline|no outbound` returns **zero matches** in `/about`, `/pricing`, org `/settings`, or anywhere else a prospect/renewing customer would read. The only place this reasoning lives is code comments — invisible to Diane unless she (or her org) has source access and reads `src/lib/llm/index.ts` directly.

### 1b. GHES / on-prem GitHub reachability

- `src/lib/github/host.ts:1-33` — `githubApiBase()`, `githubGraphqlUrl()`, `githubRawBase()` all read `GITHUB_API_URL` / `GITHUB_GRAPHQL_URL` / `GITHUB_RAW_URL` env vars, falling back to `api.github.com` only when unset. The file's header comment explicitly names this as "the bounded slice of the air-gap need (DIANE)" — this was built for exactly her JTBD.
  - Uses the same env-var names GitHub Actions runners set (`host.ts:4-5`), so an admin who already operates a GHES + Actions reuses values already on hand — genuinely low-friction if reached.
  - `ghHeaders()`/`ghFetch()`/`ghGetJson()` (`host.ts:49-134`) route every REST call through this base — no hardcoded `api.github.com` bypass found in a scan of `src/lib/github/`.
- **Reachability of this control**: it is a **deployment-level env var**, not a per-org Settings-page field. `src/app/org/[slug]/settings/page.tsx` has no `GITHUB_API_URL`/GHES field (grep for `GITHUB_API_URL|githubApiBase|GHES` in that dir returns nothing). For Diane (an eng lead who controls her own deployment's env) this is *workable* — she sets it once at the infra layer — but there is no in-product surface confirming the capability exists or is currently active for her org; she'd have to trust a doc that doesn't exist, or read the source.

### 1c. Artifact export (not a screenshot)

- **Executive Briefing PDF**: `src/app/org/[slug]/executive/page.tsx:73-81` — `<a href="/api/org/briefing/pdf?...">Download PDF</a>`, scoped to the same segment/stack/period being viewed. Backed by `src/app/api/org/briefing/pdf/route.ts` and `src/lib/pdf/briefing-document.tsx`.
- **Markdown-for-LLM export**: `briefingMarkdown(briefing)` (`src/lib/org/briefing.ts:53`) rendered via `<CopyForLlm text={md} .../>` (`executive/page.tsx:85`) — includes the engine-mix + degrade caveat (`briefing.ts:333`) and the forecast-confidence hedge (`briefing.ts:329`).
- **Audit-trail CSV, signed**: `src/app/api/audit/route.ts:1-83`. `format=csv` streams the full filtered trail (cursor-looped, capped at `CSV_MAX_ROWS=10000`, `route.ts:24`), sets `x-ascent-content-sha256` (file-level integrity, `route.ts:76`) and each row carries its own HMAC `_sig` in `meta` (referenced `route.ts:19-22`, backed by `src/lib/db/audit-integrity.ts`). **Truncation honesty**: a capped export is flagged in both the filename (`-PARTIAL`) and response headers (`x-ascent-truncated`, `x-ascent-row-cap`) rather than silently passing as complete (`route.ts:58-80`) — this is precisely the "defensible number with a paper trail" Diane's Voice demands.
- **Download button reachable in UI**: `src/components/org/audit/AuditLogViewer.tsx:150-192` — `Download CSV ↓` anchor wired to `/api/audit?...&format=csv`.
- **Structured-data CSV exports** (contributors/delivery(governance)/passports/teams): `src/app/api/org/export/route.ts:1-121` — `format=csv`, per-kind headers, 404 (not a silent empty-200) when analytics are genuinely unavailable (`route.ts:43-45,54-56,81-83,94-96` — explicit null-vs-empty distinction, the exact "success theater" failure mode Diane's Voice calls out).

### 1d. Recurring-value defensibility (movement is signal, not LLM wobble)

- **Trend confidence surfaced, not a bare number**: `src/lib/org/portfolio.ts:27-28` — "Trend confidence (R² as 0..100) — low = the straight-line read is noisy (few quarterly points)"; suppressed (not shown as a false 100%) when `lowData` (`portfolio.ts:99-100`, `briefing.ts:243-247`). Rendered on the Executive page (`forecastConfidenceNote`, `briefing.ts:36-38`, consumed `executive/page.tsx:159-161`) and in the markdown/PDF export (`briefing.ts:329`).
- **Cross-engine deltas explicitly muted, not blended in as real movement**: `src/components/org/overview/repoTrajectory.ts:39-41,59-61` — `deltaCrossesEngine` flags when a repo's window-delta endpoints came from **different scoring engines** (e.g. a mock seed → a live re-scan), and `movedRows()` (`repoTrajectory.ts:162-166`) **excludes** those from "repos that really moved." This is rendered, not just computed: `src/components/org/overview/RepoCategoryRollup.tsx:118-131` visually mutes a cross-engine delta with an explicit comment: "this delta spans a mock → live engine change, so it reflects a scoring-engine transition, not a real code-change movement. Don't dress it in the confident up/down tone." — this is exactly Diane's acceptance criterion #4 ("a score move carries an evidence delta + fit/confidence, not bare LLM wobble") implemented in code, not just claimed.
- **Retention window ties to the "quarterly baseline" question**: `src/lib/plans.ts:41,53,65,77` — Free 30d / Pro 180d / Team 365d / Enterprise `null` ("custom retention", `plans.ts:77-78`). A quarter (~90 days) requires Pro or above; Free's 30-day window cannot hold a quarter-over-quarter comparison — material for Diane since her cadence is explicitly quarterly.

### 1e. Price legibility

- `src/app/pricing/page.tsx:40-41,81-82` — `planPriceLabel("pro").amount`/`("team").amount` render real `$10`/`$20` monthly figures, sourced from `src/lib/plans.ts:44,58` (the same `PLAN_FEATURES` table the entitlement gate reads — `resolveScanCharge`/`scanAllowance`, `plans.ts:119-146` — so the marketing copy can't drift from what's charged).
- Enterprise: `planPriceLabel()` (`plans.ts:88-93`) returns `{amount: "Custom", cadence: "contact us"}` for `billing === "custom"` — matches Diane's own framing ("a procurement line locked for years… Custom — contact us").

---

## 2. Reachability check (before judging)

Per `uat/env.md`, Diane's surfaces are reachable under `ASCENT_AUTH_BYPASS=1` with a seeded org that has ≥2 scan dates. Her binding (`/org/[slug]` overview+trajectory, `/org/[slug]/executive`, `/share/briefing`, `/audit`, `/usage`, `/pricing`, plus the deploy seam `src/lib/llm/index.ts` + `src/lib/github/source.ts`) maps cleanly onto the code above — no additional nav/entitlement gate blocks these routes for an owner-role viewer (executive white-label gating is `planAllowsWhiteLabel`, `executive/page.tsx:61`, not relevant to her core JTBD). All the *code* she needs exists and is reachable via env-var configuration at deploy time — the gap is not code-reachability, it's **documentation-reachability**: nothing in the product's UI (marketing pages, settings, onboarding) tells her these knobs exist. That's a `confusion`/discoverability finding per the rubric's step-2 test ("no at step 2 where the control exists in the code is a discoverability finding, never missing-feature"), not a structural blocker.

`/api/org/export` kinds cover contributors/delivery(governance)/passports/teams — there is **no** CSV export of the maturity-score-per-dimension table itself (the thing `getOrgRollup`'s `automationScore`/`productionScore` fields represent beyond the passports slice) outside of the PDF/markdown briefing. Noted as a scope gap, not a blocker (the audit CSV + briefing PDF/markdown jointly cover the "evidence-bound artifact" requirement).

---

## 3. Grounding score — n/a

This journey's decisive surfaces (deployability labeling, GHES reachability, artifact export, retention/price) are **deterministic/config-driven**, not an LLM-prompted generation the Character consumes as free text. The one LLM-touching element — the maturity score itself and its trajectory — is scored via existing grounding audits elsewhere in the roster; this journey's own AI-surface exposure is limited to whether the *engine-mix disclosure* (mock vs real) is honest, which is verified above as code-real. **Grounding score: n/a for this journey** (no fresh AI-surface prompt to audit here).

---

## 4. In-character walkthrough (Diane, cognitive walkthrough + her own scored criteria)

I open `/org/<slug>` the way I have every quarter now. First question, always: what ran this, and from where.

**Deployability (air-gap).** The machinery is actually right — `LLM_PROVIDER=claude-cli` is hard-gated to non-production (`llm/index.ts`), so nobody can accidentally ship a phone-home CLI into my boundary; `mock` is the honest keyless floor, and — this is the part that matters — the app doesn't pretend a keyless deploy is running real AI: `engineMixDegraded` flags a partial mock quarter right on the Executive Briefing, and the markdown export carries the same caveat. That's the "un-auditable mock passed off as live" failure mode I've been burned by before, and it's closed. Good. But I had to go read `src/lib/llm/index.ts` and `src/lib/org/briefing.ts` to know any of this — there is nothing on `/pricing`, `/about`, or the org Settings tab that tells a prospect or a renewing customer "here is which engine runs offline." If I were evaluating this cold, without code access, I would not know the air-gap story exists until I asked support directly or hunted the repo. That's a real finding, but it doesn't kill the job — I *do* have code access, this being a self-hosted deployment I run.

**GHES.** `host.ts` is clearly built for exactly my situation — the file comment even says "(DIANE)". `GITHUB_API_URL`/`GITHUB_GRAPHQL_URL`/`GITHUB_RAW_URL`, same names Actions runners use. That's the right instinct — reuse what I already have configured. It's an env var, not a Settings-page field, which is fine for me (I own the deployment), but again: nothing in-product tells me it's there or confirms it's active for my org once set. I'd want a "connected to: ghe.acme.com" line somewhere, not just trust that the env var took.

**Artifact, not a view.** This is the strongest part of the journey. The audit CSV is signed (`x-ascent-content-sha256`), truncation is disclosed rather than silently dropped (the `-PARTIAL` filename + `x-ascent-truncated` header), and each row carries its own HMAC. That is a paper trail I could actually hand a 3PAO. The Executive Briefing's PDF/markdown exports carry the trend-confidence hedge and the engine-mix caveat into the artifact itself, not just the live page — so the exported PDF doesn't overstate what a re-screenshot would. This is the single best thing I found this cycle.

**Recurring value is defensible.** `deltaCrossesEngine` — a repo's score movement is explicitly muted, not blended into "real movement," when its before/after came from different engines (e.g. a mock seed followed by a live rescan). That is exactly the LLM-wobble-vs-real-change distinction I need and normally have to reconstruct by hand from CI logs. Trend confidence (R²) is shown, and suppressed rather than falsely reported at "100%" on thin data. I'd actually trust a move this app reports.

**Retention ties the story together, and here's a real snag.** My cadence is quarterly. Free is 30 days — that's not even one quarter, so a Free-tier deployment literally cannot hold a quarter-over-quarter baseline; Pro (180d) and Team (365d) can. My actual tier is Enterprise, "custom retention" — fine, but "custom" is undecidable from the product itself; I'd need it written into my contract, which is exactly the kind of undecidable-from-app note my own scored criteria call out as expected, not a failure.

**Price legibility.** `/pricing` shows real `$10`/`$20` for Pro/Team, sourced from the same table the entitlement gate reads — so the number on the page is provably the number that gets charged, not marketing copy that can drift. My own line is "Custom — contact us," which is correct and matches how a locked multi-year contract actually works. Not a blocker; my renewal lever was never the visible price anyway.

---

## 5. Findings

```json
[
  {
    "id": "L1-diane-01",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Air-gap/offline-engine story exists in code but is undocumented anywhere in-product",
    "expected": "Per her scored criterion #1, the app should make clear — discoverably, in the product, not just in source comments — which scan engine runs with no outbound internet before she hits the boundary.",
    "got": "The labeling is real (LLM_PROVIDER=claude-cli hard-gated to non-production in src/lib/llm/index.ts:9,32-58,119-124; honest mock-degrade accounting in src/lib/org/briefing.ts:21-31 and src/lib/scan.ts:519-522), but a repo-wide grep for air-gap/GHES/Enterprise-Server/offline/no-outbound across src/app/** (marketing pages, /pricing, org Settings) returns zero matches.",
    "evidence": ["src/lib/llm/index.ts:9", "src/lib/llm/index.ts:32-58", "src/lib/org/briefing.ts:21-31", "src/app/org/[slug]/settings/page.tsx (no GHES/offline copy)"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Confirm live whether any onboarding/settings copy mentions engine deployability or GHES config — L1 found only code, not UI text; L2 should grep the rendered DOM of /pricing, /about, /org/[slug]/settings for this language."
  },
  {
    "id": "L1-diane-02",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "No in-product confirmation that a configured GITHUB_API_URL (GHES) is actually active for this org",
    "expected": "Some visible confirmation (e.g. a 'Connected to: ghe.acme.com' line on Settings or the scan progress stream) that the GHES base URL took effect, so she isn't trusting an env var blind.",
    "got": "src/lib/github/host.ts wires GITHUB_API_URL/GITHUB_GRAPHQL_URL/GITHUB_RAW_URL correctly, but no UI surface (grepped org Settings) echoes back the resolved host.",
    "evidence": ["src/lib/github/host.ts:1-33", "src/app/org/[slug]/settings/page.tsx"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "In a live GHES-configured deployment, check whether the scan stream/SSE progress or any admin surface names the resolved API host."
  },
  {
    "id": "L1-diane-03",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "missing",
    "title": "No CSV export of the maturity/dimension scores themselves, only contributors/governance/passports/teams and the PDF/markdown briefing",
    "expected": "A machine-readable score-and-evidence export parallel to the audit CSV, for the score table specifically (not just the ancillary analytics tables).",
    "got": "/api/org/export supports kind=contributors|delivery|passports|teams only; the dimension-score data is available only via the Executive Briefing PDF/markdown, not as raw CSV.",
    "evidence": ["src/app/api/org/export/route.ts:26-28"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "l2_priority": "Ask whether the PDF/markdown briefing alone satisfies an OSCAL-style machine-readable requirement, or whether a raw score CSV is a hard ask for her specific 3PAO."
  }
]
```

## 6. What passed (strengths worth protecting)

- Signed, truncation-honest audit CSV export (`src/app/api/audit/route.ts`) — file-level SHA-256 + per-row HMAC + explicit `-PARTIAL` disclosure. This is exactly "an artifact I could file," not a screenshot.
- `deltaCrossesEngine` mock→live delta muting, both computed (`repoTrajectory.ts`) and rendered (`RepoCategoryRollup.tsx:118-131`) — directly answers "is this real signal or LLM wobble."
- Trend-confidence (R²) surfaced and suppressed on thin data rather than falsely shown as 100% (`portfolio.ts:99-100`, `briefing.ts:243-247`).
- `engineMixDegraded` partial-mock disclosure baked into both the live Executive page and its PDF/markdown exports (`briefing.ts:21-31,333`).
- `/pricing` Pro/Team dollar figures provably sourced from the same table the entitlement gate reads (`plans.ts`) — no drift between marketing and billing.
- `host.ts` built explicitly for the GHES/air-gap case, reusing GitHub Actions' own env-var names.

---

## 7. Verdict

**L1-conditional** — structurally sound (every acceptance-criterion mechanism she needs is real, reachable, and behaves honestly), but two majors keep it from a clean pass: the deployability story that's supposed to be "explicit" (her criterion #1's literal word) lives only in source comments, not the product surface a prospect or a renewing buyer would actually read, and there's no live confirmation that a configured GHES base URL is actually in effect. Neither blocks the job for Diane specifically (she has source access, being the eng lead running the deployment) — that's why this stays conditional, not a fail — but it would block a *colleague* or a procurement reviewer evaluating the tool without her tribal knowledge.
