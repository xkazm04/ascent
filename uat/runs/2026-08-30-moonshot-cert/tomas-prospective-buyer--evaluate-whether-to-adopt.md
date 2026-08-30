# Tomáš (prospective buyer) × `evaluate-whether-to-adopt` — L1 (theoretical, code-grounded)

- **Run:** `2026-08-30-moonshot-cert` · pair #3 · L1 phase, no browser
- **Character:** `uat/characters/tomas-prospective-buyer.md` — Director of Engineering, economic buyer, **two to three minutes, then the tab closes**
- **Journey:** `uat/journeys/evaluate-whether-to-adopt.md`
- **Rubric:** `uat/rubric.md` · **Accepted gaps:** `uat/accepted-gaps.md` (empty — nothing suppressed)
- **Grounding denominator:** `uat/env.md` §Grounding **Surface A**, scored verbatim, denominator unchanged
- **Prior outing:** `uat/runs/2026-08-10-ascent-first/tomas-prospective-buyer--evaluate-whether-to-adopt.md` (TOMAS-L1-01…07, S1…S3)
- **Brief leads treated as HYPOTHESES:** B2 (public scan un-walled), B8 (quota promise), B10 (ETA copy), r11 D1 coherence, B5 permalink, G8 pricing honesty. Two are confirmed fixed, one is confirmed **half-fixed**, one is confirmed **still open**.

---

## sources

Files read for the surface model (line ranges cited inline):

**Landing + funnel**
- `src/app/page.tsx:1-140` — route, FAQ JSON-LD, gallery, `auth`/`gated`/`selfHosted`/`setup` resolution
- `src/components/landing/prototypes/IndexLanding.tsx:16-39` — the seven-section deck list (`local` is new)
- `src/components/landing/prototypes/index/IndexHero.tsx:26-172` — H1, lede, **open-source identity line**, three CTAs, preview links, stat ledger
- `src/components/landing/prototypes/index/ScanModal.tsx:28-280` — the primary CTA's dialog and its three gate states
- `src/components/landing/prototypes/index/IndexGallery.tsx:36-120` — the live register + its new empty state
- `src/components/QuotaMeter.tsx:1-86` — the "N of M free scans left this month" meter, rendered inside that dialog
- `src/components/StaticNav.tsx:50-58` · `src/components/SiteFooterCore.tsx:11-33` — the nav sets
- `src/lib/site.ts:100-137` — `SOURCE_REPO_URL`, `sourceRepoHref`, `FEEDBACK_URL`

**Gates**
- `src/lib/env.ts:14-17,100-163` — `envBool`, `selfHosted`, `selfHostedExplicit`, `supabaseAuthConfigured`, `authBypassEnabled`, `publicScanSignInRequired`, `authGateEnabled`
- `src/lib/scan-gates.ts:66-102` — `scanRateLimitGate`, **`scanAuthGate` with the new public-funnel exemption**
- `src/lib/public-scan-quota.ts:41-65,140-165,200-300,355-400` — the window, both limits, the kill switch, the 429 copy
- `.env.production` / `.env.vercel` (committed) · `.env.example:28,166,362` · `.env.local` (host, gitignored)

**Pricing**
- `src/app/pricing/page.tsx:1-228` · `src/app/pricing/pricingCta.ts:1-49` · `src/components/pricing/PlanEnquiryCta.tsx:1-80` · `src/components/pricing/SelfHostBand.tsx:70-105`
- `src/lib/plans.ts:190-320` — `PLAN_SPECS`, `planPriceLabel`, `planScanLine`

**Report / scan output**
- `src/app/report/page.tsx:1-24` · `src/components/report/ColdScanGate.tsx:1-70` · `src/components/report/ColdScanTeaser.tsx`
- `src/components/report/scanEstimate.ts:1-120` — the estimate constants and **`scanDurationClaim()`**
- `src/components/report/useReportScan.ts:200` — the only client-side auth branch on the scan path
- `src/lib/maturity/model.ts:90-137` — the r10 → r11 → **r12** rubric log
- `src/lib/scan-score-input.ts:50-210` — everything that reaches `LlmScoreInput`
- `src/lib/register/data.ts:1-120` — `RegisterEntry`, the register's two invariants
- `src/app/leaderboard/page.tsx:1-130` · `src/app/scorecard/[owner]/page.tsx:1-60`

**Proof surfaces**
- `src/components/about/AboutLanding.tsx:50` · `src/components/about/RoiSimulator.tsx:21-36,79-97` · `src/components/about/features.ts:40`

**Wiring greps executed** (a zero-hit is a finding by construction):
- `grep -rn "publicScanSignInRequired" src/components src/app/page.tsx` → **0 hits**
- `grep -rn "rubricVersion" src/lib/register src/components/leaderboard` → **0 hits**
- `grep -rn "NEXT_PUBLIC_SOURCE_REPO_URL" .env.production .env.vercel` → **0 hits**
- `grep -rn "PUBLIC_SCAN_WEEKLY_LIMIT" src/` → **0 hits** (it exists only in `.env.example` and `.env.production`)

---

## Reachability set — resolved BEFORE judging

Tomáš is **anonymous** and never signs in. That is the whole journey, so the gate arithmetic is the surface model, not a footnote.

### The gate arithmetic, both halves

| Layer | Predicate | Production value | Consequence for Tomáš |
|---|---|---|---|
| **Server** (`/api/scan`, `/api/scan/stream`) | `scanAuthGate` — `if (opts.publicScan && !publicScanSignInRequired()) return PASS` (`scan-gates.ts:99`) | `ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN` unset → **PASS** | **B2 shipped.** An anonymous public scan is permitted. |
| **Client** (landing hero dialog) | `gated = authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()` (`page.tsx:100`, `env.ts:161`) | Supabase keys present in `.env.production` + `.env.vercel`; bypass hard-off in prod → **gated = true** | `locked` → the **"Sign in to scan"** panel (`ScanModal.tsx:146,224-236`). |

**The two halves disagree, and the client half is the one Tomáš meets.** B2 unwalled the endpoint and left the door in front of it locked. This is the run's headline.

**Reachable, in scope:** `/` (hero · org · fleet · **local** · [gallery] · levels · dimensions) · `/pricing` · `/about` · `/about-org` · `/leaderboard` · **`/scorecard/[owner]`** (new, and the best-shaped asset for a buyer) · `/report/[owner]/[repo]` permalinks · `/report?repo=…` (**un-walled — see TOMAS-L1-08**) · `/privacy`, `/terms` · the footer feedback link.

**Out of scope per the journey (never reported as missing):** `/org/*`, `/trends`, `/usage`, org rollups, the loop/drive surfaces (self-hosted-gated), Polar checkout.

**Retired since the last outing:** `/connect` and `/badge` are deleted from the tree (`git status`: `D src/app/connect/page.tsx`, `D src/app/badge/page.tsx`). Neither was on his path; no finding.

### ⚠ L2 PRECONDITION — the overlay's own convenience flags destroy this Character's anonymity, and hide three of my four top findings

`uat/env.md` pins a `.env.local` whose flags each independently make one finding invisible. Read on the host:

| Flag (`.env.local`) | Effect on this journey | Which finding it hides |
|---|---|---|
| `ASCENT_AUTH_BYPASS=1` (line 33) | `authBypassEnabled()` true → `authGateEnabled()` **false** → `gated=false` → the dialog renders **ScanForm**, not the wall. Also `getViewer()` returns a synthetic *developer* — **Tomáš is not anonymous on this host.** | **TOMAS-L1-01** (invisible) |
| `PUBLIC_SCAN_QUOTA_DISABLED=1` (line 19) | `consumePublicScanQuota` no-ops, `/api/quota` reports `enforced:false`, `QuotaMeter` returns `null` (`QuotaMeter.tsx:55`) | **TOMAS-L1-02** (invisible) |
| `ASCENT_SELF_HOSTED=1` (line 58) | `/pricing` short-circuits to `SelfHostPricingBlueprint` (`pricing/page.tsx:87-97`) — **the four cloud price cards never render**, and the landing swaps its third CTA and pitch (`IndexHero.tsx:110-118`) | **the entire pricing-transparency criterion** is untestable |

