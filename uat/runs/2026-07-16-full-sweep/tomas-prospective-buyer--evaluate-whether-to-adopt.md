
# L1 Report — Tomáš (prospective buyer) × "Evaluate whether to adopt"

cert_level: L1 (theoretical, static, code-grounded) · No browser used.

---

## 1. Surface model (import chain, file:line cited)

### Reachable surface set for this Character
Tomás does not sign in. Journey explicitly excludes anything behind auth. His actually-reachable set:

| Surface | Reachable? | Gate |
|---|---|---|
| `/` (landing) | yes, public | `src/app/page.tsx:62-89` — no gate on render |
| `/about` | yes, public | `src/app/about/page.tsx:18-25` |
| `/pricing` | yes, public | `src/app/pricing/page.tsx:48-127`, `export const dynamic = "force-dynamic"` |
| Scan dialog (`ScanModal`) → `/report?repo=` | yes **if** `authGateEnabled()` is false | `src/components/landing/prototypes/index/ScanModal.tsx:136` (`locked = gated && signedIn !== true`); `gated` is computed server-side in `src/app/page.tsx:70-74` from `authGateEnabled()` (`src/lib/access.ts:19`, re-exported from `src/lib/env.ts:42`) — true only when Supabase is configured **and** the dev bypass is off. In the pinned UAT env (`ASCENT_AUTH_BYPASS=1`, `uat/env.md:32`) this is false, so the scan form is unlocked to signed-out visitors, matching the "frictionless CTA" bar. |
| `/report` (ScanForm submit target) | yes | `src/app/report/page.tsx:13-24` → `ReportClient` |
| `/report/[owner]/[repo]` (permalink / sample-report / gallery links) | yes | `src/app/report/[owner]/[repo]/page.tsx:61-84` |
| `/badge` | yes | `src/app/badge/page.tsx` |
| `/launch` | **not reachable without sign-in** | `src/app/launch/page.tsx:26-40` calls `resolveSignInState()`; `needsSignIn` renders `SignInNotice` instead of the fleet map — out of scope per journey, consistent with the character file listing it under `maps_to` but the journey excluding auth surfaces. Not judged. |
| `/org/*` | excluded by journey definition | n/a |

### Affordance → handler → data chain (primary path: paste-a-repo → scan → report)
1. **"Scan a repository" CTA** (hero) → opens `ScanModal` dialog — `src/components/landing/prototypes/index/IndexHero.tsx:65` → `ScanModal.tsx:140-148`.
2. **Scan input + submit** → `ScanForm` — `src/components/ScanForm.tsx:47-149`. `normalizeRepo()` (`ScanForm.tsx:36-45`) accepts a bare `owner/repo`, a full URL, or an SSH ref. `submit()` (`ScanForm.tsx:119-149`) pushes `router.push('/report?repo=' + encodeURIComponent(normalized))` — **no auth call, no credential, no signup** on this path.
3. **`/report?repo=...`** → `ReportPage` (`src/app/report/page.tsx:13-24`) → `ReportClient` (client component, not read in full but its scan hook `useReportScan` is confirmed at `src/components/report/useReportScan.ts`).
4. **Scan orchestrator** → `src/lib/scan.ts` (top-level: URL → GitHub ingest → deterministic signals → LLM assess, comment at `scan.ts:1-3`). Deterministic signals feed D1-D9; D9 (Security) is fully deterministic (`scan.ts:250-252`).
5. **LLM prompt build** → `src/lib/scoring/prompt.ts:152-214` (`buildAssessmentPrompt`). Grounding sources that reach the prompt (see §1a below).
6. **Report render** → `ReportView` (`src/components/report/ReportView.tsx`, referenced at `src/app/report/[owner]/[repo]/page.tsx:128`).

### 1a. Grounding audit — the AI surface (`buildAssessmentPrompt`)
The Character's real-world proof bar ("scores reconcile with a repo he knows, cite concrete evidence, name a specific next move") maps to how much real context reaches the prompt. Enumerated sources and whether each reaches it:

