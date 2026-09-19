# Tomáš (prospective buyer) × `evaluate-whether-to-adopt` — L1 (theoretical, code-grounded)

- **Run:** `2026-08-10-ascent-first` · first outing under `/uat` v1.2
- **Certification level:** L1 (no browser; surface model derived from source)
- **Character:** `uat/characters/tomas-prospective-buyer.md` — Director of Engineering, economic buyer, **2–3 minutes then the tab closes**
- **Journey:** `uat/journeys/evaluate-whether-to-adopt.md`
- **Grounding denominator:** `uat/env.md` §Grounding, Surface A, scored **verbatim** against that list

---

## sources:

Surface model built from these files (key line ranges cited inline throughout):

**Public funnel — landing**
- `src/app/page.tsx:11,15-60,62-96` — route, FAQ JSON-LD, gallery fetch, `auth`/`gated` resolution
- `src/components/landing/prototypes/IndexLanding.tsx:16-39` — deck section list
- `src/components/landing/prototypes/index/IndexVariant.tsx:17-45` — section render order
- `src/components/landing/prototypes/index/IndexHero.tsx:26-126` — H1, lede, CTAs, sample-report link, stat ledger
- `src/components/landing/prototypes/index/ScanModal.tsx:43-265` — the primary CTA's dialog, three gate states
- `src/components/landing/prototypes/index/ScanModal.AuthCta.tsx:12-42` — sign-in / connect affordances
- `src/components/landing/prototypes/index/IndexOrg.tsx:19-102` — org edition + 6 use-case cards
- `src/components/landing/prototypes/index/IndexGallery.tsx:36-133` — the live register (proof surface)
- `src/components/ScanForm.tsx:39-288` — the repo input, submit → `/report?repo=`
- `src/components/StaticNav.tsx:50-75` — `MARKETING_NAV` (Leaderboard · Pricing · For orgs · About)
- `src/components/SiteFooterCore.tsx:17-28` — footer links + attribution
- `src/components/Brand.tsx:150-168,239-250` — header/footer composition

**Pricing**
- `src/app/pricing/page.tsx:30-50,81-88,90-178` — `ctaFor`, derived prices, card grid, credit ledger, footnote
- `src/lib/plans.ts:43-104,122-161` — `PLAN_FEATURES`, `planPriceLabel`, `decideScanCharge`

**Gating / quota / auth**
- `src/lib/env.ts:14-17,24-33,55-57` — `envBool`, `supabaseAuthConfigured`, `authBypassEnabled`, `authGateEnabled`
- `src/lib/access.ts:20,31-83,117-139` — `getViewer`, `requireViewer`
- `src/lib/scan-gates.ts:11-36,61-83` — `scanRateLimitGate`, `scanAuthGate`, the load-bearing gate order
- `src/app/api/scan/route.ts:231-281` — pre-scan gates in the JSON route
- `src/app/api/scan/stream/route.ts:56-59,79-92,123-125` — same order in the SSE route
- `src/lib/public-scan-quota.ts:53-77,102-121,150-178,216-276,384-409` — the monthly public-scan gate, every branch
- `.env.production` / `.env.vercel` (committed) — production provider + Supabase config

**Report / scan output**
- `src/app/report/page.tsx:13-24` · `src/components/report/ReportClient.tsx:12-88`
- `src/components/report/ReportClientStatus.tsx:16-80` — the progress checklist
- `src/components/report/scanEstimate.ts:1-16,20-30,38-53,96-105` — the measured latency calibration
- `src/app/report/[owner]/[repo]/page.tsx:1-80` — permalink, persisted-first, cold-scan fallback
- `src/components/report/ReportView.tsx:3-16,213-264` — report composition

**Grounding (Surface A)**
- `src/lib/scan-score-input.ts:57-119` — what actually reaches `LlmScoreInput`
- `src/lib/scoring/prompt.ts:205-225` — `PER_FILE=2200`, `OUTER=22000`, the hard `break`
- `src/lib/github/source.ts:73` — `MAX_TOTAL_BYTES = 280_000`
- `src/lib/llm/config.ts:107-110` — `techStackPromptEnabled()` (flag-gated, default off)

**Other public surfaces**
- `src/app/about/page.tsx:18-25` · `src/components/about/AboutLanding.tsx:55-95` · `AboutCost.tsx:7-12` · `features.ts:16-69` · `RoiSimulator.tsx:14-52`
- `src/app/launch/page.tsx:26-76` · `src/app/badge/page.tsx` · `src/app/about-org/page.tsx` · `src/app/leaderboard/page.tsx`
- `src/lib/db/scans-read.ts:782-804` — `getPublicScanGallery` (null when DB unconfigured)

**Live evidence (L2-grade, arriving early)**
- `uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json` — a genuine `/api/scan` response for `vercel/swr`, `engine.provider: "claude-cli"`, `usage.latencyMs: 187174`, 193 s wall clock

**Reproductions executed** (not eyeballed): `/tmp/uat-check.mjs` — re-implements `authGateEnabled`, `decideQuota`, `planPriceLabel`, `ctaFor`, `timeProgressPct` verbatim from source and prints every branch. Output quoted inline below.

---

## Surface model — the public funnel Tomáš can actually reach

### `/` — the landing scroll-snap deck

`page.tsx:88` renders `<IndexLanding gallery auth gated />`. The deck's sections (`IndexLanding.tsx:19-27`) are, in order:

| # | Section | What it gives him | `file:line` |
|---|---|---|---|
| 1 | `hero` | H1 + lede + primary/secondary CTA + 2 zero-commitment preview links + a 3-stat ledger | `IndexHero.tsx:67-122` |
| 2 | `org` | "Index the whole organization" + 6 use-case cards linking into the demo org | `IndexOrg.tsx:52-101` |
| 3 | `fleet` | fleet visual | `IndexFleet.tsx` |
| 4 | `gallery` | **the live register** — ranked real repos with real scores. **Only rendered when `props.gallery` is non-null** | `IndexLanding.tsx:23`; `IndexGallery.tsx:36-110` |
| 5 | `levels` | the 5-level ladder | `IndexLevels.tsx` |
| 6 | `dimensions` | the 9-dimension matrix | `DimensionMatrix.tsx` |

**There is no pricing section in the deck.** Price lives one header-nav click away (`StaticNav.tsx:50-58`, `{ href: "/pricing", label: "Pricing" }`, rendered at `Brand.tsx:161`).

**What the hero actually claims** (`IndexHero.tsx:67-77`, verbatim):
> "Every engineering org has a maturity. **Now it has an index.**"
> "Ascent reads a GitHub repository and rates how AI-native the engineering is — a single 0–100 score on a 5-level ladder across 9 weighted dimensions, with the evidence behind every number."

That is a concrete, measurable claim — no "platform", no "synergy". It survives Tomáš's buzzword filter.

