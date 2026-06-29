# Executive Briefing — Bug + UI Scan
> Context: Executive Briefing (Org Planning & Execution)
> Total: 5 findings (0 critical, 1 high, 4 medium, 0 low)

## 1. Durable board PDF silently drops the mock-degraded engine-mix provenance
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/lib/pdf/briefing-document.tsx:84-186 (engineMix never referenced); cross-ref src/lib/org/briefing.ts:102-104, 320-323; src/app/org/[slug]/executive/page.tsx:134-143; src/app/share/briefing/[token]/page.tsx (no engineMix render)
- **Value**: impact 8 · effort 2 · risk 1
- **Scenario**: A quarter where some repos were scored by the deterministic Mock engine (a fallback, not the live model). On the Executive page and in the "Copy for LLM" markdown the reader sees "Scored by … ⚠ some scores used the deterministic mock engine, not the live model". The owner exports the PDF for the board / an auditor — the PDF shows the headline maturity numbers with **no provenance caveat at all**.
- **Root cause**: `briefing.engineMix` was added (per the ExecBriefing field comment) specifically "so a mock-degraded quarter is auditable in the **durable briefing**, not just the transient scan stream." `engineMixLabel`/`engineMixDegraded` exist and are wired into the page + markdown, but `BriefingDocument` — the actual durable artifact — never renders them. The shared read-only board page omits them too.
- **Impact**: The artifact most likely to be circulated to leadership/auditors presents possibly-synthetic scores as authoritative — success theater. Directly defeats the stated audit purpose.
- **Fix sketch**: Render an engine-mix footer line in `BriefingDocument` (and the shared page) reusing `engineMixLabel`/`engineMixDegraded`, e.g. a muted "Scored by …" with the ⚠ degraded clause when `engineMixDegraded(b.engineMix)`. To make the class impossible, drive page/PDF/share from one shared "provenance line" helper so a new surface can't silently omit it.

## 2. Board PDF and shared page present a noisy/low-confidence forecast as a confident headline
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/pdf/briefing-document.tsx:112; src/app/share/briefing/[token]/page.tsx:70-75; cross-ref src/lib/org/briefing.ts:316-319 and src/app/org/[slug]/executive/page.tsx:151-155
- **Value**: impact 6 · effort 2 · risk 1
- **Scenario**: `forecastConfidence` is 30% (R²; `< 50` ⇒ "noisy"). The Executive page renders "trend confidence 30% · noisy" and the LLM markdown appends "(trend confidence 30%, noisy)". The PDF and the shared board link render only `Trajectory: <headline>` with no confidence and no "noisy" flag.
- **Root cause**: `forecastConfidence` is assembled into `ExecBriefing` and used by page + markdown, but `BriefingDocument` line 112 and the shared page lines 70-75 print `forecastHeadline` bare.
- **Impact**: Leadership reads a statistically weak projection ("on track to reach L4 in 6 weeks") as a firm commitment — the exact over-promise the page/markdown were careful to hedge.
- **Fix sketch**: Append the same `forecastConfidence`/"noisy" suffix to the PDF Trajectory line and the shared page, ideally via a shared formatter so all three stay in lockstep.

## 3. PDF white-label branding is not plan-gated like the page and the branding write API
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption (entitlement bypass)
- **File**: src/app/api/org/briefing/pdf/route.ts:25,44-61; cross-ref src/app/org/[slug]/executive/page.tsx:51-54 and src/app/api/org/branding/route.ts:26
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: An org on Team/Enterprise sets brand name/logo (allowed by `planAllowsWhiteLabel`), then downgrades to free/pro. The branding row persists. The page now hides `BrandingSettings` (canBrand = `isOwner && planAllowsWhiteLabel(credit.plan)`), but `/api/org/briefing/pdf` still calls `getOrgBranding(org)` and white-labels the PDF — and strips "ascent" from the download filename — with no plan check. Any read-level member (not just an owner) can download the branded PDF.
- **Root cause**: The route enforces only `requireOrgRead` and never imports/checks `planAllowsWhiteLabel`, so the entitlement gate the page and the branding-write endpoint share is missing on the consumption path.
- **Impact**: A paid (Team+) feature is delivered to non-entitled orgs; inconsistent with the UI and the write gate. Makes white-label a non-enforceable entitlement.
- **Fix sketch**: In the PDF route, resolve `getCreditState(org)` and only pass `branding` to `BriefingDocument` when `planAllowsWhiteLabel(credit?.plan)`; otherwise render unbranded (and keep the "ascent" filename). Centralize as a `resolveBriefingBranding(org)` helper reused by page + PDF.

## 4. Sparse fleet shows the same dimension as both a Strength and a Weakness (and labels low scores "Strengths")
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/org/briefing.ts:190-195,269-271; src/app/org/[slug]/executive/page.tsx:196-211
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: A new/partial fleet rolls up only a few dims, e.g. `[D1=90, D2=60, D9=30]`. `strengthDims = slice(0,3)` = all three (so D9@30 is listed under **Strengths**). The disjoint logic then makes `risks = []`. But the Weakest card's security special-case renders D9 anyway: `briefing.security && briefing.risks.every(r => r.dimId !== "D9")` is true on an empty `risks`. So **D9 appears in both Strengths and Weakest**, and a 30/100 dim is presented as a "strength".
- **Root cause**: The disjoint-list fix (excluding strengths from the risk pool) is bypassed by the independent `security` special-case in the page; and `strengthDims = slice(0,3)` assumes ≥6 dims so the top-3 are genuinely strong. The 3/5-dim cases are explicitly exercised in briefing.test.ts, so the scenario is recognized.
- **Impact**: Self-contradicting exec read — the same dimension framed as both a top strength and the key weakness; weak dimensions mislabeled as strengths. Erodes trust in the board view.
- **Fix sketch**: Suppress the security special-case row when `briefing.security.dimId` is already in `strengths` (or only show it when it isn't already displayed), and/or cap `strengthDims` to dims above a floor / to `min(3, dims.length - risks.length)` so an obviously-weak dim is never bucketed as a strength.

## 5. 14-day briefing share tokens have no revocation path
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure (access control)
- **File**: src/lib/briefing-share.ts:38-46,49-81; src/app/api/org/briefing/share/route.ts:14-28; src/app/share/briefing/[token]/page.tsx:31-47
- **Value**: impact 5 · effort 5 · risk 3
- **Scenario**: An owner mints a read-only link (valid 14 days). The owner is later removed from the org, the org's plan/scope changes, or the link leaks. `verifyBriefingShareToken` only checks HMAC signature + `exp`, then `buildExecBriefing` re-runs with no session — so the link keeps serving live fleet maturity data for the full 14 days with no kill switch.
- **Root cause**: The token is a self-contained stateless capability (no `jti`, no server-side denylist, no per-link/per-org secret). The only revocation lever is rotating `BRIEFING_SHARE_SECRET`, which nukes every outstanding link at once. (Mirrors live-share.ts by design, so this is a known tradeoff worth a team decision.)
- **Impact**: Continued read access to confidential fleet standing after the grantor loses authority or the link leaks; can't revoke a single link.
- **Fix sketch**: Add a `jti` to the payload and a small server-side denylist (or an `org_share_revocations` row with a `mintedAfter` cutoff per org), checked in `verifyBriefingShareToken`; surface a "revoke shared links" owner action. If statelessness must hold, at minimum shorten TTL and bind the token to the minting membership.
