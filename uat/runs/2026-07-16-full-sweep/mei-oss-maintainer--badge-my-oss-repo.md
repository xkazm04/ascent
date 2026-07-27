# L1 (theoretical) — Mei (OSS Maintainer) × "Badge my OSS repo"

cert_level: L1 · date: 2026-07-16 · mode: static/code-grounded, no browser

## 1. Surface model (import-chain traced, file:line cited)

### Entry — `/` (landing, scan trigger)
- `src/app/page.tsx:62-89` — server page. Resolves `auth` (`supabaseAuthConfigured() ? "supabase" : ...`, `page.tsx:70`) and `gated = authGateEnabled()` (`page.tsx:74`, from `src/lib/access.ts:19` re-exporting `src/lib/env.ts:42-44`).
- `authGateEnabled()` = `supabaseAuthConfigured() && !authBypassEnabled()` (`src/lib/env.ts:42-44`). Per `uat/env.md` §Auth, the bypass is **hard-gated off in production**, and Supabase OAuth is the live production auth backend — so on the real public deployment Mei uses, `authGateEnabled() === true`.
- Landing renders `IndexLanding` → `IndexVariant` → hero `ScanModal` (`src/components/landing/prototypes/index/ScanModal.tsx`), passed `gated` (prop `gated?: boolean`, `ScanModal.tsx:29`).
- `ScanModal.tsx:136`: `const locked = gated && signedIn !== true;` — when `gated` (production) and no confirmed signed-in viewer, the dialog renders the **locked branch** (`ScanModal.tsx:202-214`): a "Sign in to scan" panel with only a `SignInButton` (GitHub/Supabase OAuth), no `ScanForm` at all. The unlocked branch's own copy — "Public scans never need an account" (`ScanModal.tsx:237`) — never renders in this state; the locked branch's copy is undifferentiated ("Scanning is for signed-in members on this deployment", `ScanModal.tsx:206-209`) and does not carve out public repos.

### Scan execution — the affordance behind "Scan"
- Unlocked path only: `ScanForm.submit()` (`src/components/ScanForm.tsx:119-149`) → `router.push('/report?repo=...')` → `src/app/report/page.tsx` → `ReportClient` → (not read in full, but per its own comments and the API it drives) `POST`/`GET` `/api/scan/stream` or `/api/scan`.
- `src/app/api/scan/route.ts:128-133`: *"Public sign-in wall — placed AFTER the cache-hit... only a REAL new scan (which spends GitHub + LLM) requires sign-in. In production `authGateEnabled()` is true..."* → `if (authGateEnabled() && !(await getViewer())) return 401 "Sign in to run a scan."`
- `src/app/api/scan/stream/route.ts:71-82`: identical gate, with the comment stating it explicitly: *"In production ... EVERY scan requires a signed-in viewer — LLM cost is easily abused, so the public funnel is gated too, not just private/org scans."*
- **Net effect:** a first-time, uncached, *public* repo scan — Mei's actual JTBD #1 — requires GitHub/Supabase sign-in in production. Only a previously **cached** report (`GET /api/scan?peek=1`) is free to view.