**Therefore: Tomáš's L2 walk MUST be run with `ASCENT_AUTH_BYPASS` OFF (unset, not `0`), `PUBLIC_SCAN_QUOTA_DISABLED` unset, and `ASCENT_SELF_HOSTED=0`, against a production-shaped build (`NODE_ENV=production`, Supabase keys present).** A driver that runs the standard UAT recipe will report this journey as clean and will be wrong about all three. Any finding below that cannot be reached under the flags actually set resolves `uncertain — not reproducible on this host`, never `refuted`.

---

## Grounding score — Surface A (repo scan scoring + its roadmap field)

Scored verbatim against `uat/env.md` §Grounding Surface A, for the path this Character takes: an **anonymous public scan**.

`TECH_STACK_PROMPT` is absent from `.env.example`, `.env.local`, `.env.production` and `.env.vercel` → `techStackPromptEnabled()` false (`scan-score-input.ts:190`) → **item 7 excluded, denominator 11**.

### **Surface A grounding: 10 / 11** *(unchanged from 2026-08-10 — the ruler held across the moonshot)*

| # | Source | Reaches the prompt? | Evidence |
|---|---|---|---|
| 1 | Rubric — levels, weighted dimensions, criteria | ✅ | `prompt.ts` rubric block; `model.ts` (now **r12**) |
| 2 | Task/output contract + auditor role | ✅ | `prompt.ts` |
| 3 | Repo metadata | ✅ | `scan-score-input.ts:169` (`repo: snapshot.meta`) |
| 4 | Archetype | ✅ | `scan-score-input.ts:141,173` |
| 5 | Standing org decisions + rationale | ❌ | `scan-score-input.ts:157-159` — `decisionSlug` is absent on an anonymous public scan → `orgDecisions = []` → `:174` omits the key. **Structurally unavailable to this Character.** |
| 6 | Stack-fit caveat | ✅ | `scan-score-input.ts:146,187` |
| 7 | Detected tech stack | — | **flag off** (`:190`) → excluded from the denominator |
| 8 | Deterministic per-dimension signals + evidence | ✅ | `scan-score-input.ts:170` |
| 9 | PR stats | ✅ | `scan-score-input.ts:178` |
| 10 | Branch governance | ✅ | `scan-score-input.ts:179` |
| 11 | Security D9 battery | ✅ | `scan-score-input.ts:112-135,184` |
| 12 | Untrusted repo evidence — commits + file excerpts | ✅ (capped) | `scan-score-input.ts:171-172` |

**Named additions (never a denominator change):**
- *+ craft ladder (`craftBuilt`, r12) — present in the type, absent for him.* `scan-score-input.ts:165-167` also keys it on `decisionSlug`, so an anonymous scan omits it (`:177`). Same shape as item 5: the loop's memory is org-scoped, and the public funnel has no org.
- *+ peer-cohort / benchmark percentile — absent.* He is answering "is the AI spend paying off?"; a score with no comparison class is a number he can't take upstairs. Partly answered off-prompt now by `/scorecard/[owner]` and the register.
- *+ prior scan / trend for the same repo — absent.*

**What r11 changed inside the denominator (not the count, the quality of item 1 + 8).** D1 stopped summing five instruction-file **formats** on presence and now pays `22 + round(18 × coherence/100)` off the guidance arbiter's deterministic read (`model.ts:98-113`; `analyze/guidance-graph.ts`), and D1 **joined `CLAIM_SCORED_DIMENSIONS`** — the model's D1 number is recorded and ignored, and its judgment reaches the score only through citations verified against files the arbiter actually found. **D1 is now fully reproducible.** For Tomáš that is a genuine upgrade to the one dimension his own repos would score worst on, and it is the difference between "the tool rewarded us for having four contradicting CLAUDE.md copies" and "the tool read them and told us they disagree." Recorded as a **strength** (S1), not a finding.

**The 22 KB cap verdict from 2026-08-10 stands unchanged** and I re-derived it rather than inheriting it: `OUTER = 22000` of `MAX_TOTAL_BYTES = 280_000` ingested (7.9%), but six of the eleven live sources are deterministic facts computed over the **full** 280 KB and handed to the model as facts. The model narrates a computed signal set; it does not read 8% of the repo and guess. The pitch survives.

---

## The two-minute walkthrough — in character

> *Between meetings. Peer said "Ascent". Two minutes. Anonymous, no account, and I'm not making one.*

**0:00–0:12 · Landing, no action.** *"Every engineering org has a maturity. Now it has an index."* Then the lede: reads a GitHub repository, rates how AI-native the engineering is, 0–100, five levels, nine weighted dimensions, evidence behind every number (`IndexHero.tsx:74-80`). And a line under it I did not expect: **"Open source under AGPL-3.0. Run it yourself with any model — including the Claude subscription you already pay for. The cloud plans buy operation, not capability."** (`:85-89`). That is a stronger claim than anything on the page, because it is the only one I can check for free. ✅ **what it is.**

**0:12–0:16 · Still no action.** Three buttons: *Scan a repository*, *Scan your whole org*, *Open source · run it yourself*. No "Book a demo" anywhere. ✅ **next step.**

**0:16 · I click the open-source CTA first.** It goes to **`/pricing#self-host`** — a band on the pricing page — not to a repository. `sourceRepoHref()` returns null because `NEXT_PUBLIC_SOURCE_REPO_URL` is unset in both committed production env files (`site.ts:110-119`; grep of `.env.production`/`.env.vercel` = 0 hits), and the self-hosting guide degrades to the *string* `docs/SELF-HOSTING.md` with nowhere to click (`SelfHostBand.tsx:80-97`). So the biggest claim on the masthead has no address. **TOMAS-L1-10.**

**0:20–0:55 · Scroll.** "Index the whole organization" — executive rollup, governance, AI adoption, delivery, supply chain. That's my page. Then the local-loop section. Then **the register**: real repos, ranked, per-dimension columns, *"Served live from …"* with a freshness stamp (`IndexGallery.tsx:52-65`). This is the proof. ✅ **who it's for**, ✅ **does it work** (conditionally — see the branch table).

**0:55–1:15 · Header → Pricing.** $0 · $5 Starter · $10 Team · Flexible/Custom, with per-tier scan lines and a full credit ledger. Above the cards, before anything is sold, a band that says the software is AGPL and free to self-host. No form. ✅ **cost** — and this is where "I've heard this pitch before" starts to flip. But the Free card's bullets say **"Unlimited free public scans."** Hold that thought.

**1:15 · Back to `/`. Click "Scan a repository."** The dialog opens and says:

> **Sign in to scan.** *Scanning is for signed-in members on this deployment. Sign in with GitHub to run your scan.*

That is the tab closing. Verbatim from my own file: *"a free tier that quietly needs a signup before it'll show me anything."* **TOMAS-L1-01.**

**And here is what makes it worse rather than better.** The server would have let me. `scanAuthGate` returns `PASS` for a public scan unless an operator opts back in (`scan-gates.ts:99`), which nobody has. The un-walled path is two URLs away and the app *says so on it*: `/report/vercel/next.js` renders a card reading *"It's free for public repositories and needs no account"* with a working **Scan now** button (`ColdScanGate.tsx:52-60`), and `/report?repo=…` has no gate at all (`report/page.tsx:13-23`). So the wall on the front door protects nothing, blocks nobody who knows the URL, and only ever costs the vendor the one visitor who does not. **TOMAS-L1-08.**

