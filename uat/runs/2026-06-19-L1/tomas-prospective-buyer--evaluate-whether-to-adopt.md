# L1 — Tomáš (prospective buyer) × evaluate-whether-to-adopt

**Verdict: L1-conditional** — the front door is structurally complete and the public-scan engine is genuinely senior-grade on paper, but one major gap (no numeric pricing anywhere — the freemium ladder shows "Free / Prepaid credits / Custom" with an explicit "final rate TBD") fails Tomáš's #1 scored criterion and carries forward.

---

## Reachable surface set

Tomáš is **external, unauthenticated, no DB assumed** (the journey's public funnel). Following nav + gating from `/`:

| Route | Reachable? | Gating followed |
|-------|-----------|-----------------|
| `/` (landing + ScanForm) | ✅ public | `src/app/page.tsx:60` — `force-dynamic`, no auth; gallery/quota degrade to null when DB off (`page.tsx:63,69`). |
| `/#levels` `/#how` `/#pricing` | ✅ public | On-page anchors rendered by `IndexVariant` (`src/components/landing/prototypes/index/IndexVariant.tsx:49-52`). Header nav points here (`Brand.tsx:49-57`). |
| `/about` | ✅ public | `src/app/about/page.tsx:17` — static, no auth. |
| `/pricing` | ✅ public | `src/app/pricing/page.tsx:18` — static, no auth. **Note: not linked from header/footer nav** (both link `/#pricing` — `Brand.tsx:55,127`). Reachable only by typing the URL or via a quota "upgrade" CTA. |
| `/report?repo=…` | ✅ public, no login | `ScanForm` pushes here client-side (`ScanForm.tsx:85`); `src/app/report/page.tsx:14` is public; `/api/scan` skips the auth gate for `orgSlug==="public"` (`src/app/api/scan/route.ts:50`). |
| `/badge` | ✅ public | `src/app/badge/page.tsx:9` — static, no auth. |
| **`/launch`** | ⚠️ **session-gated → not the experience the journey expects** | `src/app/launch/page.tsx:37-53`: no session → `redirect("/connect")` when auth is off, or a sign-in prompt when auth is on. For an anonymous buyer the "fleet-map" never renders. Tag: `unreachable` for Tomáš. |
| `/connect`, `/org/vercel` | reachable but **off-journey** | The about-page + org-edition CTAs point here; `/org/vercel` needs a populated DB (out of scope; the journey explicitly excludes authed org features). |

**Net front door for Tomáš:** `/` → (read `#how`/`#levels`/`#pricing` + `/about`) → paste a repo → `/report`. That path is fully open with no login wall. The `/launch` surface named in his `maps_to` is **not** reachable unauthenticated — it's a post-OAuth landing, not a public marketing page.

---

## Surface model notes (affordances → backing `file:line`)

**Primary CTA (frictionless look) — PASS.** The hero is the `ScanForm` (`IndexHero.tsx:52`). It normalizes any repo form client-side (`ScanForm.tsx:14-28`) and navigates straight to `/report?repo=…` (`ScanForm.tsx:85`) — **no login, no signup, no credit card, no email gate**. Sub-copy under it: "Free for public repos · No signup · Results in under a minute" (`IndexHero.tsx:63-69`). Example chips (`facebook/react`, `vercel/next.js`, `anthropics/claude-code`) let him one-click a repo he knows (`ScanForm.tsx:7,164-191`). This is exactly the "test in my environment, no sales call" front door his references demand.

**WHAT/WHO/HOW copy — PASS.** Headline "Every engineering org has a maturity. Now it has an index." + a concrete one-liner: "rates how AI-native the engineering is — a single 0–100 score on a 5-level ladder across 9 weighted dimensions, with the evidence behind every number" (`IndexHero.tsx:42-50`). Method is three concrete steps — read the repo via GitHub API (no clone, nothing stored) → deterministic detectors + guardbanded LLM → level + radar + evidence + next steps (`shared/content.ts:78-94`). "Who for" is stated via the Organization-edition band (`IndexVariant.tsx:24-45`) and the `/about` framing (director/platform-lead vocabulary: posture, adoption×rigor, governance, supply-chain).

**PRICING — the major gap.** Two pricing surfaces, **neither shows a dollar figure**:
- On-page `#pricing` (`PricingCards.tsx` ← `buildPricing` in `shared/content.ts:21-70`): Public = **"Free"**, Private = **"Prepaid credits"** with note *"Indicative; final rate TBD"* (`content.ts:55`), Enterprise = **"Custom"**.
- `/pricing` page (`pricing/page.tsx`) reads `PLAN_FEATURES` (`src/lib/plans.ts:24-65`) and renders **feature lists + scan allotments but no price** — by explicit design ("Pricing amounts live in the billing provider… this surface shows what each tier includes, not dollar figures," `pricing/page.tsx:3-4`; `plans.ts:4-5`). The Enterprise CTA is literally **"Contact us"** (`pricing/page.tsx:63`).
So Tomáš can answer "what's free" (public scans, unlimited/quota'd) but **cannot answer "what does a private scan cost" or "where does the paid tier start"** in numbers. Per his G2 reference, "starts at — talk to us / TBD" is a shortlist-drop trigger.

**Grounding audit (the trust core) — strong machinery, real evidence, one anonymous-scan caveat:**
- **File sampling is signal-prioritized, not thin.** `pickFilesToFetch` (`src/lib/github/source.ts:520-628`) within `MAX_FILES = 32` (`source.ts:35`) deliberately grabs agent-guidance files anywhere in the tree (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, copilot-instructions — `source.ts:530-537`), then manifests/lint/CI configs (`:540-586`), CI workflows (`:589-592`), ADRs/docs (`:601-604`), a test sample (`:607-614`), and a source sample for texture (`:617-625`). Deterministic detectors read **full** file content (the prompt note at `prompt.ts:84-86` confirms the fetch budget is sized for detectors, not the 22 KB LLM window).
- **LLM gets the real evidence.** The prompt hands the model the per-dimension signal scores + evidence, the PR/governance process block, recent commit messages, and file excerpts (`prompt.ts:101-151`); system prompt forbids inventing facts and *requires* it to flag detector misses as "discrepancies" (`prompt.ts:46,138-141`).
- **Blend is honest.** `assembleReport` guardbands the LLM to ±`LLM_GUARDBAND` of the deterministic score and blends 60/40, coverage-weighted so a half-seen repo leans on detectors (`engine.ts:70-102`); renormalized weighted mean (`:163`); surfaces partial-LLM-coverage and total-detector-failure warnings (`:135-156`); carries per-dimension evidence + strengths/gaps (`:104-115`); discrepancies render as "Flagged for review" (`ReportView.tsx:245-261`).
- **Caveat that hits Tomáš specifically:** an **anonymous** public scan has no token, so PR + branch-governance signals (the behavioral evidence behind D3/D6/D7/D8) are **skipped** (`scan.ts:136-141,156-161`) and the report says so in a "Heads up" warning (`scan.ts:316-320`, rendered `ReportView.tsx:171-183`). The prompt degrades that block to "(unavailable — scanned without a token)" (`prompt.ts:18-21`). So his self-serve scan is honest but partial on exactly the governance dimensions a director cares about — defensible, but he should know.
- **Provider reality (L2 carry-forward):** under `LLM_PROVIDER=auto` with no key the scan **degrades to the deterministic MockProvider** (`src/lib/llm/index.ts:106-116`, `scan.ts:116,288-291`); the UAT env pins `LLM_PROVIDER=claude-cli` for real Claude output (`uat/env.md:11-12`). At L1 I can't know which the live deployment serves; the report flags a mock run honestly (`ReportView.tsx:24`), but whether Tomáš's actual scan reads senior-grade or "deterministic floor" is a live question.

**Roadmap quality — senior-grade framing on paper.** Recommendations are gap-as-observation + invitational "explore" questions, weighted-upside-ranked under the archetype lens (`recommendations.ts:20-161`; prompt enforces the same at `prompt.ts:129-136`). Not generic "add more tests" — D2 reads "Few tests vouch for behavior — little catches a bad change" with a rationale tied to AI-merge safety (`recommendations.ts:32-42`). `cheapestPathToNextLevel` gives a concrete "+N pts → next level" path (`engine.ts:320-371`).

**Proof / credibility — no quantified third-party result anywhere.** `/about` is all self-claim narrative (`about/features.ts:16-65`, `AboutCost.tsx:6-11`): "Turn 'we think this will help' into 'this moves 6 of 8 repos to L3 by Q3'" is a *hypothetical*, not a customer outcome. No case study, no logo wall, no quantified "doubled X in 90 days." Per his trust reference, that means **the live scan output is the only proof he can lean on** — which raises the stakes on the provider question above.

---

## Findings

```json
[
  {
    "id": "L1-TOMAS-01",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "No numeric pricing on any public surface — private-scan rate is 'Prepaid credits / final rate TBD', Enterprise is 'Custom / Contact us'",
    "expected": "Actual numbers reachable from the landing page — what a private scan costs, where the paid tier starts — with no contact-sales wall (his #1 scored criterion; G2 reference).",
    "got": "Both /#pricing and /pricing show tiers + feature lists but zero dollar figures, by explicit design. Private = 'Prepaid credits' note 'Indicative; final rate TBD'; Enterprise CTA = 'Contact us'.",
    "evidence": ["src/components/landing/prototypes/shared/content.ts:43-70", "src/app/pricing/page.tsx:3-4", "src/app/pricing/page.tsx:44-64", "src/lib/plans.ts:4-5"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm live that no pricing page or checkout step ever surfaces a per-credit/per-seat number before a sign-up; confirm the Enterprise path is the only 'contact' route.",
    "suggested_acceptance": "Show at least one real number on a public surface — e.g. '$X per private scan credit' or 'Pro from $Y/mo' — so the freemium ladder isn't 'Free → talk to us'."
  },
  {
    "id": "L1-TOMAS-02",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "trust",
    "title": "No quantified third-party proof — marketing is self-claim narrative; the example ROI numbers are hypotheticals, not customer outcomes",
    "expected": "A specific, quantified customer result OR the live scan standing as proof (trust reference: quantified outcomes beat self-claims/logo walls).",
    "got": "/about is qualitative ('AI adoption without a map is expensive') with one illustrative hypothetical ('moves 6 of 8 repos to L3 by Q3'); no case study, no quantified customer result, no logo wall either.",
    "evidence": ["src/components/about/features.ts:16-65", "src/components/about/AboutCost.tsx:6-11", "src/components/about/AboutHero.tsx:10-11"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Decide whether the live scan output alone is strong enough to carry 'proof' — if yes, the marketing should point him at it harder; if the scan reads mock/thin, this minor becomes a major."
  },
  {
    "id": "L1-TOMAS-03",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "clarity",
    "title": "'Pricing' nav points to the on-page anchor, not the dedicated /pricing page; /pricing is effectively undiscoverable from nav",
    "expected": "A consistent path to the fuller pricing/tier comparison.",
    "got": "Header and footer both link '/#pricing' (the landing anchor). The richer /pricing page (4-tier comparison incl. Pro/Team seats + retention) is reachable only by URL or a quota-upgrade CTA — a buyer never lands on it.",
    "evidence": ["src/components/Brand.tsx:55", "src/components/Brand.tsx:127", "src/app/pricing/page.tsx:18-67"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-TOMAS-04",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "dimension": "effort",
    "title": "/about leads with org-installation CTAs ('Scan your org' → /connect, 'Explore demo' → /org/vercel), not the free public scan",
    "expected": "If a buyer reaches /about first, the frictionless free single-repo scan should be the obvious next step.",
    "got": "Both /about CTAs (hero + closing) route to /connect (org install → toward sign-in) and /org/vercel (needs a populated DB). The free public ScanForm is only on '/'. A buyer who opens /about cold sees a heavier front door.",
    "evidence": ["src/components/about/AboutHero.tsx:50-63", "src/components/about/AboutCTA.tsx:24-37"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "L1-TOMAS-05",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Anonymous public scan skips PR + branch-governance signals — D3/D6/D7/D8 lean on detectors only on the very scan a buyer runs",
    "expected": "A scan whose governance/process read reconciles with a repo he knows.",
    "got": "No token (anonymous) ⇒ fetchPrStats/fetchBranchGovernance return null; the process block degrades to '(unavailable)' and the report warns 'PR signals were skipped'. Honest, but D3/D6/D7/D8 are partly un-evidenced on the buyer's self-serve scan.",
    "evidence": ["src/lib/scan.ts:136-141", "src/lib/scan.ts:156-161", "src/lib/scan.ts:316-320", "src/lib/scoring/prompt.ts:18-21"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "On a live anonymous scan of a repo Tomáš knows (e.g. vercel/next.js), confirm the governance dimensions still read credibly with the warning, and that he isn't misled into thinking the repo is ungoverned when it's the scan that's blind."
  },
  {
    "id": "L1-TOMAS-S1",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "effort",
    "title": "STRENGTH — primary CTA is a true no-login public scan; this is the exact front door his references demand",
    "expected": "A free, self-serve 'test in my environment' look as the obvious front door, not a demo-request gate.",
    "got": "Hero IS the ScanForm; paste/click a repo → /report, no auth, no email, no card; public scans bypass the auth gate; sub-copy 'No signup · Results in under a minute'.",
    "evidence": ["src/components/landing/prototypes/index/IndexHero.tsx:52", "src/components/ScanForm.tsx:85", "src/app/api/scan/route.ts:50", "src/components/landing/prototypes/index/IndexHero.tsx:63-69"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "L1-TOMAS-S2",
    "journey": "evaluate-whether-to-adopt",
    "character": "Tomáš (prospective buyer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — grounding chain is senior-grade: signal-prioritized file sampling, guardbanded blend, per-dimension evidence, auditor discrepancies, honest caveats",
    "expected": "A score he could defend upward — grounded in concrete repo signals, reconciling, not hand-wavy.",
    "got": "32-file signal-prioritized sampling; full-content detectors; LLM guardbanded ±band, coverage-weighted 60/40 blend; evidence + strengths/gaps per dimension; partial-coverage and detector-failure warnings; LLM-vs-detector discrepancies surfaced as 'Flagged for review'.",
    "evidence": ["src/lib/github/source.ts:520-628", "src/lib/scoring/engine.ts:70-156", "src/lib/scoring/prompt.ts:46,138-141", "src/components/report/ReportView.tsx:171-183,245-261"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Run the scan live on a repo he knows and confirm the rendered scores/evidence/roadmap actually read senior-grade (and aren't the deterministic mock floor) — this is the make-or-break."
  }
]
```

---

## Character feedback (first person, in Tomáš's voice)

Okay. Two minutes in, here's where I land.

**What it is, who it's for, the next step — I got those fast.** The landing page doesn't make me hunt. "A single 0–100 score on a 5-level ladder across 9 dimensions, with the evidence behind every number" — that's a sentence I can repeat to my VP without translating. It's clearly pitched at someone in my chair: posture, adoption-vs-rigor, governance, supply-chain. And the next step is *right there* — a box that says paste a repo and scan, no signup, no "book a demo." That's the part most vendors get wrong and these people got right. I didn't have to give them my email to see the thing work. Good.

**Does it work — I can't fully tell from the marketing, and that's deliberate.** There's no case study, no "we doubled X for company Y." That's fine *if* the scan I run is good enough to be its own proof — and on paper the machinery looks like something a staff engineer built, not a marketing team: it reads the actual repo, the LLM is fenced to the detectors so it can't hallucinate a score, every dimension carries its evidence, and it even flags where the AI thinks its own detectors are wrong. That's the kind of glass-box I'd actually trust. The honest caveat I'd want to verify: when I scan anonymously, it skips the PR-review and branch-protection signals — so on the four dimensions I care most about as a platform lead, the public scan is partly flying blind, and it says so. Honest, but it means my free look undersells the governance read. And I genuinely can't tell from code whether the live scan gives me real Claude output or the deterministic floor — if I paste `vercel/next.js` and get a generic read, I'm out. That's the whole ballgame and I have to see it live.

**What it costs — this is where I'd stall.** Free for public repos, fine. But the moment I ask "what does it cost to run this on *our* private monorepo," the answer is "prepaid credits — indicative, final rate TBD" and Enterprise is "Contact us." I've been burned by exactly this. "TBD" and "talk to us" is the polite version of "we haven't figured out if you can afford us." I'm not filling in a form to learn the basics. If I'm building a buy/no-buy memo for nervous leadership, "I don't know what it costs yet" is not a line I can write. So: **the product looks real, the front door is exactly right, and the pricing is the thing that would keep this off my shortlist** — not because it's expensive, but because it's invisible.

**Verdict I'd defend:** *worth a deeper look — conditional.* The scan is the proving ground and it's built right on paper; I'd run it on a repo I know before I commit. But put a number on the private tier, or you'll lose buyers like me at the price step, after you've already won them at the front door.

---

## l2_priority (carry-forward — what L2 must verify live)

- **The make-or-break:** run a live anonymous public scan on a repo Tomáš knows (`vercel/next.js` / `facebook/react`) and confirm the rendered report is **senior-grade real Claude output, not the deterministic MockProvider floor** — scores reconcile with the known codebase, evidence is concrete, roadmap names a specific move. (`LLM_PROVIDER=auto`+no-key degrades to mock; env pins `claude-cli`.)
- Confirm the **anonymous-scan governance caveat** (D3/D6/D7/D8 detector-only) doesn't mislead him into reading a well-governed repo as ungoverned; verify the "Heads up" warning renders prominently.
- Verify **no numeric price** ever appears before a sign-up across `/pricing`, the quota-upgrade CTA, and any checkout entry — confirm whether the only "contact" path is genuinely Enterprise-only.
- Confirm **scan latency** on a real repo stays under his patience (SSE progress visible; the env budgets tens of seconds to minutes — an early client timeout would itself be a finding).
- Confirm `/launch` behavior for an anonymous visitor (redirect to `/connect` / sign-in prompt) doesn't trap a buyer who clicks a `/launch` link from elsewhere.