### Badge — `/badge` and `/api/badge/[owner]/[repo]`
- `src/app/badge/page.tsx:1-32` — no auth check in the page itself; renders `BadgeGenerator` (client component).
- `src/components/badge/BadgeGenerator.tsx:36-198` — repo input, kind (level/score/gate), style, format chips; `badgeUrl` points at `/api/badge/{owner}/{repo}`.
- `src/app/api/badge/[owner]/[repo]/route.ts:230-404` — **unauthenticated**, no `authGateEnabled`/`getViewer` check anywhere in this file. On a cache miss it calls `scanRepository(..., { mock: true, noAmbientToken: true })` **directly** (`route.ts:318`), bypassing the `/api/scan` HTTP gate entirely (it's an in-process function call, not an HTTP round-trip). So `/badge` always produces *something* free — but only a **mock/deterministic** badge (`isMock` check at `route.ts:351`, appends "· demo" to the label) unless an LLM-graded report for that exact commit is already cached (which, per the scan gate above, requires having signed in to produce one).
- Badge copy formats: Markdown / HTML / AsciiDoc (`BadgeGenerator.tsx:72-82`), each linking to `badgeReportHref` (`src/lib/badge.ts`, click-through to the report). Copy uses a real clipboard-write state machine with a manual-copy fallback on failure (`BadgeGenerator.tsx:84-96`).
- Modes: `kind` = level / score / gate (`BadgeGenerator.tsx:39`, `?gate=1` / `?metric=score` params), each rendered server-side by `route.ts:355-391` via `evaluateGate` (`src/lib/scoring/gate.ts`) — level mode and pass/fail gate mode both exist, matching Mei's expectation.

### GitHub Action PR maturity gate
- `action.yml:1-82` (repo root) — a real, publishable composite Action. Calls `node scripts/maturity-gate.mjs` against `GET /api/gate/:owner/:repo` (`src/app/api/gate/[owner]/[repo]/route.ts:33-187`), which is **explicitly unauthenticated by design** (`route.ts:48-54`: *"this endpoint is unauthenticated by design — CI calls it with plain curl"*) and returns 200 pass / 422 fail — no account, no LLM cost risk (mock by default; `?mock=0`/`live: true` opts into the real grade).
- **Discoverability:** grepping the entire public-facing `src/app/**` and `src/components/**` tree for any link to `action.yml`, "GitHub Action", or `/api/gate` usage instructions turns up exactly one UI surface: `src/app/org/[slug]/governance/page.tsx:212-217` — the copy-paste snippet ("GitHub Action" label + `GET <ASCENT_URL>/api/gate/<owner>/<repo>?...`) lives **only** on the authed org governance tab. Nothing on `/`, `/badge`, `/report`, `/report/[owner]/[repo]`, `/pricing`, or `/about` mentions the Action, links to `action.yml`, or explains `/api/gate`.
- `/org/[slug]` requires an org (`node scripts/seed-org.mjs <org>` in dev; in production, org onboarding/import) — not a surface a solo personal-repo maintainer like Mei, who has no org context, would ever create or reach.

## 2. Reachability check (Mei's actual surface set)

Mei is an anonymous first-time visitor on the real production deployment (no dev bypass — she doesn't run this codebase; she's hitting the hosted Ascent).
- **Reachable, no auth:** `/`, `/about`, `/pricing`, `/badge`, `/report` (form), `/report/[owner]/[repo]` (only for a repo with a *cached* report), `/api/badge/*` (mock-only), `/api/gate/*` (mock-or-live, works, but undiscovered).
- **NOT reachable without signing in:** running a *fresh* scan of her own repo via `/`, `/report?repo=...`, or `ColdScanGate`'s "Scan now" (`src/components/report/ColdScanGate.tsx:36-42` → mounts `ReportClient` → same gated `/api/scan/stream`) — i.e. the entire path to a *real, LLM-graded* first report for an uncached repo.
- **Out of reach by design, correctly out of scope for L1:** `/org/[slug]/*` (governance, the only surface carrying the Action snippet) — not a finding in itself per the journey's own "out of scope" list (org rollups aren't her surface) — but its status as the *sole home* of the Action instructions **is** a finding, because JTBD #3 needs that content on a surface she can reach.

## 3. Grounding audit (AI surface: the maturity report LLM scoring)

Ascent's report blends deterministic detectors + an LLM narrator, guardbanded to detected evidence (per `src/app/page.tsx:32` FAQ copy and prior repo history — D9 security posture, provenance track). Scoring the *evidence-citation* dimension of the design specifically for Mei's bar ("each dimension cites concrete, clickable evidence she can click into"):

| Source Mei expects reflected | Reaches the UI? |
|---|---|
| Real repo signals (CI, tests, docs, governance) | Yes — `src/lib/analyze/pulls.ts:253-260` etc. produce factual evidence strings ("Default branch `main` is protected", "Status checks required before merge") |
| Evidence rendered per dimension | Yes — `src/components/report/DimensionCard.tsx:78-89` lists `d.evidence` under each dimension |
| Evidence **clickable** (links to the actual file/PR/commit on GitHub) | **No** — `DimensionCard.tsx:82-88` renders each evidence item as a bare `<span>{e}</span>`; no `<a href>` to a GitHub blob/PR/commit URL anywhere in this component or `DimensionExplorer.tsx` |
| Provenance (signal vs LLM vs blended) surfaced | Partially — `report.engine`/`confidence`/`warnings` exist and are wired into `/api/gate`'s honesty guard (`route.ts:117-167`), but on the visible dimension card the reader sees prose evidence, not a labeled signal→LLM track |