**1:20 · (counterfactual — the ungated path) the wait.** The dialog no longer lies about it: `scanDurationClaim()` prints *"under 2 minutes on hosted inference, about 6 minutes when it runs against a local CLI"*, derived from the same constants the progress bar runs on (`scanEstimate.ts:83-105`; `ScanModal.tsx:207-211`). The "about a minute" of the last outing is gone. **B10 fixed.** Still ~100 s of my 180 s budget on the hosted path — expensive, but honestly priced.

**Meanwhile, in that same dialog:** under the repo input, the meter reads **"5 of 5 free scans left this month"** (`QuotaMeter.tsx:65`). Four minutes after the price card told me public scans are *unlimited*. **TOMAS-L1-02 — unchanged from the last outing, and now the contradiction is two panels apart instead of two pages.**

---

## Scored acceptance criteria (judged identically every run)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | State what / who-for / does-it-work / cost / next-step after ~2–3 min | **PASS** | All five in ~75 s and four actions. "Does it work" is data-conditional (branch table below). |
| 2 | Pricing transparent — numbers, no contact-sales wall | **PASS** | `planPriceLabel` over `PLAN_ORDER` → `$0 / $5 / $10 / Flexible`; one click from the header (`StaticNav.tsx:52`); no tier routes an anonymous visitor into a form (`pricingCta.ts:33-48`). The Custom tier now opens a real enquiry dialog instead of dead-ending on `/about` — **TOMAS-L1-06 fixed.** |
| 3 | Primary CTA is a frictionless look — public scan, **no login**, obvious front door | **FAIL (production)** | The *design* is right and the *server* is right. The dialog is not: `gated = authGateEnabled()` alone (`page.tsx:100` → `ScanModal.tsx:146`). **TOMAS-L1-01.** |
| 4 | Run one public scan and the output is senior-grade | **PASS (output) / blocked (reaching it via the front door)** | Grounding 10/11 with six deterministic full-corpus sources; r11 makes D1 reproducible and claim-scored. The 2026-08-10 live `vercel/swr` JSON remains the strongest artefact in this file's history. |
| 5 | Credible proof — quantified customer result **or** the scan output itself | **PASS (second limb only)** | Zero customer names, zero case studies, zero quantified outcomes, zero logo wall. `/about`'s ROI simulator is still eight invented repos at a self-declared non-production weighting with **no visible label** (`RoiSimulator.tsx:21-36`; no illustrative caption in the render at `:79-97`). Carried entirely by the register + the scan. **TOMAS-L1-04 recurs.** |
| 6 | Time-saved — decide in well under three minutes | **CONDITIONAL PASS** | The marketing half now answers all five questions in ~75 s. The proof half costs ~100 s hosted — but it is finally *advertised* as costing that, so the budget is spent knowingly rather than overrun. Upgraded from FAIL. **B10 closed.** |
| 7 | Senior-quality — he'd forward the report to leadership as-is | **PASS** | Unchanged, and strengthened by r11's reproducible D1 and by the register's refusal to rank mock-engine scans (`register/data.ts:12-17`). |

**Score: 6 pass (one conditional) / 1 fail.** The single fail is the one that ends the journey.

### The DB-state branch table (all branches enumerated — convergence is not coverage)

