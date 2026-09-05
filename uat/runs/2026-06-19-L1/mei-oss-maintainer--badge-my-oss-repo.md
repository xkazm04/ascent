# L1 — Mei (OSS Maintainer) × badge-my-oss-repo

**Verdict: L1-conditional** — the public path (scan → report → badge) is genuinely anonymous and the scoring machinery is well-grounded and evidence-backed, but two major findings stand between Mei and a badge she'd paste: the `/badge` generator is **undiscoverable** from the UI (no link anywhere — header, footer, or report), and the badge it emits runs a **deterministic MOCK scan** by default, so the README badge can disagree with the credible LLM report unless she scans first. No blockers; the job completes structurally for someone who knows the `/badge` URL.

---

## Reachable surface set

Mei is anonymous: no Supabase session, no installation token, no `ASCENT_AUTH_BYPASS`. The login wall (`authGateEnabled()`, `src/lib/access.ts:44`) only enforces when Supabase is configured AND bypass is off, and the scan route only invokes it for `orgSlug !== "public"` (`src/app/api/scan/route.ts:50`). Every step of her path keys `orgSlug === "public"` with no token, so the gate is never consulted.

Reachable with zero signup/login/email/payment:
- **`/`** — landing + `ScanForm` (`src/app/page.tsx:79` → `IndexHero` → `ScanForm` at `src/components/landing/prototypes/index/IndexHero.tsx:52`). Public.
- **`/report/[owner]/[repo]`** and **`/report?repo=`** — permalink + live scan (`src/app/report/[owner]/[repo]/page.tsx`). On a DB miss it falls back to `ReportClient` (`page.tsx:75`), which streams a fresh anonymous scan — no DB required. Public.
- **`/badge`** — generator (`src/app/badge/page.tsx`). Public, **but only reachable by typing the URL** (see Finding A1).
- **`/api/badge/[owner]/[repo]`** — the SVG endpoint (`src/app/api/badge/[owner]/[repo]/route.ts`). Public, unauthenticated, rate-limited, cached.
- **`/api/gate/[owner]/[repo]`** + **`action.yml`** — the CI gate. The GitHub Action is reachable/installable, but requires a **self-hosted Ascent deployment** (`action.yml:21`, `ascent-url` is `required: true`) — a real boundary (Finding A4).

