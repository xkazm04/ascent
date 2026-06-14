# Feature Scout — Executive Briefing (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Scheduled / emailed briefing — the briefing never reaches an inbox
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/cron/digest/route.ts:75-95 · src/lib/org/briefing.ts:4 (`Phase 5.2 the scheduled PDF digest`)
- **Scenario**: A VP/CTO wants the exec briefing to land in their inbox every Monday without logging in. The "show leadership" artifact is only valuable if leadership actually sees it on a cadence.
- **Gap**: There is no email channel anywhere — grep for `nodemailer|resend|smtp|email|recipient` over `src/` returns only Slack/webhook code. The weekly cron (`/api/cron/digest`) builds a Slack Block-Kit message via `buildFleetDigestMessage` and `dispatchAlert` POSTs only to a Slack-compatible webhook (`src/lib/alerts.ts:317`). It links to `/org/[slug]/executive` but never attaches or emails the PDF. The briefing module's own header comment promises a "(Phase 5.2) scheduled PDF digest" that does not exist. Leaders without Slack — i.e. most execs — get nothing.
- **Impact**: Every org leader. This is the habit loop the product's whole "board-ready" positioning depends on; an unopened dashboard has near-zero exec value. Competitors (LinearB, Jellyfish, Code Climate Velocity) all push periodic exec digests by email.
- **Fix sketch**: Add `src/lib/email.ts` (Resend/SES adapter, no-op without `RESEND_API_KEY`/SES creds, mirroring `dispatchAlert`'s graceful-degrade pattern). Add an `org.briefingRecipients` column + a `/api/org/briefing/subscribe` route. Extend `/api/cron/digest` to, per org, call `buildExecBriefing` + `renderToBuffer(BriefingDocument)` and email the PDF as an attachment alongside an HTML body reusing `briefingMarkdown`. ~1.5 days.

## 2. Briefing omits the "what to do next" recommendations it already computes
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/org/briefing.ts:81-136 (no `getOrgRecommendations` call) · cf. src/app/api/cron/digest/route.ts:67 (digest *does* fetch it)
- **Scenario**: An exec reads the briefing, sees "Security 41/100, weakest dimension" — and then asks "so what do we *do*?". The artifact diagnoses but doesn't prescribe.
- **Gap**: `buildExecBriefing` assembles rollup, benchmark, movers, and goals but never calls `getOrgRecommendations`, even though the function exists, is already wired into the weekly digest (`getOrgRecommendations(org, 1)` → "Highest-leverage gap"), and the org Overview page surfaces leverage moves. The briefing instead ends with a *static* ASK telling the reader to go paste it into an LLM themselves (`briefing.ts:190`). The single most board-relevant content — the prioritized action list, with affected-repo counts — is built but unexposed here.
- **Impact**: Every leader and EM. Turns the briefing from a scorecard into a decision document; the recommendations carry `repoCount` so "fix X across 7 repos" is quantified. Zero new data plumbing — the query already exists.
- **Fix sketch**: Add `getOrgRecommendations(orgSlug, 3)` to the `Promise.all` in `buildExecBriefing`, add a `recommendations: BriefingRec[]` field to `ExecBriefing`, render a "Recommended actions" `Card` on the page, a section in `BriefingDocument`, and a `## Recommended actions` block in `briefingMarkdown`. Update `briefing.test.ts` fixture. ~0.5 day.

## 3. LLM-written executive narrative (the provider layer is idle)
- **Severity**: High
- **Category**: feature
- **File**: src/lib/org/briefing.ts:144-192 (`briefingMarkdown`) · src/lib/llm/index.ts:85 (`getProvider`)
- **Scenario**: Leadership wants a 3–4 sentence prose paragraph — "Maturity rose 4 points to L3 this quarter, driven by testing gains in the API fleet; security remains the largest risk at 41…" — not just bullets and meters they have to interpret themselves.
- **Gap**: The briefing is 100% template assembly. There is a full multi-provider LLM layer (`getProvider`, Gemini/Bedrock/OpenAI/Claude-CLI in `src/lib/llm/`) used for scoring, but it is never invoked to *write* the briefing. The current "narrative" is a hardcoded ASK string pushing the work onto the reader. No `narrative`/`summary` field is generated (grep confirms no `generateSummary`/`narrative` in `briefing.ts`).
- **Impact**: Every exec consumer; this is the single biggest perceived-quality lift for a "show leadership" artifact and a clear differentiator. Degrades cleanly: fall back to today's template when no LLM key (mock provider).
- **Fix sketch**: Add `async function narrateBriefing(b, provider)` in a new `src/lib/org/briefing-narrative.ts` that feeds the assembled `ExecBriefing` to `getProvider().complete(...)` with a tight exec-tone prompt and a deterministic template fallback (`hasLlmKey()` gate). Surface as a lead paragraph on the page, a "Summary" block in the PDF, and the brief's intro. Make the PDF route `await` it. ~1 day.

## 4. Period-over-period exec deltas are a single number, not a comparison view
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/lib/org/briefing.ts:105 (`periodDelta`) · src/app/org/[slug]/executive/page.tsx:62
- **Scenario**: A board review asks "how does this quarter compare to last quarter?" The exec wants prior-vs-current side by side across dimensions, benchmark, and coverage — the classic QBR before/after.
- **Gap**: The only period comparison is `periodDelta` = a single overall-score delta vs the window's *start baseline* (`rollup.baseline.avgOverall`). There is no prior-*period* rollup, no per-dimension before/after, no benchmark trend, no coverage-growth line. Movement is per-repo (`getOrgMovers`), never an aggregate quarter-over-quarter table. So the briefing answers "are we up or down a bit" but not "how did Q2 compare to Q1 across the board".
- **Impact**: Execs running QBRs and board decks — the core audience. Period-over-period framing is the native language of leadership reporting and what makes the artifact reusable each cycle.
- **Fix sketch**: Have `buildExecBriefing` fetch a second `getOrgRollup` for the immediately-preceding equal-length window (derive from `OrgWindow`), compute per-dimension and headline deltas, add a `priorPeriod` block to `ExecBriefing`, and render a "vs previous period" two-column comparison on the page + PDF. ~1 day.

## 5. White-label / branded briefing (logo, accent, company name)
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/pdf/briefing-document.tsx:9-10,80 (`ACCENT = "#2563eb"`, kicker `"Ascent · Executive briefing"`)
- **Scenario**: A platform team hands the PDF to *their* leadership and wants it to read as their company's report — their logo and brand color — not an "Ascent" advert. Agencies/consultancies scanning client fleets want the same.
- **Gap**: All branding is hardcoded: the accent (`#2563eb`), the "Ascent" kicker/footer/author, and the title. There are no `branding`/`logoUrl`/`brandColor`/`companyName` fields on the org (grep across `src/` finds none; the `org.ts` hit was a false positive). The PDF cannot be customized per tenant.
- **Impact**: Enterprise buyers and consultancy/MSP users — a recognized upsell/enterprise-tier lever and an adoption blocker for "I can't show this to my CFO with a vendor logo on it."
- **Fix sketch**: Add `org.brandName`, `org.brandColor`, `org.logoUrl` columns + a settings form; thread an optional `branding` prop into `BriefingDocument` (replace `ACCENT`/kicker/footer; `<Image src={logoUrl}>` in the header) and into the page header. Gate behind an entitlement tier. ~1 day.

## 6. Shareable read-only briefing link (no auth wall for the recipient)
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/org/briefing/pdf/route.ts:24-25 (`requireOrgRead(org)`) · src/app/org/[slug]/executive/page.tsx
- **Scenario**: A platform lead wants to send the briefing to a board member or an external auditor who has no Ascent account — a stable URL that renders the briefing (or streams the PDF) without making them sign in.
- **Gap**: Both the page and the PDF route are hard-gated by `requireOrgRead`; the only unauthenticated surface in the app is the SVG `/api/badge/[owner]/[repo]`. There is no signed/tokenized share link, no public snapshot, no expiry — grep for `share|publicLink|token` finds only session/auth tokens, nothing briefing-scoped. Sharing today means downloading the PDF and manually attaching it.
- **Impact**: Leaders and external stakeholders (board, auditors, prospective customers). Frictionless sharing is both a workflow win and a viral/growth surface (recipient sees the product).
- **Fix sketch**: Add a `briefing_share` token table (org, window params, expiry, revocable) + `/api/org/briefing/share` (create) and a public `/share/briefing/[token]` route that resolves the token, re-runs `buildExecBriefing`, and renders a read-only view + PDF link. Rate-limit and expire. ~1.5 days.