**Primary CTA** (`IndexHero.tsx:82` → `ScanModal.tsx:146-154`): a button, *"Scan a repository →"*, that opens a dialog. **Not** a "Book a demo". Secondary CTA is `/onboarding` ("Scan your whole org"). Below them, two preview links: *"See a sample report"* (only when `sampleRepo` resolves — `IndexHero.tsx:31,96`) and *"See an example org dashboard"* (`:101`).

### The scan dialog — three gate states, and the one that matters

`ScanModal.tsx:140-142` derives three states from the server-passed `gated` prop (`page.tsx:81` → `authGateEnabled()`):

- `pending` (viewer fetch in flight) → skeleton (`:208-214`)
- `locked` (`gated && signedIn === false`) → **"Sign in to scan"** panel; the only affordance is `SignInButton` (`:215-227`)
- open → `ScanForm` + `QuotaMeter` + a private-repo consent checkbox (`:228-257`)

### `/pricing` — where the price lives

`pricing/page.tsx:110-158` renders four cards straight from `PLAN_FEATURES`. Executed, every branch of `planPriceLabel` (`plans.ts:99-104`):

```
free       -> {"amount":"$0","cadence":"free forever"}
pro        -> {"amount":"$10","cadence":"/ month"}
team       -> {"amount":"$20","cadence":"/ month"}
enterprise -> {"amount":"Custom","cadence":"contact us"}
```

And every branch of `ctaFor` (`pricing/page.tsx:36-50`) **for an anonymous visitor** (`org=null`, no Polar product — which is exactly Tomáš):

```
free       -> {"href":"/","label":"Scan a repo free"}
pro        -> {"href":"/onboarding","label":"Get started"}
team       -> {"href":"/onboarding","label":"Get started"}
enterprise -> {"href":"/about","label":"Learn more"}      # ASCENT_CONTACT_EMAIL unset in .env.production
```

**No contact-sales wall stands between him and a number.** Three of four tiers carry a real dollar figure, reachable in one click from the landing header. Per G2, this is the single thing most vendors fail and Ascent passes it outright.

### `/about`

`AboutLanding.tsx:55-64` — an 8-section deck: Overview · The cost · Fleet X-Ray · **ROI simulator** · Adoption · Risk radar · Transition · Get started. The four feature blocks are copy + an animated diagram (`features.ts:16-69`). **The ROI simulator runs on eight invented repos** (`RoiSimulator.tsx:21-30`: `web-app`, `api-gateway`, `billing`, `docs-site`…) at a **deliberately non-production weighting** (`:31-36`: `const W = 0.16` with the comment *"Deliberately NOT the production weighting"*). No customer names, no case study, no logo wall, no quantified third-party result anywhere in the funnel.

### `/launch`, `/badge`, `/leaderboard`, `/about-org`

- `/launch` — `launch/page.tsx:40-59`: anonymous visitors get a "Sign in to chart your orgs" prompt, and even signed in with no installations it `redirect("/connect")` (`:65`). It is also **not linked** from `MARKETING_NAV` or `FOOTER_LINKS`. Effectively invisible to Tomáš → **`unreachable`**, `scope_note`.
- `/badge`, `/leaderboard` — reachable (footer / header), public, not on his critical path.
- `/about-org` — in the header nav as "For orgs"; the org-edition marketing deck. Reachable.

---

## Grounding score — Surface A (repo scan scoring + its roadmap field)

Scored **verbatim against `uat/env.md` §Grounding Surface A**, for **the path this Character actually takes**: an *anonymous public scan* with `GITHUB_TOKEN` present (as `.env.production` has it).

**`TECH_STACK_PROMPT` is unset in `.env.example`, `.env.local`, `.env.production` and `.env.vercel`** → `techStackPromptEnabled()` is false (`llm/config.ts:107-110`) → **item 7 is off, so the denominator is 11.**

### **Surface A grounding: 10/11**

| # | Source (env.md's wording) | Reaches the prompt? | Evidence |
|---|---|---|---|
| 1 | Rubric — 5 levels + 9 weighted dimensions + criteria | ✅ | `prompt.ts:85-94` |
| 2 | Task/output contract + auditor role | ✅ | `prompt.ts:138-173` |
| 3 | Repo metadata (owner/name, language, stars, pushedAt, description) | ✅ | `prompt.ts:230-232`; live JSON `repo.*` |
| 4 | Archetype solo/team/org | ✅ | `prompt.ts:233`; `scan-score-input.ts:83,105` |
| 5 | Standing org decisions + rationale | ❌ | `scan-score-input.ts:96-98` — `decisionSlug` is absent on an anonymous public scan, so `orgDecisions = []` and `:107` omits the key entirely. **Structurally unavailable to this Character.** |
| 6 | Stack-fit caveat (ML/notebook · mobile · embedded) | ✅ | `scan-score-input.ts:88,116` |
| 7 | Detected tech stack | — | **FLAG OFF** (`llm/config.ts:107`; `scan-score-input.ts:118`) → excluded from denominator |
| 8 | Deterministic per-dimension signal scores + evidence labels | ✅ | `prompt.ts:192-199,236`; live JSON `dimensions[].signalScore` + `evidence[]` |
| 9 | PR stats — merge/reviewed/AI-involved rates, velocity | ✅ | `scan-score-input.ts:110`; live JSON cites "56% of sampled merged PRs", "17.6h median time-to-first-review" |
| 10 | Branch governance — protection, approvals, checks, CODEOWNERS, signatures | ✅ | `scan-score-input.ts:111`; live JSON risk #4 cites the required-approval ruleset |
| 11 | Security D9 check battery | ✅ | `scan-score-input.ts:74-79,114`; live JSON `D9:40` + a D9 discrepancy |
| 12 | Untrusted repo evidence — commit sample + sampled file excerpts | ✅ **but capped** | `prompt.ts:210-211,219`; `scan-score-input.ts:104` |

**Named additions Tomáš would want (never a denominator change):**
- *+ peer-cohort / industry benchmark percentile — absent.* He is answering "are we getting value out of the AI spend?" — a score with no comparison class is a number he can't defend upward. `env.md` lists it under known-absent for this surface.
- *+ prior scan / trend for the same repo — absent.* His question is directional, not a snapshot.

### The 22 KB cap — judged in his voice

Ingestion pulls `MAX_TOTAL_BYTES = 280_000` (`github/source.ts:73`). The prompt window is `OUTER = 22000` chars with a hard `break` (`prompt.ts:210-211,219`). Executed: **22000 / 280000 = 7.9%** of ingested content reaches the model.