Out of reach by design (boundary she won't cross, correctly gated): `/org/*` dashboards, history/trends (`/api/history` returns 401/503 to a signed-out viewer per `ReportView.tsx:44-51`), private repos, persistent badge hosting. None of these block the public badge path.

**No-signup/no-paywall HARD constraint: CONFIRMED.** The entire scan → report → badge path is account-free and money-free in code. The only friction is the weekly quota, which is a soft nudge, not a wall (Finding S1).

---

## Surface model notes (key affordances → backing `file:line`)

- **Scan input** — `ScanForm` (`src/components/ScanForm.tsx:30`) normalizes `owner/repo`/URL and routes to `/report?repo=` → `ReportClient` (`src/components/report/ReportClient.tsx:31`) → POST `/api/scan/stream` (live LLM scan, SSE). Anonymous, no token.
- **Public-scan path auth** — `src/app/api/scan/route.ts:50` gates only non-public orgSlug; `runScan` for a public tokenless repo never hits `requireViewer`. Quota consumed at `route.ts:116-126` (only `orgSlug==="public" && !token && !mock`).
- **Quota (soft gate)** — `src/lib/public-scan-quota.ts`: anon default **3/week** (`:46`), signed-in **20** (`:56`), fails OPEN when DB unconfigured/disabled/errors (`:163-165`, `:213-217`), kill switch `PUBLIC_SCAN_QUOTA_DISABLED` (`:61`). A DB-less deploy has **no limit at all** (`src/app/page.tsx:69-72`). On a trip it salvages the last persisted report rather than dead-ending (`ReportClient.tsx:122-150`).
- **Grounding / credibility** (Mei's senior-quality bar):
  - Ingest reads ≤**32 files** over the GitHub API + raw host, no clone, no token needed (`src/lib/github/source.ts:36`, `:520` pick list deliberately grabs CLAUDE.md/AGENTS.md, CI, tests, manifests, docs). Coverage is scaled by fetch success rate so a blip can't read as fully covered (`:630-642`).
  - Deterministic detectors produce **concrete, repo-specific evidence strings** — e.g. "Detailed agent guidance (4k+ chars)", "Documents build/test/run commands", "Status checks required before merge", "AI involved in X% of PRs" (`src/lib/analyze/index.ts:100-118`, `src/lib/analyze/pulls.ts:186-265`). This is real signal, not vanity metrics.
  - The prompt feeds the LLM the rubric, the deterministic signal scores, PR/branch-protection process signals, commit sample, and file excerpts, and instructs it to **calibrate to the signals** and flag detector misses (`src/lib/scoring/prompt.ts:46`, `:111-141`).
  - The engine **guardbands** the LLM to ±`LLM_GUARDBAND` of the signal and blends 60/40 scaled by coverage (`src/lib/scoring/engine.ts:70-102`); surfaces warnings when the LLM scored only some dims (`:135-146`), warns loudly on total detector failure so an incomplete scan can't masquerade as a real L1 (`:151-156`); discrepancies surface as "Flagged for review" (`ReportView.tsx:245-261`).
  - **Provenance is visible**: every DimensionCard renders a signal→LLM→blended track with the guardband zone (`src/components/report/DimensionCard.tsx:103`, `:117-159`). This is exactly the "show your work" Mei wants.
- **Badge SVG** — `src/app/api/badge/[owner]/[repo]/route.ts`: shields-style flat/flat-square/for-the-badge (`:198`), level/score/gate modes (`:219-222`, `:336-356`), level glyph for CVD redundancy (`:349`), click-through `href` to `/report/...?ref=badge` (`:267`, `:174-176`), per-IP rate limit + negative cache + outcome-branched CDN TTLs (`:184-187`, `:291-297`), private-repo never disclosed (`:309-311`), validated name grammar (`:37-42`).
- **Badge generator** — `src/components/badge/BadgeGenerator.tsx`: emits **paste-ready Markdown / HTML / AsciiDoc** that wraps the badge in a link to the report (`:59-69`), copy button (`:71-76`), live preview (`:127-139`), level/score/gate + style toggles. This is the artifact Mei wants — once she finds it.
- **Gate** — `src/lib/scoring/gate.ts`: archetype-aware defaults (solo→L2, team/org→L3, `:58-68`), fail-closed on unscored dims (`:45-47`), positive-floor parsing so `?min_overall=0` can't silently disarm CI (`:251-258`). `action.yml` composite action calls `/api/gate`.

---

## Findings

```json
[
  {
    "id": "MEI-L1-A1",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "dimension": "missing",
    "title": "The /badge generator is undiscoverable — no link from the header, footer, or the report",
    "expected": "After reading her score, a clear 'Get the README badge' CTA on the report (the OpenSSF Scorecard flow: see results → grab the badge).",
    "got": "/badge exists and works, but nothing in the UI links to it. The report header offers Export PDF and Onboarding skill but no badge CTA; SiteHeader nav and SiteFooter omit it entirely.",
    "evidence": [
      "src/components/report/ReportHeader.tsx:56-71",
      "src/components/report/ReportView.tsx:263-270",
      "src/components/Brand.tsx:48-112",
      "src/components/Brand.tsx:118-145",
      "src/app/badge/page.tsx:9"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Confirm live there is no badge entry point reachable by click from / or the report (search rendered DOM, not just .tsx).",
    "suggested_acceptance": "A 'Get README badge' link on the report header (and/or footer) deep-links to /badge with her repo prefilled."
  },
  {
    "id": "MEI-L1-A2",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The badge renders a deterministic MOCK level by default — it can disagree with the credible LLM report",
    "expected": "The badge in her README reflects the same credible, LLM-scored level she saw on the report — a badge that contradicts the report is worse than no badge.",
    "got": "On a cache miss the badge endpoint runs scanRepository(..., { mock: true }) — the deterministic rubric, not the LLM scan. The badge only matches the real report when an LLM scan was already cached/persisted for that exact head SHA. The generator's footnote admits this ('runs a fast deterministic scan on first request… for a full AI-scored report, scan the repo first') but a maintainer pasting the badge URL cold gets the mock level, and after a push the SHA-keyed cache misses again.",
    "evidence": [
      "src/app/api/badge/[owner]/[repo]/route.ts:286-303",
      "src/app/api/badge/[owner]/[repo]/route.ts:1-3",
      "src/components/badge/BadgeGenerator.tsx:165-168"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "Live: scan a repo (LLM), then load its badge — confirm the badge level == report level for the same head; then push a commit and confirm whether the badge silently reverts to the mock level until a re-scan.",
    "suggested_acceptance": "Badge resolves to the most recent LLM report for the repo (any commit, with a freshness note) rather than minting a divergent mock level, OR the generator makes 'scan first' a required step, not a footnote."
  },
  {
    "id": "MEI-L1-A3",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "dimension": "trust",
    "title": "Per-dimension evidence is descriptive text, not clickable file links",
    "expected": "Like the OpenSSF Scorecard ('links to detailed results'), each dimension's evidence links into the repo at the file it's about, so she can verify the claim.",
    "got": "Evidence is concrete and repo-specific (e.g. 'Status checks required before merge', 'Detailed agent guidance (4k+ chars)') but rendered as plain <span> text. There is no hyperlink to the file/line that produced it. The provenance track shows signal→LLM→blended numerically, which partly satisfies 'show your work', but she cannot click through to the underlying file.",
    "evidence": [
      "src/components/report/DimensionCard.tsx:75-87",
      "src/lib/analyze/index.ts:100-118",
      "src/lib/analyze/pulls.ts:243-250"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Live: open a dimension card and confirm the evidence items are not links; judge whether the descriptive evidence + provenance track is enough for her to vouch publicly without click-through.",
    "suggested_acceptance": "Evidence items that name a file (CLAUDE.md, a workflow, package.json) link to that path on github.com at the scanned ref."
  },
  {
    "id": "MEI-L1-A4",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "dimension": "missing",
    "title": "The PR maturity gate Action requires a self-hosted Ascent deployment (ascent-url)",
    "expected": "Install a published Action once, like Scorecard's action — no infrastructure to run.",
    "got": "action.yml requires `ascent-url` (the URL of an Ascent deployment serving /api/gate). A solo unpaid maintainer has nowhere to point it unless the project hosts a public gate endpoint. This is the honest boundary for the gate piece — the scan/report/badge still fully deliver without it.",
    "evidence": [
      "action.yml:20-27",
      "action.yml:52-71",
      "src/app/api/gate/[owner]/[repo]/route.ts:18-39"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Confirm whether the hosted Ascent deployment exposes a public /api/gate Mei could point ascent-url at without self-hosting.",
    "suggested_acceptance": "Either a hosted public gate endpoint documented for OSS use, or the action.yml docs clearly state self-hosting is required so she isn't surprised."
  },
  {
    "id": "MEI-L1-S1",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "completion",
    "title": "STRENGTH — the no-signup/no-paywall constraint is genuinely honored in code",
    "expected": "Scan her own public repo and read the full report with no account, no email, no payment.",
    "got": "The public scan path never consults the login wall (gate only fires for non-public orgSlug). The weekly quota is a soft, fail-open nudge (default 3/week anon; no limit at all on a DB-less deploy), and a tripped quota salvages the last persisted report instead of walling her out. Signing in is offered as a way to RAISE the limit, never required to read a public score.",
    "evidence": [
      "src/app/api/scan/route.ts:50",
      "src/lib/public-scan-quota.ts:163-165",
      "src/lib/public-scan-quota.ts:213-217",
      "src/app/page.tsx:69-72",
      "src/components/report/ReportClient.tsx:122-150"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "MEI-L1-S2",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "dimension": "senior-quality",
    "title": "STRENGTH — the score is grounded, guardbanded, and provenance-visible (not a vibe with a logo)",
    "expected": "A credible, traceable score she could stake her name on, calibrated to her real repo.",
    "got": "Real per-dimension evidence from ≤32 sampled files + PR/branch-protection signals; the LLM is guardbanded to ±band of the deterministic signal and blended by coverage; partial-coverage and total-failure cases warn loudly rather than fabricating an L1; the signal→LLM→blended provenance track is shown per dimension; LLM-vs-detector discrepancies are surfaced as 'Flagged for review'. The badge endpoint correctly refuses to disclose a private repo's level.",
    "evidence": [
      "src/lib/scoring/engine.ts:70-102",
      "src/lib/scoring/engine.ts:135-156",
      "src/lib/scoring/prompt.ts:46",
      "src/components/report/DimensionCard.tsx:117-159",
      "src/components/report/ReportView.tsx:245-261",
      "src/app/api/badge/[owner]/[repo]/route.ts:309-311"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "MEI-L1-S3",
    "journey": "badge-my-oss-repo",
    "character": "Mei (OSS Maintainer)",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "polish",
    "dimension": "completion",
    "title": "STRENGTH — the badge generator emits clean paste-ready Markdown/HTML/AsciiDoc in level AND gate modes, linking back to the report",
    "expected": "A single Shields-style badge with paste-ready snippets, level + pass/fail gate modes, that links back to evidence.",
    "got": "BadgeGenerator offers level/score/gate kinds × flat/flat-square/for-the-badge styles, a live preview, a copy button, and all three formats — each snippet wraps the badge in a link to /report. The SVG endpoint adds CVD-safe level glyphs and a click-through href. This is exactly the artifact she asked for.",
    "evidence": [
      "src/components/badge/BadgeGenerator.tsx:45-69",
      "src/components/badge/BadgeGenerator.tsx:101-123",
      "src/app/api/badge/[owner]/[repo]/route.ts:319-356"
    ],
    "code_check": "by-design",
    "verdict": "confirmed"
  }
]
```

---

## Character feedback (Mei, first person)

Okay — first, the thing I came to check: can I scan my own public repo without making an account? Yes. I read the code, the login wall literally doesn't touch the public path, and the weekly cap is a soft nudge that fails open and even hands me my last saved report instead of a dead-end wall. No "connect GitHub," no email gate, no "upgrade to see your score." That's honest. I relax a little.

And the score isn't a vibe with a logo. It reads my actual files — my CLAUDE.md, my CI, my tests, my branch protection — gives me concrete evidence per dimension, and it shows the math: deterministic signal, the LLM nudge, the guardband, the blend. When the model only scored half my dimensions it *says so*. When detectors all failed it refuses to call my repo L1 and warns. That's the part most of these tools get wrong, and they got it right. I'd trust this number more than most of the shields already on my README.

But two things stop me short of pasting it tonight. First: **where is the badge?** I scanned, I read the report — and there's no "get the badge" button anywhere. Export PDF, sure. An onboarding skill, sure. But the one thing I came for, the badge, is on some `/badge` page nothing links to. The whole OSS-health flow is "see your results, here's your badge." If I hadn't been told the URL I'd have left assuming it didn't exist.

Second, and this is the dealbreaker until it's fixed: the badge runs a *mock* deterministic scan by default. So the level in my README can be a different number than the credible LLM report I just read — and after every push the SHA cache misses and it can quietly drop back to the mock. A badge that says one thing while my report says another, in front of thousands of devs? That's exactly the slop I'm trying to keep out. I need the badge to be the report, or it doesn't go in.

The gate I get less excited about — it needs a self-hosted Ascent URL, and I'm one unpaid person; I'm not standing up infrastructure for a PR check. If there's a hosted endpoint I can point at, tell me; otherwise that's the line I won't cross, and that's fine — the badge was the prize.

Would I adopt it? On paper, *almost*. Fix the discoverability and make the badge reflect the real score, and I'm thinking about which README section it goes in. As shipped, I'd bookmark it and wait.

---

## l2_priority (carry-forward — what L2 must verify live)

- **Badge ↔ report agreement (A2):** scan a repo with the LLM, then load its badge for the same head — does the badge level equal the report level? Then push a commit and re-check: does the badge silently revert to the mock level until a manual re-scan?
- **Badge discoverability (A1):** from `/` and from a finished report, is there ANY clickable path to `/badge`? (Inspect the rendered DOM, not just source.)
- **Evidence trust without click-through (A3):** is the descriptive evidence + provenance track enough for a senior maintainer to vouch publicly, or does the lack of file links read as hand-wavy?
- **Score reconciliation (senior-quality, live):** scan a real, mature OSS repo (good tests + CI, no `.ai/` conventions) and confirm the live level reconciles — strong rigor doesn't read as L1, and absent agent conventions don't read as fully AI-Native.
- **Gate hosting (A4):** is there a hosted public `/api/gate` an OSS maintainer could use without self-hosting, or is self-hosting truly required?
- **Paste fidelity:** copy the Markdown/HTML/AsciiDoc snippets and confirm they render a working, linked badge in a real README/GitHub preview.