| Context source a senior repo-read would use | Reaches the prompt? | Evidence |
|---|---|---|
| Deterministic per-dimension signal scores (all 9 dims, computed from real repo structure/CI/tests/docs) | yes | `prompt.ts:158-165` (`signalBlock`), told to the model as "ground truth" (`prompt.ts:198`) |
| PR / review-discipline / merge-velocity data | yes | `prompt.ts:20-46` (`processBlock`), `prompt.ts:201-202` |
| Branch protection / governance | yes | `prompt.ts:37-44` |
| Security check battery (D9, fully deterministic) | yes | `prompt.ts:54-64`, `prompt.ts:204-205` — model is told the D9 number is fixed, narrate only |
| Recent commit messages (sample) | yes | `prompt.ts:186-188`, `207-208` |
| Sampled real file content/excerpts | yes | `prompt.ts:167-184`, `210-211` (22KB window, 2200 chars/file) |
| Detected tech stack (languages/frameworks/roles) | yes | `prompt.ts:197` |
| Repo metadata (language, stars, description, push recency) | yes | `prompt.ts:192-196` |
| Org-level standing decisions (prior human triage) | conditionally — only for repos with org history | `prompt.ts:98-103`; not applicable to a cold public-repo scan by a first-time visitor (no org context yet), so effectively N/A for Tomás's actual run |
| Auditor self-check against the deterministic signals ("discrepancies") | yes, explicitly required in the output contract | `prompt.ts:126-129`, `138` |