Does that undermine the pitch? **No — and the code earns that verdict, it isn't a charitable reading.** `prompt.ts:206-209` says outright that the deterministic detectors read the *full* file content and that the fetch budget is sized for the scorer, not the prompt. Six of the eleven live grounding sources (8, 9, 10, 11, plus 6) are **deterministic facts computed over the full 280 KB**, handed to the model as facts. The model isn't reading 8% of the repo and guessing; it's narrating a fully-computed signal set and sampling 22 KB for texture. The live output proves it: "138 test files", "1.04 test-to-source ratio", "0 of 8 Action references pinned by SHA", "1 of 30 recent commits" — none of those come from a 22 KB excerpt.

Where it *does* bite is item 12's role as an evidence source rather than a texture source — the D3 discrepancy in the live JSON (`"the D3 signal list ... only cites test/lint/build"`) is exactly the shape of a miss the cap can cause. But that's a quality ceiling, not a bluff. **The pitch survives.**

---

## Reachability set (resolved BEFORE judging)

Tomáš is **anonymous and never signs in**. His reachable set:

**In scope, reachable:** `/` (all deck sections except `gallery`, which is data-conditional) · `/pricing` · `/about` · `/about-org` · `/leaderboard` · `/badge` · `/report/[owner]/[repo]` permalinks for **already-persisted** scans · `/privacy`, `/terms` · the footer's GitHub-issues link.

**In scope, reachable only on an ungated deployment:** running a *new* scan — `ScanForm` → `/report?repo=…` → `POST /api/scan/stream`. See TOMAS-L1-01.

**Out of scope per the journey (NOT reported as missing):** `/org/*`, `/trends`, `/usage`, `/connect`, org rollups — authed product. Tagged `scope_note` where they touch a finding.

**Reachable-but-invisible:** `/launch` — sign-in prompt for anonymous viewers (`launch/page.tsx:41-58`) and not linked from any nav. Tagged `unreachable`.

### The DB-on/DB-off question — all three branches

`getPublicScanGallery` returns `null` when `!isDbConfigured()` (`scans-read.ts:785`) *and* when `resolveOrgId`/`loadPublicGalleryCards` yield nothing (`:797,800`), and `dbReadSafe` collapses an unreachable-but-configured DB to `null` too (`:794,803`).

| Branch | What Tomáš sees | Verdict |
|---|---|---|
| **A. `DATABASE_URL` unset** (or DB down) | `gallery = null` → the `gallery` section is **absent from the deck entirely** (`IndexLanding.tsx:23`), *and* `exampleRepos` is undefined → `sampleRepo = null` → **the "See a sample report" link is omitted** (`IndexHero.tsx:31,96`). `ScanForm` falls back to static chips (`ScanForm.tsx:18,59`) labeled "Try:" not "Top scored:" (`:254`). | The deck reads as **complete but claim-only**. It does *not* read "dead" — nothing is empty, the section simply isn't there. But he loses **both** zero-commitment proofs and is left with marketing copy until he runs a scan himself. |
| **B. DB configured, zero public scans** | `board.length === 0` → the register renders its header, column labels, and *"No public scans yet — scan a repository below to be the first on the register."* (`IndexGallery.tsx:82-86`), under a heading that says "**N public repos rated**" with N=0. | **This is the branch that reads as a dead product.** A ranking table with zero rows, on a page whose whole proposition is "now it has an index". |
| **C. DB configured + populated** — **this is production** (`.env.production` carries `DATABASE_URL`) | Ranked register, real repos, real per-dimension scores, "Served live from …" provenance and a freshness stamp (`IndexGallery.tsx:52-65`). | **The strongest thing on the page for this Character.** Third-party-verifiable proof he can spot-check against repos he knows. |

**A prospect hitting the real ascent.dev site sees branch C.** Branch B is the hazard for any fresh deployment.

---

## The 2–3 minute walkthrough — in character

> *Between meetings. Peer said "Ascent". Two minutes.*

**0:00–0:10 · Landing, no action.** *"Every engineering org has a maturity. Now it has an index."* Then: reads a GitHub repo, rates how AI-native the engineering is, 0–100, 5 levels, 9 weighted dimensions, evidence behind every number. Huh. That's a claim with a shape. Not "AI-native platform." **Answer 1 (what it is): 0 actions, ~10 s.** ✅

**0:10–0:12 · Still no action.** Two buttons: *Scan a repository* and *Scan your whole org*. Under them, two links: a sample report, an example org dashboard. **No "Book a demo" anywhere on the page.** That's the tell he's looking for. **Answer 5 (next step): 0 actions, ~2 s.** ✅

**0:12–0:35 · One scroll.** "Index the whole organization" — executive rollup, governance, AI adoption, delivery, supply chain, improvement plan (`IndexOrg.tsx:19-50`). That's the buyer's page, and it's aimed at him, not at his engineers. **Answer 2 (who for): 1 scroll, ~20 s.** ✅

**0:35–1:05 · Two more scrolls.** The register (`IndexGallery.tsx`): real repos, ranked, with per-dimension columns and a "served live from …" provenance stamp. He picks a row he recognizes and checks whether the number offends him. It doesn't. **Answer 3 (does it work): 2–3 scrolls, ~30 s.** ✅ *— on branch C. On branch A this answer does not exist yet and he has to spend his scan budget to get it; on branch B he gets a zero-row table and leaves.*

**1:05–1:20 · One click — header "Pricing".** $0 / $10 / $20 / Custom, on cards, with per-tier scan allowances and a credit ledger under them. No form. No "talk to us" for the tiers with numbers. **Answer 4 (cost): 1 click, ~15 s.** ✅ — and this is the moment "I've heard this pitch before" starts to flip.

*He has all five answers in about 80 seconds and four actions. That is a genuinely fast front door.*

**1:20 · Back to `/`, clicks "Scan a repository".** Dialog opens. And here the run forks:

- **On this UAT host** (dev + `ASCENT_AUTH_BYPASS=1`, executed: `authGateEnabled = false`): he gets the input. Pastes `vercel/swr`. Hits Scan.
- **On the deployment as configured in the committed `.env.production`** (executed: `authGateEnabled = true`, and *`ASCENT_AUTH_BYPASS` cannot rescue it* — `env.ts:31` hard-returns false in production): he gets **"Sign in to scan"** and a GitHub OAuth button (`ScanModal.tsx:215-227`). **This is his instant-bounce trigger, verbatim from his file: "a free tier that quietly needs a signup ... before it'll show him anything."** Tab closes at ~1:25. He never sees a report.

**1:20–4:33 · (ungated path) the wait.** `/report?repo=vercel/swr` → SSE. The checklist is honest and provider-aware (`ReportClientStatus.tsx:27-56`) and the copy sets expectations (`scanEstimate.ts:104`: *"this usually takes a few minutes"*). But the dialog he just came from said **"In about a minute"** (`ScanModal.tsx:201`). Executed against the real curve:

```
provider gemini     est 100000 ms; pct@180s = 94.6%
provider claude-cli est 360000 ms; pct@180s = 73.8%
```