**Grounding score: 3/5** (real evidence reaches the UI; is dimension-scoped; is factual/specific — but not hyperlinked, and provenance-track labeling isn't visible at the per-dimension evidence level Mei reads first). This directly under-shoots her explicit "clickable evidence" bar.

## 4. In-character walkthrough (cognitive walkthrough + Mei's scored criteria)

*(Mei, evening, laptop, ninety minutes, testing whether this is real or a funnel.)*

**Step 1 — landing, hit "Scan a repository."** I know what to do — the button's obvious, the copy ("Paste any public GitHub repo… returns a maturity level + roadmap") matches my intent. Good so far.

**Step 2 — the dialog.** This is where it forks on me. If nobody's ever scanned my repo before — and why would they have — I land on a locked panel: "Scanning is for signed-in members on this deployment... Sign in with GitHub to run your scan." That's a **hard stop against my #1 rule.** I don't create accounts for a personal OSS scan. I'm not reading the fine print that says "public repositories are free" — that line only shows up in the *unlocked* variant I never see. What I see is a wall. I'm gone at this point in the real world — but let me theoretically push through it, because the badge might still be reachable another way.

**Step 3 — try `/badge` directly instead.** Paste `mei-org/my-lib`, pick level mode. I get a badge! ...marked "· demo." That's the deterministic mock rubric, not a real read of my repo. The tip under the generator even tells me: "scan the repo first" for the full AI-scored version — which loops me straight back to the sign-in wall from step 2. So the free path terminates at a demo badge I would never paste in front of thousands of developers, because I can't vouch for a number I know is a canned floor score, not a read of my actual test suite and CI.

**Step 4 (theoretical, if I did sign in).** Report evidence: I see real facts under each dimension ("branch protection: on", governance rules) — good, not vague. But nothing's a link. I can't click through to the actual workflow file or PR that earned the score. For a badge going in front of thousands of strangers, "trust me" prose is short of what I'd want to defend it.

**Step 5 — the PR maturity gate.** I go looking for it. Nothing on the badge page, nothing on the report page, nothing on pricing or about. If I didn't already know `action.yml` exists in Ascent's own repo, I would never find it from the product. JTBD #3 dead-ends on discovery, even though — I later learn by reading the code, which a real user never would — the underlying `/api/gate` endpoint is genuinely free and unauthenticated.

## 5. Findings

- id: L1-MEI-BADGE-01
  journey: badge-my-oss-repo
  character: Mei (OSS Maintainer)
  cert_level: L1
  type: broken-flow
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: completion
  title: Fresh public-repo scan requires GitHub/Supabase sign-in in production, contradicting the hard no-signup bar
  expected: "Scan my own public repo for free, with no signup, no login, no email, no payment" (character scored criterion #1; journey definition-of-done #1)
  got: "`src/app/api/scan/route.ts:130-133` and `src/app/api/scan/stream/route.ts:71-82` gate EVERY scan (not just private/org ones) behind `authGateEnabled() && !getViewer()` in production, per the code's own comment ('EVERY scan requires a signed-in viewer... the public funnel is gated too'). Only a previously cached report stays free."
  evidence: ["src/app/api/scan/route.ts:130-133", "src/app/api/scan/stream/route.ts:71-82", "src/components/landing/prototypes/index/ScanModal.tsx:136,202-214"]
  code_check: confirmed-absent (no anonymous fresh-scan path exists in production)
  verdict: confirmed
  resolution: open
  l2_priority: "Confirm live whether the actual deployed environment truly runs authGateEnabled()=true (Supabase configured, bypass off) for real users, and whether an anonymous fresh scan genuinely 401s in the browser — this is the single highest-priority live check for this journey."
  scope_note: "The badge/gate endpoints (/api/badge, /api/gate) bypass this gate via direct in-process scanRepository() calls, so a mock/demo badge and the CI gate stay free — only the LLM-graded report path is blocked."

- id: L1-MEI-BADGE-02
  journey: badge-my-oss-repo
  character: Mei (OSS Maintainer)
  cert_level: L1
  type: confusion
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: In-app copy contradicts itself on whether public scans need an account
  expected: Consistent, accurate messaging about the no-signup bar (Nielsen: match to real world / consistency)
  got: "ScanModal's unlocked branch says 'Public scans never need an account' (ScanModal.tsx:237) but that copy is unreachable exactly when the gate is enforced — the locked branch (ScanModal.tsx:206-209) instead says scanning requires sign-in with no public/private distinction, i.e. the one branch a gated deployment's anonymous visitor actually sees never mentions that public scans are supposed to be free."
  evidence: ["src/components/landing/prototypes/index/ScanModal.tsx:202-214,237"]
  code_check: present-broken
  verdict: confirmed
  resolution: open
  l2_priority: "Screenshot the locked dialog live and confirm the copy shown matches this reading."

- id: L1-MEI-BADGE-03
  journey: badge-my-oss-repo
  character: Mei (OSS Maintainer)
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Published GitHub Action PR maturity gate is undiscoverable from any surface Mei can reach
  expected: "Optionally wire up the published GitHub Action PR maturity gate" (JTBD #3); journey discovery hint (d) — find and understand how to install it
  got: "action.yml and /api/gate are real and free (unauthenticated by design, route.ts:48-54), but the ONLY in-app instructions/snippet live at src/app/org/[slug]/governance/page.tsx:212-217 — an authed org surface. Nothing on /, /badge, /report, /pricing, or /about links to it."
  evidence: ["action.yml:1-82", "src/app/api/gate/[owner]/[repo]/route.ts:48-54", "src/app/org/[slug]/governance/page.tsx:212-217"]
  code_check: present-but-missed
  verdict: confirmed
  resolution: open
  l2_priority: "Confirm live that no link/mention of the Action exists on /badge or /report for a solo, org-less repo owner."

- id: L1-MEI-BADGE-04
  journey: badge-my-oss-repo
  character: Mei (OSS Maintainer)
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: trust
  title: Dimension evidence is plain text, not clickable, falling short of the character's explicit "clickable evidence" bar
  expected: "each dimension cites concrete, clickable evidence she can click into" (character scored criterion #2)
  got: "DimensionCard.tsx:82-88 renders each evidence string as a bare <span>, with no href to the underlying file/PR/commit on GitHub."
  evidence: ["src/components/report/DimensionCard.tsx:78-89"]
  code_check: confirmed-absent
  verdict: confirmed
  resolution: open
  l2_priority: "Confirm live report evidence is genuinely unlinked (not just rendered plain then styled as a link via CSS)."

## 6. Verdict

**L1-fail.** The journey's own definition of done opens with "scanned my own public repo without ever creating an account, signing in, or paying" — and the traced import chain shows that in production, a first-time (uncached) public-repo scan hits a hard sign-in wall (`L1-MEI-BADGE-01`). Because virtually every real-world invocation of this journey is a first scan of an unfamiliar repo, this is not an edge case — it's the modal path. That's a structural gap that blocks the job as Mei defines it, before quality/trust questions about the report or badge even come into play. Findings 02–04 compound it (contradictory copy, an unreachable free CI gate, non-clickable evidence) and should be fixed alongside it, but 01 alone is decisive for the verdict.

Grounding score: 3/5 (see §3).
Estimated time-saved **if the design promises held**: ~75–80 min (character's "an evening" ≈ 90 min baseline down to "minutes" for scan+badge, per Motivation section) — but this is the *design* upside; the actual signup wall means the promise doesn't land for a first-time anonymous user today.

## 7. Character voice — would I adopt it?

"Okay, I like the shape of this — level badge, gate badge, three markup formats, evidence per dimension, all sound like someone who's actually used a Scorecard badge before. But I hit a 'sign in with GitHub' screen the first time I tried to scan my *own public* repo, and that's an instant no from me. I don't care that the fine print somewhere says public scans are free — I never saw that screen, I saw the one that told me to sign in. 'Money doesn't write code' and neither does an account I didn't ask to create.

I could get a badge without signing in — but it's a demo badge, and a demo badge in my README is worse than no badge. I've spent years telling my contributors not to trust vanity numbers; I'm not about to paste one myself.

The CI gate is the most honest piece of this whole thing — genuinely no-account, just a curl call — and you've buried it on a dashboard I'll never open because I don't run an org here, I run a repo. If you put that `action.yml` snippet on the badge page next to the Markdown I'm already copying, I'd probably wire it up tonight.

So: not yet. Fix the free path so a first scan of my repo doesn't need an account, put real evidence links under each dimension, and surface the Action where a solo maintainer can actually find it — then I'd paste this next to my Scorecard badge and I'd tell people about it. Right now I'm closing the tab at the sign-in wall."