**Grounding score: 6/6 applicable sources** (the one N/A source — org standing decisions — legitimately doesn't apply to a first public scan, not a gap). This is a well-grounded AI surface: it is fed real repo/PR/security/commit/file evidence, not just a repo name. This directly supports the senior-quality bar — the machinery is not thin.

### 1b. Pricing surface (numeric-pricing bar)
`src/app/pricing/page.tsx:39-127`. `FREE_ALLOWANCE`, `PRO_PRICE`, `TEAM_PRICE` are derived from `PLAN_FEATURES`/`planPriceLabel()` (`src/lib/plans.ts`, imported at `pricing/page.tsx:10`) — the same source the billing gate reads (`pricing/page.tsx:35-38` comment confirms this is deliberate, to prevent copy drift). Rendered as real `$` numbers on the price cards (`pricing/page.tsx:79-87`). Free tier CTA → `/` (`ctaFor`, `pricing/page.tsx:24`); Pro/Team CTA → `/onboarding` (no contact wall); only Enterprise CTA is `mailto:`/`"Learn more"` fallback (`pricing/page.tsx:25-29`) — and Enterprise is explicitly out of scope for buyers wanting the two mainline tiers. **No contact-sales wall blocks Pro/Team pricing or the free tier.**

### 1c. Scan-latency expectation (time-saved-relevant)
- Pre-scan copy on the **cold-permalink** gate (only reached via a not-yet-scanned permalink, not the primary ScanForm path): `"...takes about a minute."` — `src/components/report/ColdScanGate.tsx:33`.
- In-flight copy shown once a live scan is actually running: `"...this usually takes a few minutes. You can leave this tab open."` and a slow-path message owning "several minutes" — `src/components/report/scanEstimate.ts:54,59`.
- Configured LLM provider for this environment is `claude-cli` (`uat/env.md:11-14`), with a documented real-world median of ~6 minutes per scan and a `CLAUDE_CLI_TIMEOUT_MS` default of 150s that the seeders extend for longer repos (`uat/env.md:13`).

These two pieces of copy disagree with each other (one says "about a minute," the live one says "a few minutes" / "several minutes"), and both undersell the actual ~6-minute median for a `claude-cli` scan on a real target repo (`vercel/next.js` per the journey's own suggested scan target, `uat/journeys/evaluate-whether-to-adopt.md:5`).

---

## 2. In-character walkthrough (cognitive walkthrough + Character's own scored criteria)

Walking `/` → `/about` → `/pricing` → scan dialog → `/report`, purely from the code model above, in Tomáš's head:

**Step 1 — `/` in the first 30 seconds.** The H1 ("Every engineering org has a maturity. Now it has an index.") plus the sub-line ("a single 0-100 score on a 5-level ladder across 9 weighted dimensions, with the evidence behind every number" — `IndexHero.tsx:52-60`) states *what* and implies *how* concretely — no buzzword soup, a specific mechanism is named. Good — clears "will he know what he's looking at."

**Step 2 — who's it for / does it work.** `/about`'s framing ("AI adoption without a map is expensive" — `AboutCost.tsx:24-50`) and its four ROI/adoption/risk diagrams are engineering-leadership-coded, matching his vocabulary. I don't have visibility into the exact copy of `AboutFeature`/`RoiSimulator` bodies (not read line-by-line), so I can't fully certify "who's it for" clears in under a minute — flagged as a `l2_priority` item, not a finding (nothing in the model contradicts it).

**Step 3 — cost.** `/pricing` is the strongest surface in this model: real numbers, no wall, on the page in one screen, sourced from the same `plans.ts` the billing gate reads so the number can't be a lie (`pricing/page.tsx:35-38`). This is exactly what the G2/pricing-transparency reference (`tomas-prospective-buyer.md:8`) demands, and it's a genuine strength worth protecting.

**Step 4 — "show me it works, on a repo I know, right now."** The primary CTA is a single click into `ScanModal`, no login required in this deployment config (`ScanModal.tsx:136`), landing on a plain text input (`ScanForm.tsx`) that accepts a bare `owner/repo` or a pasted URL — exactly his low-friction bar. This is the second genuine strength: the free self-serve trial *is* the front door, not a secondary link under a demo-request button.

**Step 5 — waiting for the scan.** This is where the model surfaces the sharpest tension against his own declared bar. He pastes `vercel/next.js` (a repo he'd know). The honest in-app copy tells him "a few minutes," escalating to "several minutes" for a large repo — and the pinned provider for this environment is `claude-cli`, whose real median is ~6 minutes. Tomás's own motivation section is explicit: *"if it takes him longer than a couple of minutes and a single scan to even tell whether the tool is real, he won't invest the deeper evaluation."* A 6-minute wait for his own scan of a large, well-known repo is not "a couple of minutes." He has two ways to avoid this: click "See a sample report" (an already-scored repo, instant) or browse the register/gallery — but neither of those is *his own* scan on *his own* chosen repo, which is the specific proof he says he trusts over anything vendor-supplied (`tomas-prospective-buyer.md:24`, "a live self-serve look is the only proof I trust over a vendor's self-claims"). If he insists on running it himself on a repo of his choosing, he is looking at several minutes, not "well under three."

**Step 6 — the report itself.** Judged purely from the prompt model (§1a): the output is well-grounded — deterministic signals, PR/governance data, a fully-deterministic security battery, real file excerpts, and a required self-auditing "discrepancies" pass where the model is explicitly told to flag detector misses rather than rubber-stamp them (`prompt.ts:126-129`). This is architecturally what a senior repo read looks like: score + cited evidence + reconciliation, not a black-box number. I could not read `ReportView.tsx`/`DimensionCard`-equivalent rendering in full within this pass to certify the *display* surfaces every piece of that evidence legibly (as opposed to just feeding it to the model) — flagged as `l2_priority`.

**Step 7 — credible proof.** No case-study, testimonial, or logo-wall component exists anywhere in `src/components/about/**` or the landing tree (confirmed by repo-wide grep — `confirmed-absent`, not `present-but-missed`). That means the entire "credible proof" bar rests on the OR clause: the live scan output itself must stand as proof. Given §1a's grounding, the mechanism is there in principle; whether the actual generated report *reads* as senior-grade prose (headline sentence, roadmap phrasing, etc.) is inherently something only a live run can confirm — `l2_priority`.

**Gut verdict (theoretical):** "The front door and the price are real — no games there. Whether this is worth pitching to leadership hinges on the one thing I can't judge without a browser: does a 6-minute wait actually deliver a report I'd forward, and does anyone warn me it's 6 minutes before I commit to waiting?"

---

## 3. Findings

### F1 — Scan-latency promise doesn't match the pinned provider's real latency, and the two in-app copies disagree with each other
- file: `src/components/report/ColdScanGate.tsx:33` vs `src/components/report/scanEstimate.ts:54,59`, cross-referenced against `uat/env.md:11-14` (claude-cli median ~6 min)
- type: `trust` / `quality-gap`
- severity: **major**
- impact: `{ frequency: high (every scan a buyer runs), reachability: high (default provider, no config needed), trust_erosion: high (a buyer who was promised "about a minute" and gets 6 is primed to distrust the next number he sees) }`
- summary: The cold-permalink pre-scan copy says "takes about a minute"; the actual in-flight copy (shown once scanning starts, on the primary ScanForm path too) says "a few minutes," and the pinned `claude-cli` provider's documented real median is ~6 minutes. Tomás's own time-saved bar treats "a couple of minutes and a single scan" as the ceiling before he closes the tab.
- failure_scenario: Tomás pastes `vercel/next.js` (his suggested example repo per the journey file). He is told (if he ever saw the cold-gate copy) "about a minute," then watches "a few minutes" tick past, plausibly into 5-6 minutes for a repo that size on `claude-cli`. He starts to distrust the tool's own claims before he's even read the score.
- l2_priority: measure actual wall-clock time for a live scan of a large well-known repo (e.g. `vercel/next.js` or `facebook/react`) under the pinned `claude-cli` provider, and confirm whether the in-flight copy's expectation-setting reads as honest in the moment (not stalled, not silently over the "few minutes" promise).

### F2 — No quantified case study or customer proof exists anywhere in the marketing surface
- file: confirmed-absent across `src/components/about/**`, `src/components/landing/**` (repo-wide grep for case-study/testimonial/quantified-result content found none)
- type: `missing-feature`
- severity: minor (not major, because the Character's acceptance criterion is an OR — the live scan can substitute — and no logo-wall anti-pattern was found either, so nothing actively erodes trust)
- impact: `{ frequency: med (only matters if the buyer's own scan underwhelms), reachability: high, trust_erosion: low-med }`
- summary: The character's trust reference (`trustmary.com`) and pet peeve both center on quantified proof; the product has neither a case study nor a logo wall — the entire proof burden sits on the self-serve scan.
- failure_scenario: If his own scan of a repo he knows produces anything that reads as generic or doesn't reconcile with what he already knows (unverified in L1 — see F1's l2_priority and F3), there is no secondary proof point (a "here's a real team's before/after" artifact) to fall back on, and he closes the tab with "this is a demo."
- l2_priority: after a live scan, ask whether the absence of a case study is actually felt as a gap once the scan output is in front of him, or whether the scan alone clears the bar.

### F3 — Report-surface rendering of the grounded evidence not verified in this pass (informational, not a defect)
- file: `src/components/report/ReportView.tsx` (referenced, not read in full)
- type: n/a — scope note, not a finding
- code_check: `n-a`
- Recorded because the grounding audit (§1a) certifies the *prompt* is well-fed; it does not certify the *rendered report* surfaces that evidence legibly (citations, discrepancy callouts, roadmap "explore" framing) to a skimming buyer. `l2_priority`: confirm the live report visibly shows evidence/citations per dimension, not just a bare score.

---

## 4. Character voice reaction (first-person)

"Okay, I'll give them the front door — that's the part everyone else gets wrong and they didn't. The pricing page has real numbers, sourced from the same place billing reads, so I don't have to wonder if it's a lie. And I can paste a repo with zero signup — that's rare, that's the self-serve bar I actually hold vendors to.

But then I hit the wait. 'About a minute' on one screen, 'a few minutes' on the next, and if I actually paste something real — next.js, not some toy repo — I'm apparently looking at something more like six. That's the kind of inconsistency that makes me start reading everything else on the page more skeptically, which is exactly the opposite of what a landing page is supposed to do to me in minute two.

If the report on the other end of that wait is genuinely senior-grade — real evidence, a score I can argue with instead of just accept, a next move that isn't 'add more tests' — I'll forgive the wait, the same way I forgive a slow CI pipeline that actually catches bugs. The machinery behind the score, from what I can see in the code, is real: it's reading PRs, branch protection, actual file content, not just vibing off a repo description. That's not nothing.

There's no case study, no 'team X doubled their AI-adoption score' — fine, I don't need one if the scan itself does the job. But it means there's no plan B if my own scan underwhelms.

Verdict, on paper: worth a deeper look, conditionally — I want to see that scan finish and read what it says before I put my name on a recommendation to my VP. If the wait is honestly six minutes and nobody tells me that up front, that's the kind of thing that would make me forward this to a peer with 'promising but check the timing before you demo it live.'"

Would he adopt (theoretical, pre-L2): leaning yes, gated on the live scan quality and the latency honesty — not a hard no, not yet a clean yes.