The measured live scan (`_l2-warm-scan-swr.json`, `usage.latencyMs: 187174`, 193 s wall) means that **at the moment his entire journey budget expires, the bar is at 74% and there is no report.** The wait alone is 1× to 2× his total attention span.

**4:33 · The report.** And it's good. See the criteria below.

---

## Scored acceptance criteria (seven, judged identically every run)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | After ~2–3 min on `/`, `/about`, `/pricing`, state **what / who-for / does-it-work / cost / next-step** in one sentence each | **PASS** | All five answered in ~80 s / 4 actions (walkthrough above). "Does it work" is data-conditional — see the branch table. |
| 2 | **Pricing transparent** — numbers reachable from the landing page **without a contact-sales / demo wall** | **PASS** | `StaticNav.tsx:53` (one click) → `pricing/page.tsx:110-158`; executed `planPriceLabel` gives `$0/$10/$20/Custom`; `ctaFor` for an anonymous visitor never routes to a form. Enterprise = "Custom · contact us", which is standard — but see TOMAS-L1-06 for what "contact us" actually does. |
| 3 | **Primary CTA is a frictionless look** — public single-repo scan, **no login or signup**, and the obvious front door | **FAIL (production) / PASS (open deployment)** | `IndexHero.tsx:82` puts scan first and there is no demo button anywhere — the *design* is exactly right. But `page.tsx:81` + `env.ts:55-57` + `scan-gates.ts:80-82` put GitHub OAuth in front of it on the deployment as configured. **TOMAS-L1-01.** |
| 4 | **Run one public scan himself** and the output is **senior-grade** — reconciles, cites evidence, names a specific next move | **PASS (output) / blocked (running it, in production)** | Live JSON: `vercel/swr` → 47, L3, `confidence 0.85`. Per-dimension `D1:3 D2:98 D3:76 D4:3 D5:47 D6:75 D7:79 D8:22 D9:40` — that split (world-class testing, near-zero AI tooling) **reconciles exactly with what a staff engineer knows about SWR**. Roadmap item 1 is not "add more tests": it's *"no CLAUDE.md/AGENTS.md"*, D1, high impact / low effort, `levelUnlock: L3->L4`, with three probing questions attached. Risk 4 is *"56% of sampled merged PRs lack a recorded approving review despite a required-approval branch-protection rule, suggesting a bypass path"* — that is a finding a senior would be embarrassed **not** to have caught. |
| 5 | **Credible proof exists** — a quantified specific customer result, **or** the live scan output stands as proof | **PASS (via the second limb only)** | The first limb is empty: no case study, no customer, no quantified outcome anywhere in the funnel. `/about`'s ROI simulator is eight fabricated repos at a self-declared non-production weighting (`RoiSimulator.tsx:21-36`). The criterion is satisfied **entirely** by the live register (branch C) + the scan output. **TOMAS-L1-04.** |
| 6 | **Time-saved bar** — decide in well under three minutes; the front door is cheap enough to start | **FAIL** | The marketing half is excellent (~80 s to all five answers). But the proof half — the one thing he actually trusts — costs 100–360 s of dead wait (`scanEstimate.ts:21,28`; measured 193 s), advertised as *"about a minute"* (`ScanModal.tsx:201`). **TOMAS-L1-03.** |
| 7 | **Senior-quality bar** — he'd forward the public-scan report to leadership **as-is** | **PASS** | Specific numbers throughout, `scoreIntegrity: {widenedDims:["D3"], effectiveBlend:0.51}` and a `discrepancies[]` array where the model **argues against its own D9 check** ("the check appears not to have credited" OIDC trusted publishing). A tool that publishes where its own scorer disagreed with its own model is a tool he can defend in a room. |

**Score: 5 pass / 2 fail** (criterion 3 fails only under the production gate; criterion 6 fails everywhere).

---

## Findings