| Branch | What he sees | Verdict |
|---|---|---|
| **A. `DATABASE_URL` unset / DB down** | `gallery = null` → the register section is **absent from the deck** (`IndexLanding.tsx:23`) and `sampleRepo` is null → the "See a sample report" link is omitted (`IndexHero.tsx:31,143`). | Honest, but both zero-commitment proofs are gone. Marketing copy only. |
| **B. DB configured, zero public scans** | The section renders with its heading, a **"0 public repos rated"** counter, column labels, and — new since the last outing — an explicit *"No public scans yet. Scan a repository below to be the first on the register."* (`IndexGallery.tsx:82-87`). | **Improved.** The bare zero-row table is gone; the "0 … rated" counter under a section called "The register" still reads thin. Downgraded to polish (TOMAS-L1-05). |
| **C. DB configured + populated — production** | Ranked register with provenance and freshness; mock-engine scans drawn separately and never ranked. | The funnel's best asset — and the substrate for TOMAS-L1-11. |

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
    "recurrence": "TOMAS-L1-01 (2026-08-10) — SERVER HALF FIXED, CLIENT HALF NOT. Re-raised with a changed shape and a one-line fix.",
    "title": "B2 un-walled the public scan endpoint and left the landing dialog locked: the hero's primary CTA still shows an anonymous buyer 'Sign in to scan' on a deployment whose server would have run the scan",
    "expected": "The moonshot's own stated intent, verbatim from the code that shipped it: 'THE ANONYMOUS PUBLIC FUNNEL IS EXEMPT BY DEFAULT … the product left open every surface that would not convince a buyer and walled the single one that would, under a page promising \"no signup\"' (scan-gates.ts:78-84). An anonymous visitor should paste a repo and get a report. This is this Character's #1 acceptance criterion and his stated instant-bounce trigger.",
    "got": "The fix landed on the server only. scanAuthGate now returns PASS for a public scan unless ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN is set (scan-gates.ts:99; the flag is unset in .env.example, .env.production and .env.vercel). But the landing still computes its lock from the OLD predicate: page.tsx:100 `const gated = authGateEnabled()` → IndexHero.tsx:96 → ScanModal.tsx:146 `const locked = gated && signedIn === false` → the ScanForm is replaced by a panel headed 'Sign in to scan' whose only affordance is a GitHub OAuth button (:224-236). authGateEnabled() = supabaseAuthConfigured() && !authBypassEnabled(); both committed production env files set NEXT_PUBLIC_SUPABASE_URL + ANON_KEY, and authBypassEnabled() hard-returns false in production (env.ts:113-116), so the wall is ON and cannot be lifted by env. WIRING AUDIT: `grep -rn publicScanSignInRequired src/components src/app/page.tsx` → 0 hits. The predicate the server now gates on has no client reader at all — the exact present-but-unwired shape a 30-lane merge produces. The fix is one expression: pass `gated && publicScanSignInRequired()` (or a server-resolved `scanLocked`) instead of `gated`.",
    "evidence": [
      "src/lib/scan-gates.ts:78-84,94-102 — the public-funnel exemption and the reason it shipped",
      "src/lib/env.ts:142-152 — publicScanSignInRequired(), default off",
      "src/app/page.tsx:98-100 — `const gated = authGateEnabled()`, still the only thing passed down",
      "src/components/landing/prototypes/index/IndexHero.tsx:96 — <ScanModal … gated={gated} />",
      "src/components/landing/prototypes/index/ScanModal.tsx:144-146,224-236 — the `locked` branch and the sign-in panel copy",
      "src/lib/env.ts:113-116,161-163 — authBypassEnabled hard-off in production; authGateEnabled composition",
      ".env.production / .env.vercel (committed) — NEXT_PUBLIC_SUPABASE_URL + ANON_KEY set; ASCENT_REQUIRE_SIGNIN_FOR_PUBLIC_SCAN absent",
      "WIRING GREP: grep -rn \"publicScanSignInRequired\" src/components src/app/page.tsx → 0 hits"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "P0. PRECONDITION — MUST be walked with ASCENT_AUTH_BYPASS **OFF** (unset, not '0'; the .env.local at uat/env.md line 33 sets it to 1, which makes authGateEnabled() false, gated=false, and the wall INVISIBLE). Requires NODE_ENV=production (a prod build, or the real deployment) AND NEXT_PUBLIC_SUPABASE_URL + ANON_KEY set. Under the standard UAT recipe this resolves 'uncertain — not reproducible on this host', never 'refuted'. Verify: as a signed-out visitor, click the hero's 'Scan a repository' — does the dialog show the repo input or the 'Sign in to scan' panel? Then POST /api/scan with a public repo and no cookie and confirm it returns 200, proving the two halves disagree.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-08",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The wall the hero renders guards nothing — /report?repo= and the cold-permalink gate run the same anonymous public scan un-walled, and one of them tells him in writing that no account is needed",
    "expected": "One answer to 'do I need an account to scan a public repo?', given on every surface that answers it. Whatever the answer is, the highest-intent surface should not give the opposite one.",
    "got": "Three public surfaces, two answers. (a) The hero dialog: 'Scanning is for signed-in members on this deployment' (ScanModal.tsx:229-232). (b) The cold-permalink gate at /report/{owner}/{repo}: \"It's free for public repositories and needs no account\", above a working 'Scan now' button that mounts ReportClient and runs the live scan (ColdScanGate.tsx:52-63). (c) /report?repo=owner/name: no gate of any kind — the page mounts ReportClient unconditionally (report/page.tsx:13-23), and the only auth branch anywhere on the client scan path is a 401 HANDLER that the server no longer produces for public scans (useReportScan.ts:200). Since scanAuthGate exempts public scans (scan-gates.ts:99), (b) and (c) both succeed anonymously in production. So the wall is not a security control, not a cost control (the burst limiter and the monthly quota both sit outside it and are unaffected — scan-gates.ts:35-36,83-84), and not a signup funnel — it is a bounce generator that costs the vendor exactly the visitors who trust the front door. For this Character it is worse than a consistent wall: a wall he can route around by guessing a URL reads as carelessness about the thing they are asking him to pay for.",
    "evidence": [
      "src/components/landing/prototypes/index/ScanModal.tsx:229-232 — 'Scanning is for signed-in members on this deployment'",
      "src/components/report/ColdScanGate.tsx:47-63 — 'free for public repositories and needs no account' + the working Scan now button",
      "src/app/report/page.tsx:13-23 — ReportClient mounted with no gate",
      "src/components/report/useReportScan.ts:200 — the vestigial 401/auth_required handler",
      "src/lib/scan-gates.ts:83-84 — 'The cost ceiling for the anonymous funnel is unchanged and does not depend on this flag'"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "P0, same environment as TOMAS-L1-01 (bypass OFF, production-shaped). Walk both doors in one session as one anonymous visitor: (1) hero CTA → expect the sign-in panel; (2) navigate directly to /report/{a-repo-with-no-persisted-scan} → expect the 'needs no account' card and click Scan now → expect a running scan. Two contradictory answers in one session is the finding. Requires a repo with NO persisted scan (a cache hit would bypass ColdScanGate entirely and prove nothing).",
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
    "recurrence": "TOMAS-L1-02 (2026-08-10) — STILL OPEN, and the two contradicting statements are now two panels apart instead of two pages. B8 is NOT closed.",
    "title": "'Unlimited free public scans' and 'always free and unmetered' are still on the price card and the landing FAQ while a meter in the scan dialog counts down 5 — and the 429 upsells a tier ('Pro') that no longer exists in the UI",
    "expected": "One number for the free public allowance, stated the same way everywhere. Vague or theatrical pricing is a listed friction trigger for this Character, and hidden conditions on a free tier are the exact pattern he screens for.",
    "got": "Four surfaces, three claims. (a) plans.ts:212 lists 'Unlimited free public scans' in the Free tier's extras, rendered verbatim on /pricing (pricing/page.tsx:183-189). (b) page.tsx:79 (landing FAQ JSON-LD, a rich-result answer Google may quote): 'public scans are always free and unmetered'; pricing/page.tsx:4,77 repeats 'always free and unmetered'. (c) public-scan-quota.ts:41-48: a rolling 30-day window, publicScanMonthlyLimit() default 5. (d) QuotaMeter.tsx:65 renders '<remaining> of <limit> free scans left this month' INSIDE the scan dialog itself, directly under the repo input — so on a first visit the same modal that the /pricing card calls unlimited says '5 of 5'. 'Unmetered' is not merely imprecise here; a meter is rendered. Two further edges: the 429 copy reads 'You've used your 5 free scans this month. Upgrade to Pro for more monthly scans' (public-scan-quota.ts:369) — but the tier stored as `pro` is DISPLAYED as 'Starter' everywhere a buyer can see it (plans.ts:216-217), so the upsell names a plan that does not appear on the pricing page; and pricing/page.tsx:218 says allowances 'reset on the 1st of each month (UTC)' while the public funnel's window is a ROLLING 30 days from the first hit (public-scan-quota.ts:41,147).",
    "evidence": [
      "src/lib/plans.ts:212 — extras: ['Unlimited free public scans', …]",
      "src/app/page.tsx:79 — FAQ JSON-LD 'public scans are always free and unmetered'",
      "src/app/pricing/page.tsx:4,77,218 — 'always free and unmetered' + 'resets on the 1st of each month (UTC)'",
      "src/lib/public-scan-quota.ts:41-48 — WINDOW_MS 30d, default limit 5",
      "src/lib/public-scan-quota.ts:365-369 — the 429 copy naming 'Pro'",
      "src/lib/plans.ts:214-217 — the stored id `pro` is shown as 'Starter'",
      "src/components/QuotaMeter.tsx:55,65 — 'N of M free scans left this month', rendered in the hero dialog",
      "MITIGATING (recorded, does not clear the finding): ScanModal.tsx:262-266's consent copy is honest — 'public scans are free (rate-limited, with a monthly cap)'. One truthful sentence in small type does not repair a headline bullet that says 'Unlimited'."
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "P1. PRECONDITION: DB configured (isDbConfigured() true — the quota is a no-op otherwise) AND `PUBLIC_SCAN_QUOTA_DISABLED` UNSET (the .env.local at uat/env.md line 19 sets it to 1, which makes QuotaMeter render nothing and hides the contradiction) AND `ASCENT_SELF_HOSTED=0` (self-hosted swaps /pricing for SelfHostPricingBlueprint, so the 'Unlimited' bullet never renders). Verify in ONE session: screenshot the /pricing Free card's bullet list, then the hero dialog's meter line. Optionally exhaust the allowance to capture the 429 copy and check whether it says 'Pro' or 'Starter'.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-10",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The hero promotes 'Open source under AGPL-3.0 — run it yourself' to a co-primary claim with its own CTA, but production names no repository, so the one claim this buyer could verify for free has no address anywhere in the funnel",
    "expected": "A one-click path to the source. Per this Character's references, the evaluator ranks 'test it in my environment' and 'high-quality docs' above a sales conversation — and on an AGPL product the repository IS the proving ground that costs the vendor nothing. AGPL §13 also entitles a deployment's users to its source, which the code itself notes (site.ts:100-108).",
    "got": "SOURCE_REPO_URL = process.env.NEXT_PUBLIC_SOURCE_REPO_URL || null (site.ts:110-111), with a DELIBERATE no-default so a fork never ships a dead link — correct reasoning. But NEXT_PUBLIC_SOURCE_REPO_URL appears in NEITHER .env.production NOR .env.vercel (grep: 0 hits; it exists only as a commented example at .env.example:28). So on the deployment as configured, sourceRepoHref() is null everywhere and all four consumers degrade at once: the hero's third CTA, 'Open source · run it yourself', becomes a link to /pricing#self-host (IndexHero.tsx:119-126); SelfHostBand's 'Self-hosting guide →' becomes the plain TEXT 'docs/SELF-HOSTING.md' with nothing to click (SelfHostBand.tsx:88-97); IndexLocal's guide link and the onboarding panel's degrade the same way. Meanwhile the hero prints the AGPL claim in bold as a co-primary identity line (IndexHero.tsx:85-89) and /pricing leads with a whole self-host band above the price cards. The claim is louder than it has ever been and the evidence is now zero clicks reachable. NOT a fabrication — the software really is AGPL and really is in a repo — but every degrade path is individually well-reasoned and their SUM is a marketing page making an unverifiable claim, which is the composition failure no single file's comment can see.",
    "evidence": [
      "src/components/landing/prototypes/index/IndexHero.tsx:85-89 — the co-primary AGPL identity line",
      "src/components/landing/prototypes/index/IndexHero.tsx:110-126 — the third CTA and its /pricing#self-host fallback",
      "src/lib/site.ts:100-119 — SOURCE_REPO_URL, the no-default reasoning, sourceRepoHref",
      "src/components/pricing/SelfHostBand.tsx:80-97 — the guide CTA degrading to plain text",
      "WIRING GREP: grep -rn \"NEXT_PUBLIC_SOURCE_REPO_URL\" .env.production .env.vercel → 0 hits (present only at .env.example:28, commented)",
      "src/lib/site.ts:134-137 — FEEDBACK_URL DOES fall back to upstream, so the footer 'Feedback' link is the only GitHub address in the funnel — an issue tracker, not the source"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "P1. PRECONDITION: a host where NEXT_PUBLIC_SOURCE_REPO_URL is UNSET (true of both committed production env files; the live Vercel project may differ from the committed file — check the deployment's real env before resolving). Note this is a BUILD-TIME inlined NEXT_PUBLIC_ var, so it must be absent at build, not just at runtime. Verify: on the landing, does 'Open source · run it yourself' navigate to a repository or to /pricing#self-host? On /pricing, is 'Self-hosting guide' a link or plain text? Fix is one env var, not code.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-11",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "The public register ranks scans scored under different rubric versions against each other with no disclosure, while the codebase states in writing that those numbers are not comparable",
    "expected": "A ranking whose rows are on one ruler, or a ranking that says which ruler each row used. This is the surface that carries the whole 'does it work' answer for a buyer who spot-checks a repo he already has an opinion about — and it is the product's own leaderboard, so a rank is a claim.",
    "got": "model.ts states it plainly: r11 'D1 stopped counting FORMATS and started scoring COHERENCE … Scores move on every repo with more than one guidance format', and 'a second, independent reason r10 numbers are not comparable with r11 ones' (model.ts:98-113); r12 followed hours later (SCORING_RUBRIC_VERSION = 'r12', :137). Scan.rubricVersion is stamped per scan and the codebase treats it as load-bearing everywhere else: the corpus benchmark filters on it (corpus/eligibility.ts:26,36), the outcome ledger REFUSES to pair two scans across a bump ('An absent rubricVersion is UNKNOWN, never \"the same\"' — db/outcomes.ts:266-270), scan digests key on it, and scans-read.ts:286-290 carries the field with the comment that a cross-bump comparison 'is a comparison between two different' things. The public register does none of that. RegisterEntry (register/data.ts:30-63) carries engineProvider, verified, confidence and hasProcessSignals — every other provenance qualifier the team thought to add — and NOT rubricVersion; getPublicRegister applies no rubric predicate; LeaderboardTable and IndexGallery render no rubric column or note (grep for 'rubric' in src/lib/register + src/components/leaderboard: only mock-engine copy, 0 hits for rubricVersion). Because the cache invalidates on a rubric bump but does not RE-SCAN, a repo nobody has re-scanned keeps its r10 row and is ranked, today, against fresh r12 rows. The register is otherwise the most scrupulous surface in the product — it refuses to rank mock-engine scans precisely because 'a register that silently ranks a mock score against a real one is worse than no register at all' (register/data.ts:12-17). The same sentence applies verbatim to a rubric bump that moved D1 on every multi-format repo, and the guard was not extended.",
    "evidence": [
      "src/lib/maturity/model.ts:98-113,137 — the r11 non-comparability statement; SCORING_RUBRIC_VERSION = 'r12'",
      "src/lib/register/data.ts:30-63 — RegisterEntry's provenance fields; no rubricVersion",
      "src/lib/register/data.ts:12-17 — the PROVENANCE invariant, stated for the engine and not for the rubric",
      "src/lib/corpus/eligibility.ts:26,36,41 — the corpus DOES filter on rubricVersion",
      "src/lib/db/outcomes.ts:266-270 — the outcome ledger refuses to pair across a bump",
      "src/lib/db/scans-read.ts:286-290 — the same non-comparability comment, on the read path",
      "WIRING GREP: grep -rn \"rubricVersion\" src/lib/register src/components/leaderboard → 0 hits"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "P2. PRECONDITION: a DB whose public corpus actually spans ≥2 rubric versions — on a freshly seeded host every row is r12 and the finding is real-but-invisible (resolve 'uncertain — not reproducible on this host'). Production almost certainly qualifies (r8→r12 in one month, no bulk re-scan). Verify by DB read rather than by eye: `select distinct \"rubricVersion\", count(*) from \"Scan\" …` over the public-org repos behind page 1 of /leaderboard, then check whether any rendered row or footnote names a rubric. Cheap fix: carry rubricVersion onto RegisterEntry and qualify a stale-rubric row the way a mock row is qualified.",
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
    "recurrence": "TOMAS-L1-04 (2026-08-10) — UNCHANGED. Re-verified line by line against current source; nothing moved.",
    "title": "Still no quantified customer proof anywhere in the public funnel, and /about's ROI simulator still runs on eight invented repos at a self-declared non-production weighting with no visible label",
    "expected": "Per the B2B trust research in his references, a specific quantified outcome-anchored result beats self-claims by an order of magnitude. His criterion allows the live scan output to substitute — but in production that substitute now sits behind TOMAS-L1-01's wall.",
    "got": "Zero customer names, zero case studies, zero quantified outcomes — and, to its credit, still zero logo wall. /about's centrepiece ROI simulator (AboutLanding.tsx:50) computes over eight fabricated repos (RoiSimulator.tsx:21-30: web-app, api-gateway, mobile-client, design-system, billing, data-pipeline, auth-service, docs-site) at `const W = 0.16`, annotated in source as 'Deliberately NOT the production weighting … so the three sliders here produce visible movement and level promotions at demo scale' (:31-36). I re-read the render path (:79-97) looking for a label added since the last outing: there is none — the only strings near the rows are the repo name and the before/after numbers. features.ts:40 even documents a 'copy contract with the paired RoiSimulator diagram', so the coupling is known and the disclosure still is not made. This Character's stated scar is 'a security scanner whose demo dazzled and whose real output was a wall of false positives'. NOT a fabrication defect — the /org simulator it mirrors is real and the source is honest with itself — but the UI does not pass that honesty to the visitor.",
    "evidence": [
      "src/components/about/AboutLanding.tsx:50 — RoiSimulator is a top-level /about section",
      "src/components/about/RoiSimulator.tsx:21-30 — the eight invented repos",
      "src/components/about/RoiSimulator.tsx:31-36 — 'Deliberately NOT the production weighting', W = 0.16",
      "src/components/about/RoiSimulator.tsx:79-97 — the render path: no illustrative caption anywhere",
      "src/components/about/features.ts:40 — the acknowledged copy contract with the demo",
      "NAMED SUBSTITUTE (and a good one): /scorecard/[owner] (app/scorecard/[owner]/page.tsx) now lets him aggregate a GitHub org he knows from already-public reports — closer to real proof than the simulator will ever be"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "P2. PRECONDITION: none for the /about half (static, any environment) — but the 'live scan substitutes for proof' limb needs branch C (DB configured AND populated) plus TOMAS-L1-01 resolved, or the substitute is unreachable too. Verify: (a) does any rendered label on /about mark the simulator's repos or weighting as illustrative; (b) does /leaderboard carry enough recognizable repos for a buyer to spot-check an opinion he already holds; (c) does /scorecard/{a-well-known-org} render, and is it linked from anywhere he would find it?",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-09",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The operator-facing env documentation for the free-scan allowance describes a weekly gate the code does not implement — an operator tuning the documented knob changes nothing, so the number the buyer is promised is not the one anyone thinks they set",
    "expected": "The env file that ships with production should name the variables the code reads. This is the control that decides how many free scans the buyer in TOMAS-L1-02 actually gets, so a silent no-op here is a pricing-honesty defect one level down.",
    "got": ".env.production's public-scan block is headed 'Public-scan weekly soft gate (anonymous free funnel; per-IP)' and documents `PUBLIC_SCAN_WEEKLY_LIMIT` ('free public scans per anonymous IP / 7 days (default 3)') and `PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN` ('default 20'); .env.example:362 repeats it. The code reads NEITHER: public-scan-quota.ts:46,57 read `PUBLIC_SCAN_MONTHLY_LIMIT` and `PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN`, over `WINDOW_MS = 30 * 24 * 60 * 60 * 1000` (:41), both defaulting to 5. `grep -rn PUBLIC_SCAN_WEEKLY_LIMIT src/` → 0 hits. So an operator who sets the documented variable to 3 silently gets 5-per-30-days, and the deployed allowance is a default nobody chose. Same family: pricing/page.tsx:218 tells the visitor allowances 'reset on the 1st of each month (UTC)' while this window is a rolling 30 days from the first hit (:41,147). Low reachability for Tomáš directly — he never reads an env file — which is exactly why it survives; it reaches him only through the number he is quoted.",
    "evidence": [
      ".env.production — the 'Public-scan weekly soft gate' block: PUBLIC_SCAN_WEEKLY_LIMIT (default 3), PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN (default 20)",
      ".env.example:362 — the same weekly variable, same wording",
      "src/lib/public-scan-quota.ts:41,45-48,56-60 — WINDOW_MS 30d; PUBLIC_SCAN_MONTHLY_LIMIT / _SIGNED_IN, default 5/5",
      "src/app/pricing/page.tsx:218 — 'resets on the 1st of each month (UTC)' vs the rolling window",
      "WIRING GREP: grep -rn \"PUBLIC_SCAN_WEEKLY_LIMIT\" src/ → 0 hits"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "P3 — static/config, not a browser finding. Confirm by reading GET /api/quota's `limit` on an anonymous request against a host with the documented weekly vars set: if it reports 5 while PUBLIC_SCAN_WEEKLY_LIMIT=3, confirmed. PRECONDITION: PUBLIC_SCAN_QUOTA_DISABLED unset and a DB configured, else /api/quota reports enforced:false and proves nothing.",
    "reachable": false,
    "scope_note": "Operator-facing. Reported because it sets the number TOMAS-L1-02 is about, not because Tomáš reads env files."
  },
  {
    "id": "TOMAS-L1-05",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "low", "trust_erosion": "med" },
    "dimension": "trust",
    "recurrence": "TOMAS-L1-05 (2026-08-10) — MOSTLY FIXED. Downgraded major → polish; the residue is one counter.",
    "title": "On a configured-but-empty database the register now explains itself, but the heading still counts '0 public repos rated'",
    "expected": "A page whose proposition is 'now it has an index' should not display an index of nothing.",
    "got": "The zero-row table is gone: IndexGallery.tsx:82-87 now renders an explicit 'No public scans yet. Scan a repository below to be the first on the register.' where the empty row list used to be, with the comment naming the exact defect ('read as a broken table'). What remains is the counter above it — `{totalRepos} public repos rated` (:53-55) — which renders '0 public repos rated' beside a 'Served live from …' provenance stamp. Branch A (DB off) still cleanly omits the whole section (IndexLanding.tsx:23) and the sample-report link with it (IndexHero.tsx:31,143). Branch C is production. The ranked/recency sub-branch remains CLEAN and remains good work: when topAiNative is empty but recent is not, rank badges become '·' and the kicker swaps to 'Latest public scans' so a recency list is never numbered as a ranking (:42-45,95,105).",
    "evidence": [
      "src/components/landing/prototypes/index/IndexGallery.tsx:82-87 — the new explicit empty state",
      "src/components/landing/prototypes/index/IndexGallery.tsx:53-55 — the '0 public repos rated' counter that survives",
      "src/components/landing/prototypes/IndexLanding.tsx:23 — branch A omits the section entirely",
      "src/components/landing/prototypes/index/IndexGallery.tsx:42-45,95 — the ranked/recency branch, re-verified CLEAN"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "P4. PRECONDITION: DATABASE_URL set with NO persisted public scans — deliberately hard to reach on a seeded host and not worth standing one up for a polish item. Expect 'uncertain — not reproducible on this host'.",
    "reachable": true,
    "scope_note": "Fresh-deployment / post-purge state, not the steady state."
  },
  {
    "id": "TOMAS-L1-R1",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "time-saved",
    "recurrence": "TOMAS-L1-03 (2026-08-10) — RESOLVED. Row kept as a resolved-verified CANDIDATE for L2 to confirm, not as an open finding.",
    "title": "RESOLVED-VERIFIED-CANDIDATE — the 'in about a minute' scan promise is gone; the dialog now prints a derived, provider-honest duration",
    "expected": "n/a — closing a previously-confirmed finding.",
    "got": "ScanModal.tsx:202-211 no longer hardcodes a duration: it renders `SCAN_DURATION = scanDurationClaim()` (module scope, :26), which composes approxScanDuration over the SAME constants the progress bar runs on — 'under 2 minutes on hosted inference, about 6 minutes when it runs against a local CLI' (scanEstimate.ts:83-105). approxScanDuration deliberately rounds AWAY from the flattering number (:80-88). The code comment names the old defect and the reason it lasted: 'This sentence used to promise \"about a minute\", which was true of no provider the scanner has ever run on … ColdScanGate had already retired the same claim in its own copy while the hero went on printing it' (:202-206). ColdScanGate.tsx:47-53 carries the matching correction. B10 is closed. The residual cost stands and is not a defect: ~100 s of a 180 s budget on the hosted path — but now spent knowingly, which is why acceptance criterion 6 moved from FAIL to conditional PASS.",
    "evidence": [
      "src/components/report/scanEstimate.ts:78-105 — approxScanDuration + scanDurationClaim",
      "src/components/landing/prototypes/index/ScanModal.tsx:26,202-211 — the derived sentence, in both gate branches",
      "src/components/report/ColdScanGate.tsx:47-53 — the matching correction on the cold-permalink card"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "P2 confirmation only. PRECONDITION: a real (non-mock) provider and an UNCACHED repo, or the wait never happens. Confirm the dialog's sentence renders the two-clause duration, then measure wall clock from click to rendered score and check it against the clause for the resolved provider.",
    "reachable": true
  },
  {
    "id": "TOMAS-L1-R2",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "completion",
    "recurrence": "TOMAS-L1-06 (2026-08-10) — RESOLVED. Resolved-verified candidate.",
    "title": "RESOLVED-VERIFIED-CANDIDATE — the bespoke tier's CTA is no longer a 'Learn more' link to /about; it opens a real enquiry dialog that does not depend on an env var",
    "expected": "n/a — closing a previously-confirmed finding.",
    "got": "ctaFor now returns null for any tier whose BILLING MODEL is 'custom' — keyed off the model, not the literal id (pricingCta.ts:38-39) — and the card renders PlanEnquiryCta: a button ('Tell us what you need') opening a modal that POSTs to /api/plan-enquiry, validated by the same normalizePlanEnquiry the route runs, with sending/sent/error states and a honeypot field (PlanEnquiryCta.tsx:22-95). The ASCENT_CONTACT_EMAIL dependency is gone, and pricingCta.ts:22-25 names the old defect verbatim: 'on a deploy without that env, the page's highest-intent click landed on a marketing page.' Two related improvements land with it: the headline for that tier is now 'Flexible / scoped with you' rather than 'Custom / contact us' (plans.ts:295-297), which stops the card promising a channel; and its bullets now describe the dimensions that get scoped rather than claiming unlimited entitlements (plans.ts:241-259). For this Character — 150-250 engineers, precisely that tier's buyer — this converts the funnel's one dead end into its only deliberate conversation.",
    "evidence": [
      "src/app/pricing/pricingCta.ts:22-25,38-39 — the null-for-custom decision and the reason",
      "src/components/pricing/PlanEnquiryCta.tsx:22-95 — the dialog, the shared validation, the state machine",
      "src/lib/plans.ts:241-259,295-297 — the rescoped bullets and the 'Flexible / scoped with you' label"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "P3 confirmation only. PRECONDITION: ASCENT_SELF_HOSTED=0 (self-hosted replaces the whole card grid) and NOT signed in. Verify the Custom card's button opens a modal rather than navigating, and that a submitted enquiry returns a success state. Do not submit real contact details.",
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
    "recurrence": "TOMAS-L1-S1 (2026-08-10) — STILL TRUE, and strengthened by r11.",
    "title": "STRENGTH — r11 made the one dimension this buyer's own repos would fail on fully reproducible, and it did so by penalising the failure mode a counting rubric rewards",
    "expected": "n/a (positive finding — protect this).",
    "got": "Under r10, five instruction-document formats summed on PRESENCE (CLAUDE.md 22 + AGENTS.md 16 + Cursor 14 + Copilot 14 + Windsurf 10 = 76), so a repo with four MUTUALLY CONTRADICTING copies outscored a repo with one document that is actually true — the rubric rewarded the worse repo. r11 collapses them into one 22-point award plus round(18 × coherence/100), where coherence is the guidance arbiter's deterministic itemized read across every format (analyze/guidance-graph.ts), and content quality is graded on the CANONICAL document rather than whichever file matched first. D1 also joined CLAIM_SCORED_DIMENSIONS, which removes its guardband blend entirely: the model's D1 number is recorded and IGNORED, and its judgment reaches the score only through citations verified against guidance files the arbiter actually found (model.ts:98-113). Why this matters to THIS Character specifically: he just bought Copilot Enterprise plus a Cursor/Claude Code line item, so his fleet is exactly the fleet with four half-maintained instruction files — and 'you have four and they disagree' is a finding he can act on this quarter, where 'you have four, +76' is a number he'd have to defend and couldn't. It is also the answer to his own question, 'AI-native maturity — measured how?': for D1 the answer is now 'deterministically, and you can re-run it'. PROTECT: any future edit must keep D1 claim-scored (no guardband reintroduction), keep the coherence read itemized rather than a bare number, and keep the honest null — 'coherence: null for a repo with no guidance document at all — never 0' (docs/features/scanning/maturity-model.md:155).",
    "evidence": [
      "src/lib/maturity/model.ts:98-113 — the r11 rationale in full",
      "src/lib/scoring/claims.ts:142 — D1 under r11: coherence, not formats",
      "docs/features/scanning/maturity-model.md:116-155,561 — the rubric doc and the honest null",
      "src/lib/register/data.ts:12-17 — the register's refusal to rank mock-engine scans, the same instinct applied to provenance"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "l2_priority": "P1 — this is the strength the whole verdict rests on. PRECONDITION: LLM_PROVIDER must be a REAL provider (claude-cli on the UAT host, gemini in production); under mock the deterministic floor runs and this is NOT reproducible. Scan a repo carrying MORE THAN ONE guidance format (this repo itself has AGENTS.md + CLAUDE.md + .claude/CLAUDE.md — an ideal subject) and verify the rendered report shows a coherence-based D1 with itemized evidence naming the canonical document, not a presence tally.",
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
    "recurrence": "TOMAS-L1-S2 (2026-08-10) — STILL TRUE, and the self-host band strengthens it.",
    "title": "STRENGTH — pricing is numeric, one click away, no tier routes an anonymous visitor into a form, and the page leads with the free self-host path ABOVE the cards",
    "expected": "n/a (positive finding — protect this).",
    "got": "Per G2 2025 only ~4% of B2B products publish a price. Ascent publishes three of four with a figure — $0 / $5 Starter / $10 Team — plus a per-tier scan line and a full operation × credit × plan ledger, one click from the header (StaticNav.tsx:52). Every anonymous ctaFor branch lands on a real destination and the bespoke tier opens an enquiry dialog rather than a wall (see TOMAS-L1-R2). The cards are DERIVED from PLAN_FEATURES — the same source the entitlement layer reads — so a displayed number cannot drift from the gate, and both the SEO description and the landing FAQ are derived from it too, after each had already survived a repricing AND a rename while quoting a dead number (pricing/page.tsx:54-63; page.tsx:12-13,79). The strongest addition since the last outing is placement: SelfHostBand renders ABOVE the price grid (pricing/page.tsx:137-143) with the reasoning stated in the file — 'a pricing page that never mentions the software is AGPL and free to self-host is one a visitor discovers is incomplete the moment they find the repository — and then trusts less about everything else on it.' For a buyer whose default posture is 'I've heard this pitch before', a vendor that leads its pricing page with the free way to not pay it is the single most disarming thing on the site. PROTECT: any 'talk to sales' experiment on the Starter/Team cards, or demoting the self-host band below the grid, forfeits the funnel's strongest conversion asset for this Character.",
    "evidence": [
      "src/app/pricing/page.tsx:137-143,148-209 — the self-host band above the derived card grid",
      "src/lib/plans.ts:196-259,295-303 — PLAN_SPECS and planPriceLabel, the single source",
      "src/app/pricing/pricingCta.ts:33-48 — every anonymous branch lands somewhere real",
      "src/components/StaticNav.tsx:52 — Pricing one click from anywhere",
      "DERIVED: planPriceLabel over PLAN_ORDER → $0 (free forever) / $5 (/month) / $10 (/month) / Flexible (scoped with you)"
    ],
    "code_check": "n-a",
    "verdict": "confirmed",
    "l2_priority": "P2. PRECONDITION: **ASCENT_SELF_HOSTED=0** — with the .env.local default of 1, /pricing short-circuits to SelfHostPricingBlueprint and the four cards never render, so this strength is untestable and must NOT be recorded as refuted. Verify all four cards render, the self-host band sits above them, and no tier opens a lead-capture form.",
    "reachable": true
  }
]
```

---

## Estimated time-saved

**His verbatim baseline** (`uat/characters/tomas-prospective-buyer.md`, quoted, never re-estimated):

> "Today his honest baseline for 'is the AI investment working?' is no tool at all: a hand-rolled mix of Copilot acceptance-rate dashboards, a DX-style survey, and a spreadsheet of AI-touched-commit percentages that his peers admit doesn't show whether the AI actually helped anyone ship."

> "he's judging that entirely from the marketing plus one public scan, **in two to three minutes**, before he bounces."

**Senior bar, verbatim:** *"the kind of repo read and maturity assessment he'd accept from a staff engineer and forward to leadership without rewriting it."*

- **If the front door worked as designed: ~40 min saved on the adoption decision, medium confidence.** The funnel replaces the standard enterprise evaluation (demo request → scheduling → a 30–45 min sales call before you learn the price) with ~75 s of self-serve reading plus one scan. Improved marginally on the last outing: the honest duration claim (R1) means the scan's ~100 s is now budgeted rather than blown, and the enquiry dialog (R2) means the decision has somewhere to land.
- **As production is actually configured: ~0 min, high confidence.** TOMAS-L1-01 converts the self-serve funnel back into a signup gate at the exact moment he uses it — the very thing the 40 minutes were saved by avoiding. **The regression from the last outing is that the fix exists and did not reach him.** The server was taught to say yes; the button was not.

*(The recurring value — replacing the quarterly hand-rolled scramble — is out of scope for this journey, which judges the public funnel and one scan.)*

---

## Journey verdict

### **L1-conditional** — unchanged headline, changed cause, and the cause is now cheaper to fix than it has ever been

**Why not L1-pass.** Criterion 3 fails outright on the deployment as configured. He is anonymous, he does not sign in to evaluate, and the hero's primary CTA — the one the entire page is pointed at — hands him a GitHub OAuth button. Everything downstream of that click is unreachable for him: the scan, the report, the evidence, the discrepancy disclosure, the whole argument.

**Why not L1-fail.** The journey is structurally completable and got measurably better this cycle. Pricing is numeric, unwalled, one click away, and now leads with the free way to not pay it. The bespoke tier has a real channel. The scan's duration is honestly stated. The register explains its empty state. And r11 turned the dimension his own fleet would fail on into a reproducible, deterministic read that penalises the exact failure mode — four contradicting instruction files — a counting rubric rewards. The blocker is not a missing feature and no longer even a policy decision: **the policy was already changed, in his favour, and one expression was not updated with it.**

**The shape of this run's headline is worth naming for the programme, not just this journey.** Four of my confirmed findings are the same species: a decision made correctly in one module and not carried to the surface that renders it — `publicScanSignInRequired` with no client reader; `rubricVersion` load-bearing in four modules and absent from the one that publishes a ranking; `NEXT_PUBLIC_SOURCE_REPO_URL` reasoned about carefully in `site.ts` and set in no production env; a weekly quota documented in `.env.production` and implemented monthly. Every one is individually well-argued at its own site. That is precisely the residue a 30-lane merge leaves, and it is why the wiring grep earns its place in the standing rules.

**Carry-forward to L2.** TOMAS-L1-01 decides this journey, and **it is invisible under the overlay's own convenience flags** — `ASCENT_AUTH_BYPASS=1` alone refutes it falsely, and `ASCENT_SELF_HOSTED=1` and `PUBLIC_SCAN_QUOTA_DISABLED=1` each hide one more of my top four. **His journey must be walked with auth bypass OFF.** If L2 confirms the wall live against the real deployment, this journey becomes **L1-fail retroactively**: a buyer who cannot run the scan has no journey.

### His blunt gut call

> ### **"Worth a deeper look — if I can get in."**
>
> The price is on the page, the pitch is a claim I can check, and the scoring got *more* honest, not less. But the button says sign in, and I don't. Somebody there already decided I shouldn't have to. Nobody told the button.

---

## Tomáš's first-person review (L1 — over the *designed* experience)

Two minutes. Go.

The headline is a claim with a shape: reads a repo, scores it 0–100, nine weighted dimensions, five levels, evidence behind every number. Under it, in bold, something I don't usually see: **open source, AGPL, run it yourself with any model — the cloud plans buy operation, not capability.** That is the most persuasive sentence on the page, because it's the only one that costs me nothing to verify.

So I click it. And it takes me to the pricing page. Not to a repository. There's a self-hosting band there that says "Self-hosting guide: docs/SELF-HOSTING.md" — as *text*. No link. Nowhere on this entire site is there an address for the source code they just told me they'd give me. I know exactly how that happened: somebody sensibly decided a dead link is worse than no link, and then nobody set the variable. The result is a page that makes its biggest claim and doesn't say where.

**Price.** One click. Zero, five, ten, flexible. Actual numbers, per-tier scan volumes, a whole ledger of what draws on a credit. And above the cards — above them, not buried under — a band that says the software is free and here's how to run it yourself. Do you know how rare that is? Most vendors make me fill in a form to find out whether I can afford the conversation. This one leads with the reason I might not need to pay them at all. That bought them ninety more seconds than they'd otherwise have had.

**And the Custom card.** Last time this was a button labelled "Learn more" that took me to the marketing page — a price I couldn't act on. Now it says "Tell us what you need" and opens a real form. I'm a hundred and fifty engineers; that's my tier. Someone thought about the person standing in front of it.

Then I hit the wall.

I click *Scan a repository*, which is the whole point of the page, and the dialog tells me: **"Scanning is for signed-in members on this deployment."** Sign in with GitHub. I don't. That's not stubbornness, it's the reflex I built after the last three vendors — if I have to hand over an OAuth grant to find out whether the tool is real, I assume it isn't confident that it is.

Here's the part that actually annoys me. **The wall isn't real.** Their server would have let me. Somebody wrote — in the code, in a comment I'd frame — that the product "left open every surface that would not convince a buyer and walled the single one that would, under a page promising no signup," and then *fixed it*. And the button didn't get the memo. Worse: if I'd typed `/report/vercel/next.js` into the address bar instead of clicking their own button, I'd have got a card that says *"free for public repositories and needs no account"* and a Scan now that works. So the wall stops nobody who knows the URL, protects no cost ceiling — the rate limit and the monthly cap both sit outside it — and costs them exactly one kind of visitor: the one who trusts the front door. That's me.

**The other thing that made me re-read everything.** The Free card says **"Unlimited free public scans."** The FAQ says public scans are "always free and unmetered." And in the scan dialog itself, under the input, there's a counter: **"5 of 5 free scans left this month."** Unmetered, next to a meter. It's small, and small is the kind that makes me go back and check the big claims — which is the opposite of what you want a price card to do. (I'm told that if I burn through them, the 429 offers to upgrade me to "Pro". There's no Pro on the pricing page. It's called Starter.)

**Now — the part I'd defend in a room.**

Their scoring got *better*, and better in the specific way that tells me engineers rather than marketers are steering. Dimension one used to add up how many instruction files a repo had: a CLAUDE.md, an AGENTS.md, a Cursor rules file, a Copilot one, a Windsurf one — seventy-six points for five files that could all contradict each other. They tore it out. Now it reads them, works out which one is canonical, scores how *coherent* they are, and grades the content on that document. And they made the model's opinion of that dimension non-binding — it only counts through citations checked against files actually found.

That's my fleet. We just signed for Copilot Enterprise and a Cursor line, and I would bet my next quarter that half my repos have three instruction files that disagree. Under the old rubric we'd have *scored well* for that. Under this one we get told the truth. A vendor who takes points *away* from the customer's most likely configuration because the old way was measuring the wrong thing is a vendor whose number I can carry upstairs.

Which makes the register the last thing I'd want tightened. They're scrupulous about it — a deterministic preview score is never ranked against a real one, and they say why. But they changed the rubric twice this month and say plainly in their own code that the old numbers aren't comparable to the new ones, and the ranked table doesn't record which rubric each row was scored under. Their benchmark corpus filters on it. Their outcome ledger refuses to compare across it. The public leaderboard — the one I'd spot-check — doesn't mention it. Same instinct, one surface short.

And the ROI simulator on the About page is still eight invented repos with a weighting their own source calls "deliberately not the production weighting." Still unlabeled. Take it out. The register of real repos two scrolls up on the homepage does more for you than that thing ever will, because I can check it against a codebase I already have an opinion about.

**Who would I loop in?** If I got past the sign-in wall: my platform lead, same week — she owns our internal standards and the coherence scoring is aimed straight at her problem. Then our security lead for the D9 battery.

If I didn't get past it — nobody. I'd have forgotten the name by Thursday.

They fixed the timing claim. They fixed the dead Enterprise button. They fixed the empty-table state. They fixed the *policy* behind the login wall. Then they shipped the button that still enforces it.

*— "huh. That's actually not wrong. Let me in."*