```json
[
  {
    "id": "TOMAS-L1-01",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "In production the free public scan — the product's own front door and this buyer's #1 criterion — sits behind GitHub OAuth",
    "expected": "Per the site's own copy ('Unlimited free public scans', 'public scans are always free', 'Public scans never need an account'), an anonymous visitor pastes a repo and gets a report with no signup. This is the single non-negotiable for a dev-tools economic buyer: the self-serve trial IS the proving ground.",
    "got": "authGateEnabled() = supabaseAuthConfigured() && !authBypassEnabled(). The committed .env.production and .env.vercel both set NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY, and authBypassEnabled() hard-returns false when NODE_ENV=production (env.ts:31) — so the gate is ON and cannot be turned off by env. The hero's primary CTA then renders a 'Sign in to scan' panel whose ONLY affordance is a GitHub OAuth button (ScanModal.tsx:215-227), and both scan endpoints 401 with code 'auth_required' server-side. Tomáš's file: 'a free tier that quietly needs a signup ... before it'll show him anything' — instant bounce. He never reaches the scan output that would have won him.",
    "evidence": [
      "src/lib/env.ts:24-33,55-57 — authGateEnabled composition; bypass hard-disabled in production",
      "src/app/page.tsx:81 — const gated = authGateEnabled(), passed into the hero",
      "src/components/landing/prototypes/index/ScanModal.tsx:140-142,215-227 — the `locked` branch replaces ScanForm with a sign-in wall",
      "src/lib/scan-gates.ts:77-83 — scanAuthGate returns auth_required when the gate is on and no viewer",
      "src/app/api/scan/route.ts:258-261 — 401 { code: 'auth_required' }",
      "src/app/api/scan/stream/route.ts:79-92 — same wall before the stream opens",
      ".env.production / .env.vercel (committed) — NEXT_PUBLIC_SUPABASE_URL + ANON_KEY present, ASCENT_AUTH_BYPASS absent",
      "REPRODUCTION (/tmp/uat-check.mjs, env.ts logic verbatim): authGateEnabled(prod, bypass even forced on) = true; authGateEnabled(this UAT host, dev+bypass=1) = false"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: must be checked against a host where NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY are set AND NODE_ENV=production (i.e. the real deployment, or a local prod build with the committed .env.production). The 2026-08-10 UAT host runs dev + ASCENT_AUTH_BYPASS=1, where authGateEnabled() is FALSE — this finding is NOT reproducible there and must resolve 'uncertain — not reproducible on this host', never 'refuted'. Verify live: does an anonymous visitor to the production hero see the scan input or the sign-in panel?",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-02",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "'Unlimited free public scans' is contradicted by the code in two independent ways — a 5/month cap and (in production) a login wall",
    "expected": "A pricing claim a buyer can rely on. Tomáš's file: 'Pricing that's vague or theatrical' is a listed friction trigger, and hidden conditions on a free tier are the exact pattern he screens for.",
    "got": "Three surfaces make three different, mutually inconsistent claims about the same thing. (a) plans.ts:54 lists 'Unlimited free public scans' as a Free-plan feature, rendered verbatim on /pricing (pricing/page.tsx:135-141). (b) pricing/page.tsx:100-101 says public scans are 'always free'. (c) public-scan-quota.ts:57-60 caps anonymous public scans at 5 per rolling 30 days, and the 429 body (\\u003a394-395) reads 'You've used your 5 free scans this month. Upgrade to Pro for more monthly scans, or add scan credits.' The landing FAQ JSON-LD adds a fourth phrasing — '5 scans a month free, for public or private repos' (page.tsx:56) — which contradicts (a) while agreeing with (c). plans.ts:23-24's own comment concedes the seam: 'Anonymous PUBLIC scans are never metered ... they are quota-limited separately'. 'Never metered' and 'unlimited' are not the same claim, and only one of them is on the price card.",
    "evidence": [
      "src/lib/plans.ts:54 — features: [... 'Unlimited free public scans' ...]",
      "src/lib/plans.ts:23-24 — the comment that concedes public scans ARE quota-limited separately",
      "src/app/pricing/page.tsx:100-101 — 'public scans are always free'",
      "src/app/page.tsx:56 — FAQ JSON-LD: '5 scans a month free, for public or private repos'",
      "src/lib/public-scan-quota.ts:53-60 — WINDOW_MS 30d, publicScanMonthlyLimit() default 5",
      "src/lib/public-scan-quota.ts:391-395 — the user-facing 429 copy naming the 5-scan limit",
      "REPRODUCTION (decideQuota, all branches, limit=5): prior=[] -> allowed:true remaining:4 | 4 in-window -> true | 5 in-window -> FALSE (wall) | 5 aged past 30d -> true"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: DB configured (isDbConfigured() true — the quota is a no-op without it, public-scan-quota.ts:224) and PUBLIC_SCAN_QUOTA_DISABLED unset. NOTE the 2026-08-10 UAT host sets PUBLIC_SCAN_QUOTA_DISABLED=1 in .env.local, so the wall CANNOT fire there — unset it for this check or resolve 'uncertain — not reproducible on this host'. Verify: does /pricing still read 'Unlimited free public scans' while a 6th public scan in 30 days 429s with the 'used your 5 free scans' copy?",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-03",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "time-saved",
    "title": "The scan dialog promises 'about a minute'; the app's own measured calibration says 100s–360s, and the live run took 193s — the proof step alone consumes his entire evaluation budget",
    "expected": "A latency promise the product keeps, or an honest one up front. Tomáš gives the whole evaluation two to three minutes; whatever the scan costs comes out of that.",
    "got": "ScanModal.tsx:200-201 tells him 'Paste any public GitHub repo. In about a minute, Ascent reads it and returns:' — in BOTH the gated and ungated copy branches. The app's own time model disagrees with itself two files away: scanEstimate.ts:13-16 records a MEASURED claude-cli calibration of 272/337/357/367/397/486s (median ~360s, p90 ~490s), sets HOSTED_ESTIMATE_MS = 100_000 for the production gemini path (:28), and the loading screen's own copy says 'this usually takes a few minutes' (:104). The live L2-grade scan of vercel/swr took 193s wall (usage.latencyMs 187174). At 180s — the moment his budget expires — the progress bar reads 94.6% (gemini) or 73.8% (claude-cli) and there is no report on screen. Mitigating: the waiting UI is genuinely good (6-stage provider-aware checklist, forward-only time-driven bar, escalating honest copy at 1x and 5/3x the estimate) — this is a broken PROMISE, not a broken wait.",
    "evidence": [
      "src/components/landing/prototypes/index/ScanModal.tsx:198-202 — 'In about a minute' in both branches",
      "src/components/report/scanEstimate.ts:13-16 — the measured claude-cli calibration comment (272-486s)",
      "src/components/report/scanEstimate.ts:20-30 — CLAUDE_CLI_ESTIMATE_MS 360_000, HOSTED_ESTIMATE_MS 100_000, MOCK 8_000",
      "src/components/report/scanEstimate.ts:96-105 — expectationCopy: 'this usually takes a few minutes'",
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — usage.latencyMs 187174, engine.provider claude-cli (L2-grade evidence arriving early; says nothing about how the UI rendered)",
      "REPRODUCTION (timeProgressPct verbatim): gemini est 100000ms -> 94.6% at 180s; claude-cli est 360000ms -> 73.8% at 180s"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: provider-dependent — run BOTH arms if possible. Production is LLM_PROVIDER=gemini (.env.production) => expect ~100s; the UAT host is LLM_PROVIDER=claude-cli => expect ~193-360s. Requires a repo NOT already cached (a cache hit returns instantly and would falsely refute this). Measure wall-clock from Scan click to a rendered score, and screenshot the progress bar at t=60s to check it against the modal's 'about a minute'.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-04",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No quantified customer proof anywhere in the public funnel; /about's ROI simulator is eight invented repos at a self-declared non-production weighting, unlabeled as a demo",
    "expected": "Per the B2B trust research in his references: a specific, quantified, outcome-anchored customer result ('cut audit prep from 3 weeks to 2 days at <company>'). His acceptance criterion allows the live scan output to substitute — but that substitute is only available AFTER a 100-360s wait, and (in production) only after signing in.",
    "got": "The funnel contains zero customer names, zero case studies, zero quantified outcomes and — to its credit — zero logo wall. /about's centerpiece 'ROI simulator' (the section the DeckNav labels 'ROI simulator', AboutLanding.tsx:60) computes over eight fabricated repos (RoiSimulator.tsx:21-30: web-app, api-gateway, mobile-client, design-system, billing, data-pipeline, auth-service, docs-site) using const W = 0.16, which the source itself annotates 'Deliberately NOT the production weighting ... rounded up to 0.16 so the three sliders here produce visible movement and level promotions at demo scale' (:31-36). Nothing in the rendered copy tells the visitor these repos and this weighting are illustrative. The paired feature copy promises 'Turn \"we think this will help\" into \"this moves 6 of 8 repos to L3 by Q3\"' (features.ts:43) — a number the demo manufactures. Tomáš has been burned by exactly this: 'a security scanner whose demo dazzled and whose real output was a wall of false positives.' NOT a fabrication defect — the code is honest with itself and the /org simulator it mirrors is real — but the UI does not pass that honesty to the visitor.",
    "evidence": [
      "src/components/about/RoiSimulator.tsx:21-30 — the eight invented repos",
      "src/components/about/RoiSimulator.tsx:31-36 — 'Deliberately NOT the production weighting', W = 0.16",
      "src/components/about/features.ts:43 — 'this moves 6 of 8 repos to L3 by Q3'",
      "src/components/about/AboutCost.tsx:7-12 — the problem framing is four unquantified qualitative cards",
      "src/components/about/AboutLanding.tsx:55-64 — the full /about section list: no case-study section exists",
      "src/components/landing/prototypes/index/IndexGallery.tsx:36-110 — the live register IS the substitute proof, and a good one (branch C only)"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: DB configured AND populated with public scans (branch C) — on branch A the register is absent and this finding widens to 'no proof of any kind before the scan'; on branch B it widens further (see TOMAS-L1-05). Verify live: (a) does any visible label on /about mark the ROI simulator's repos/weighting as illustrative, (b) does the rendered register carry enough recognizable repos that a buyer can spot-check a score he already has an opinion about.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-05",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "On a configured-but-empty database the landing renders a ranking table with zero rows under a '0 public repos rated' heading — reads as a dead product",
    "expected": "A page whose entire proposition is 'now it has an index' should never show an index with nothing in it. Either hide the section (as it already does when the DB is off) or show a seeded/curated set.",
    "got": "Three branches of getPublicScanGallery, enumerated — convergence is not coverage, so all three are stated. (A) !isDbConfigured() or DB unreachable -> null (scans-read.ts:785,794,803) -> IndexLanding.tsx:23 drops the section entirely AND IndexHero.tsx:31,96 drops the 'See a sample report' link: honest, but he loses both zero-commitment proofs. CLEAN. (B) DB configured, zero public scans -> the section renders with its heading, its column labels, a 'N public repos rated' counter reading 0, and the body 'No public scans yet — scan a repository below to be the first on the register' (IndexGallery.tsx:82-86). NOT CLEAN — an empty leaderboard is the strongest possible negative signal to a buyer evaluating whether anyone uses this. (C) DB configured + populated -> ranked register with provenance and freshness: the funnel's best asset. CLEAN — and this is what production serves, since .env.production carries DATABASE_URL. Note the code already handles a related sub-branch well: when topAiNative is empty but recent is not, `ranked` goes false, rank badges become '·' and the kicker swaps to 'Latest public scans' so a recency list is never numbered as a ranking (IndexGallery.tsx:42-49,95) — that branch is CLEAN and is good work.",
    "evidence": [
      "src/lib/db/scans-read.ts:782-804 — all three null paths",
      "src/app/page.tsx:72-73 — gallery + exampleRepos derivation",
      "src/components/landing/prototypes/IndexLanding.tsx:23 — section present only when gallery is non-null",
      "src/components/landing/prototypes/index/IndexHero.tsx:31,96 — sample-report link omitted when the corpus is empty",
      "src/components/landing/prototypes/index/IndexGallery.tsx:53-54,82-86 — the '0 public repos rated' + zero-row empty state",
      "src/components/landing/prototypes/index/IndexGallery.tsx:42-49,95 — the ranked/recency branch, verified CLEAN"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: requires a host with DATABASE_URL set and NO persisted public scans (branch B) — deliberately hard to reach on a seeded host. The 2026-08-10 UAT host is branch C (seeded), so this resolves 'uncertain — not reproducible on this host' unless a clean DB is stood up. Production is also branch C. LOW live frequency; recorded because trust_erosion is high on the one visitor who hits it.",
    "reachable": true,
    "scope_note": "Branch B is a fresh-deployment / post-purge state, not the steady state."
  },
  {
    "id": "TOMAS-L1-06",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "The Enterprise tier — the only tier that fits a 150-250 engineer org — has no way to reach a human; its CTA degrades to 'Learn more' → /about",
    "expected": "The one tier priced 'Custom · contact us' should let him contact someone. He is precisely the buyer that tier exists for.",
    "got": "ctaFor's enterprise branch (pricing/page.tsx:38-42) returns a real mailto ONLY when process.env.ASCENT_CONTACT_EMAIL is set. It is set in NEITHER .env.production NOR .env.vercel, so the card reads 'Custom / contact us' above a button labeled 'Learn more' that navigates to /about — a marketing page with no contact affordance. The only human-reachable link in the whole funnel is the footer's GitHub-issues link (SiteFooterCore.tsx:22), which is a bug tracker, not a sales channel. Every branch of ctaFor enumerated for an anonymous visitor: free -> {'/', 'Scan a repo free'} CLEAN; pro -> {'/onboarding','Get started'} CLEAN (a real destination); team -> {'/onboarding','Get started'} CLEAN; enterprise -> {'/about','Learn more'} NOT CLEAN. Ironically this is the mirror image of his pet peeve: not a contact-wall blocking the price, but a price with no contact behind it.",
    "evidence": [
      "src/app/pricing/page.tsx:30 — const CONTACT_EMAIL = process.env.ASCENT_CONTACT_EMAIL?.trim()",
      "src/app/pricing/page.tsx:38-42 — the enterprise branch and its /about fallback",
      "src/lib/plans.ts:101 — planPriceLabel('enterprise') -> { amount: 'Custom', cadence: 'contact us' }",
      ".env.production / .env.vercel — ASCENT_CONTACT_EMAIL absent",
      "src/components/SiteFooterCore.tsx:22 — the only human channel is the GitHub issue tracker",
      "REPRODUCTION (ctaFor, anonymous, all four branches): free->/ | pro->/onboarding | team->/onboarding | enterprise->/about 'Learn more'"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: ASCENT_CONTACT_EMAIL unset (true for both committed production env files; set it and this finding vanishes — check the live Vercel env, which may differ from the committed file). Verify live on /pricing: does the Enterprise card's button say 'Contact us' with a mailto, or 'Learn more' pointing at /about?",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-07",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "The landing deck has no pricing section, and the header comment claiming pricing lives in the deck's section nav is stale",
    "expected": "A buyer scrolling the primary marketing deck expects to hit price without leaving it. Minor, because the header nav's 'Pricing' link solves it in one click.",
    "got": "IndexLanding.tsx:19-27 defines exactly six deck sections — hero, org, fleet, [gallery], levels, dimensions — none of which is pricing, and DeckNav therefore lists none. Brand.tsx:158-159 comments 'section links (Levels / Method / Pricing) live inside the deck's right-edge section nav now, not the topbar', which is false for Pricing (and for 'Method'). A scroll-only visitor reaches the footer without ever seeing a number. Not a wall — StaticNav.tsx:53 puts Pricing in the top nav — so it costs him one click, not the decision.",
    "evidence": [
      "src/components/landing/prototypes/IndexLanding.tsx:19-27 — the six-section list",
      "src/components/Brand.tsx:158-159 — the stale comment",
      "src/components/StaticNav.tsx:50-58 — MARKETING_NAV, where Pricing actually lives"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: none (static, any environment). Verify the deck's right-edge DeckNav rendering has no pricing entry and that scrolling the full deck never surfaces a price.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-S1",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — the public scan output clears the senior bar outright: it reconciles with a repo he knows, cites countable evidence, names a specific next move, and publishes where its own scorer disagreed with its own model",
    "expected": "n/a (positive finding — this is the thing that makes the product real for this Character)",
    "got": "vercel/swr -> 47, L3 Augmented, confidence 0.85, per-dimension D1:3 D2:98 D3:76 D4:3 D5:47 D6:75 D7:79 D8:22 D9:40. The shape — world-class testing and CI, near-zero AI tooling and agentic automation — is exactly what a staff engineer who knows SWR would say, so the score RECONCILES. Evidence is countable, not hand-wavy: '138 test files', '1.04 test-to-source ratio', '0 of 8 Action references pinned by SHA', '1 of 30 recent commits', '17.6h median time-to-first-review'. The #1 roadmap item is 'no CLAUDE.md/AGENTS.md' (D1, high impact / LOW effort, levelUnlock L3->L4) with three probing questions attached — not 'add more tests'. Risk #4 catches a governance bypass ('56% of sampled merged PRs lack a recorded approving review despite a required-approval branch-protection rule'). And the report ships a discrepancies[] array in which the model ARGUES AGAINST the app's own D9 check ('the check appears not to have credited' npm OIDC trusted publishing) plus scoreIntegrity {widenedDims:['D3'], effectiveBlend:0.51}. A build that names its own seams is one this Character trusts MORE, not less. This is the strength to protect: any future edit to the report surface must preserve the discrepancy/integrity disclosure and the countable evidence lines.",
    "evidence": [
      "uat/runs/2026-08-10-ascent-first/_l2-warm-scan-swr.json — headline, strengths[], risks[], roadmap[5], discrepancies[], scoreIntegrity, dimensions[] (L2-grade evidence arriving early; it does not tell us how the UI renders any of it)",
      "src/lib/scan-score-input.ts:74-79 — the deterministic D9 battery whose number the LLM may not re-derive",
      "src/components/report/ReportView.tsx:226,257 — ReportWarnings and ReportDiscrepancies are rendered, not buried"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: LLM_PROVIDER must be a REAL provider (claude-cli on the UAT host, gemini in production) — under LLM_PROVIDER=mock the deterministic floor runs and this strength is NOT reproducible; that arm resolves 'uncertain — not reproducible on this host'. Verify live that the rendered report surfaces the evidence lines, the roadmap rationale/explore blocks, and the discrepancies section without requiring a click into a collapsed panel.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-S2",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "STRENGTH — pricing is numeric, one click from the landing page, and no tier routes an anonymous visitor into a form",
    "expected": "n/a (positive finding)",
    "got": "Per G2 2025 only ~4% of B2B products publish a price; Ascent publishes three of four tiers with a dollar figure ($0 / $10 / $20) plus per-tier scan allowances and a full operation x credit x plan ledger (CreditMatrixLedger), reachable in ONE click from the header nav. Every anonymous ctaFor branch lands on a real working destination — no 'request a quote' interstitial exists anywhere in the funnel, and the free tier's CTA is literally 'Scan a repo free'. The price cards are DERIVED from PLAN_FEATURES, the same source the entitlement layer reads, so the displayed number cannot drift from the gate (plans.ts:99-104; pricing/page.tsx:81-83) — and plans.ts:6-12 explicitly documents the one remaining drift risk (Polar is the real price book) with an automated detector at src/lib/price-drift.ts. Protect this: any future 'talk to sales' experiment on the Pro/Team cards would forfeit the single strongest conversion asset the funnel has for this Character.",
    "evidence": [
      "src/app/pricing/page.tsx:110-158 — the four cards; src/lib/plans.ts:43-92 — the single source",
      "src/lib/plans.ts:99-104 — planPriceLabel; src/app/pricing/page.tsx:81-83 — derived SEO copy",
      "src/components/StaticNav.tsx:53 — Pricing in the top nav, one click from anywhere",
      "REPRODUCTION: planPriceLabel over all four PLAN_ORDER branches -> $0 / $10 / $20 / Custom"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: none (static; DB only affects the signed-in Subscribe variant, which is out of scope for an anonymous buyer). Verify /pricing renders all four cards above the fold on a laptop viewport and that no tier opens a lead form.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-S3",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "effort",
    "title": "STRENGTH — the long scan wait is handled with unusual honesty: a provider-aware estimate, a forward-only bar, and copy that owns the delay instead of faking progress",
    "expected": "n/a (positive finding — it is the mitigation that keeps TOMAS-L1-03 at major rather than blocker)",
    "got": "SCAN_STEPS renders six named stages so the wait is a determinate-feeling checklist, and the score step is provider-aware ('Asking Claude' / 'Querying Bedrock in us-east-1' / 'Running deterministic rubric') rather than a generic spinner (ReportClientStatus.tsx:27-56). scanEstimateMs keys the curve off the RESOLVED provider from the SSE frame and defaults to the SLOWEST provider before the first frame, so resolving it can only speed the bar up — never rewind it (scanEstimate.ts:38-53). timeProgressPct asymptotes toward 95 and never claims 100 until the result lands (:76-80). expectationCopy escalates honestly at 1x and 5/3x the estimate: 'This is taking longer than usual ... Still working' (:96-105). And if the model degrades to mock, the step label switches to 'Running deterministic rubric' rather than continuing to name a provider that bailed (:57). This is the opposite of vendor theatre and it is why the wait is survivable at all.",
    "evidence": [
      "src/components/report/ReportClientStatus.tsx:27-34,37-57,68-73",
      "src/components/report/scanEstimate.ts:38-53,64-66,76-80,96-105",
      "src/components/report/ReportClient.tsx:44-46 — Loading receives live progress"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "l2_priority": "PRECONDITION: a real (non-mock) provider AND an uncached repo, so the SSE stream actually runs long enough to observe. Verify live that the checklist advances, the bar never goes backward when the provider resolves, and the >1x-estimate copy actually appears.",
    "reachable": true
  }
]
```

### Estimated time-saved

**His verbatim baseline** (from `uat/characters/tomas-prospective-buyer.md`, quoted, never re-estimated):

> "Today his honest baseline for 'is the AI investment working?' is no tool at all: a hand-rolled mix of Copilot acceptance-rate dashboards, a DX-style survey, and a spreadsheet of AI-touched-commit percentages that his peers admit doesn't show whether the AI actually helped anyone ship."

> "he's judging that entirely from the marketing plus one public scan, **in two to three minutes**, before he bounces."

**Senior bar, verbatim:**

> "the kind of repo read and maturity assessment he'd accept from a staff engineer and forward to leadership without rewriting it."

**Estimated time-saved if it all worked:** **~40 min saved on the adoption decision itself · medium confidence.** The design replaces the standard enterprise-software evaluation (demo request → scheduling → a 30–45 min sales call before you learn the price) with ~80 seconds of self-serve reading and one scan. That is the entire promise of a self-serve funnel and Ascent's is genuinely built for it.

**Estimated time-saved as it is actually configured in production:** **~0 min · high confidence.** TOMAS-L1-01 converts the self-serve funnel back into a signup gate at the exact moment he tries to use it — the very pattern the 40 minutes were saved by avoiding. The marketing half banks ~80 seconds of excellent work and then the front door asks him to authenticate.

*(The recurring value — replacing the quarterly hand-rolled scramble above — is out of scope for this journey, which judges the public funnel and one scan.)*

---

## Journey verdict

### **L1-conditional**

**Why not L1-pass:** two majors and a blocker stand between the designed experience and his acceptance criteria. Criterion 3 (frictionless no-login scan) fails outright on the deployment as configured, and criterion 6 (decide in well under three minutes) fails on every deployment because the proof step costs 100–360 s against a 2–3 minute total budget.

**Why not L1-fail:** the journey **is** structurally completable — every affordance he needs exists, is discoverable, and is one or two actions away. He answers all five questions in ~80 seconds and four actions. Pricing is numeric and unwalled. And the thing the whole verdict actually hangs on — whether the scan output is senior-grade — is not just adequate but the strongest asset in the product. The blocker is an *environment-conditional gate*, not a missing feature: flip `authGateEnabled` and the journey completes end to end.

**Carry-forward to L2:** TOMAS-L1-01 is the one that decides this journey, and it is **not reproducible on the 2026-08-10 UAT host** (dev + `ASCENT_AUTH_BYPASS=1` → `authGateEnabled = false`, executed). L2 must preflight a production-shaped host, or resolve it `uncertain — not reproducible on this host`. **If L2 confirms it live against the real deployment, this journey becomes L1-fail retroactively** — a buyer who cannot run the scan has no journey.

**Recurrence:** the brief flags "public-funnel scan forgotten on reload" (2026-07-16 #3) as a recurrence lead on this surface. It is **not re-raised here** — it sits downstream of a scan Tomáš (in production) never gets to run, and persistence is out of his 2–3 minute frame. No `recurrence` values set in this report; every finding is first-time.

### His blunt gut call

> ### **"Worth a deeper look."**
>
> — but conditionally, and the condition is the front door. If the scan had asked me to sign in before showing me anything, this would have read *"this is a demo, not a product"* and I'd have closed the tab without ever seeing the output that changed my mind.

---

## Tomáš's first-person review (L1 — over the *designed* experience)

Okay. Two minutes. Let's see.

Headline says it reads a GitHub repo and scores it 0–100 across nine weighted dimensions, with the evidence behind every number. That's a claim I can check. No "platform." No "synergy." Good start.

**What does it cost?** Top nav, one click, four cards. Zero, ten, twenty, custom. Actual numbers. Do you know how rare that is? I've sat through a dozen of these and most of them make me fill in a form to learn whether I can afford the conversation. This one just tells me. That bought them about ninety more seconds of my attention than they'd otherwise have had.

**Did anything read as a wall?** Yes. One, and it's the important one.

The whole page is built right — the big button says *Scan a repository*, not *Book a demo*. That's the correct instinct and somebody there understands who they're selling to. But on the deployment they actually ship, that button opens a panel that says *"Scanning is for signed-in members on this deployment"* and hands me a GitHub OAuth button. So the free public scan — the thing the pricing page calls *unlimited*, the thing the FAQ calls free, the thing the whole design is pointed at — asks me to authenticate first.

I don't sign in to evaluate. That's not stubbornness, it's the reflex I built after the last three vendors. If I have to hand over an OAuth grant to find out whether the tool is real, I assume the tool isn't confident it is. **That's the tab closing.** And the thing that kills me is what's on the other side of it.

Because I *did* see the other side. Someone ran it on `vercel/swr`. Forty-seven. L3. Testing at 98, CI at 76 — and AI tooling at 3, agentic at 3. That's not a generic score, that's *correct*. That's what SWR is: a beautifully disciplined traditional OSS project that has done essentially nothing AI-native. And it doesn't just say so, it counts: 138 test files, 1.04 test-to-source ratio, zero of eight Actions pinned by SHA, one AI-involved commit out of thirty. Then it tells me 56% of merged PRs have no approving review on record *despite* a branch rule requiring one, and calls it a probable bypass path. I have engineers who wouldn't catch that.

And the top recommendation isn't "improve CI." It's "there's no CLAUDE.md or AGENTS.md — high impact, low effort, unlocks L3 to L4," with three questions attached about what an agent would need to know before touching the cache logic. That's a staff engineer's read. **Would I forward that to leadership as-is? Yes.** Without rewriting it. That's the highest thing I say about anything.

The part I respect most is the smallest: the report ships a *discrepancies* section where the model argues against the app's own security check — says the D9 grader missed npm OIDC trusted publishing. They published the place where their own two scorers disagreed. Every vendor I've bought from would have hidden that. It's the reason I'd take this number into a room and defend it.

**So what's actually wrong.**

The dialog told me *"in about a minute."* Their own code says a hundred seconds on the fast provider and a measured median of six minutes on the slow one, and the live run took three minutes and thirteen seconds. Three minutes *is* my whole evaluation. So the promise isn't a rounding error — it's the entire budget, missed by 3x. The waiting screen itself is excellent, genuinely — it names the stage, names the model it's asking, and after a while it says "this is taking longer than usual" instead of pretending. Which makes the "about a minute" in the dialog worse, not better, because somebody there clearly *knows*.

Then: *"Unlimited free public scans"* on the price card, and five-a-month in the code with a 429 that says "you've used your 5 free scans this month, upgrade to Pro." Two different numbers, one of them on the thing I'm supposed to buy from. It's small and it's the kind of small that makes me re-read everything else.

And the Enterprise card. I'm a hundred and fifty engineers; that's my tier. It says *Custom · contact us*, and the button under it says **Learn more** and takes me to the About page. There's no address, no form, no calendar. The only human channel on the entire site is a GitHub issue tracker. So the one wall I expected — price behind a form — isn't there, and instead I've got the inverse: a price I can't act on. If I'd made the decision to buy at minute three, I would have had nowhere to go.

Last one: the ROI simulator on the About page. Eight repos with names like `web-app` and `billing`, sliders, promotions ticking up. Their own source says the weighting is deliberately not the production one, chosen so the demo shows visible movement. Nothing on screen says that. I've been sold by a dazzling demo before and I've paid for it. Take it out or label it — the register of real repos two scrolls up on the homepage does more for you than that simulator ever will, because I can check it against a repo I already have an opinion about.

**Who would I loop in?** If I got past the sign-in wall: my platform lead, same week. She owns our internal standards and she'd care about the nine dimensions and about what "governed" scores mean before she puts a gate in CI. Then, if she came back positive, our security lead for the D9 battery — that's the piece that survives a compliance conversation.

If I *didn't* get past the wall — nobody. I'd have forgotten the name by Thursday.

Which is the whole thing, really. They built the hard part — a scan I'd stake my name on — and then put a login in front of it. Fix the front door and I'll spend a real afternoon on this.

*— "huh. That's actually not wrong."*
