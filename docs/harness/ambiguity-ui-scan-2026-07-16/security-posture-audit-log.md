# Security Posture & Audit Log — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)

## 1. Auditor-facing PDF is titled "Supply-chain & security posture" but contains zero supply-chain data — and no degraded warning
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/lib/pdf/security-document.tsx:28` (also `src/app/api/org/security/pdf/route.ts:34`)
- **Scenario**: The PDF route builds only `buildSecurityOverview` and never calls `getOrgSupplyChain`, yet the document's `subject` (line 28) and `Footer` note (line 90) both say "Supply-chain & security posture". The route comment claims page/clipboard/PDF "stay in lockstep", but the page and the LLM brief were both hardened to surface advisories AND the `degraded` (advisory-fetch-failed) state, while the PDF — explicitly "the hand the auditor / leadership a report artifact" — carries neither advisories nor the UNKNOWN warning.
- **Root cause**: The degraded-honesty fix (page banner + `## Supply chain — UNKNOWN` markdown section, both tested in `security.test.ts:45-64`) was applied to two of the three renderings of the same overview; the PDF was left on the pre-supply-chain shape and its title/subject were never reconciled.
- **Impact**: The most formal, most filed artifact makes the strongest claim ("supply-chain posture") with the least data. An auditor receiving the PDF during an advisory outage sees a document that implicitly reads clean — exactly the "reports clean when it could not look" false signal the page comment (page.tsx:64-68) calls the most dangerous one this view can emit.
- **Fix sketch**: Thread `getOrgSupplyChain(org, techGroupId)` into the route, add an advisories column/section to `SecurityDocument` (mirroring `securityMarkdown`), render an explicit "Supply chain — UNKNOWN (advisory fetch failed)" block when `supply?.degraded`, and when supply is off either omit the claim or retitle subject/footer to "Security posture".

## 2. Supply-chain `repos` is silently capped at the 10 worst, but consumers treat it as a complete per-repo map
- **Severity**: High
- **Category**: undocumented-assumption
- **File**: `src/lib/security/supply-chain.ts:189` (consumers: `src/components/org/security/SecurityRiskRegister.tsx:158-159`, `src/lib/org/security.ts:202,214`)
- **Scenario**: `getOrgSupplyChain` returns `repos: rows.slice(0, 10)` (worst-first) while `scanned: rows.length`. The Security page maps `supply.repos` into the register's advisories column, and the register renders `adv ? "0" : "—"` per row. For any fleet with >10 scanned repos: (a) a repo scanned CLEAN but ranked 11+ shows "—" (reads as "not scanned/unknown") instead of "0", and (b) a repo WITH open advisories ranked 11th (e.g. 40 medium/low, sorted below repos with criticals) also shows "—" — its real advisories vanish from both the register and the LLM brief's advisories column.
- **Root cause**: The cap was sized for the old "top offenders" card, but the register and `securityMarkdown` now consume `repos` as a lookup map keyed by fullName, an implicit "complete coverage" assumption the `OrgSupplyChain` interface never states (the `repos` doc says only "worst-first").
- **Impact**: On fleets >10 repos the advisory column is wrong in both directions — clean repos look un-assessed and moderately-vulnerable repos look un-assessed — in a security view whose whole design theme is "never render unknown as clean" (or here, real findings as unknown).
- **Fix sketch**: Return all rows (they're already fetched and reduced into `totals`; the cap saves nothing) and let display surfaces cap at render time — or add a `byRepo` map alongside the capped `repos`, and document the cap on the interface.

## 3. Mock-provider demo advisories render in the UI unlabeled, with live GitHub links
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/app/org/[slug]/security/page.tsx:134` (flag defined at `src/lib/security/supply-chain.ts:27`)
- **Scenario**: `OrgSupplyChain.demo` exists precisely "so the UI can label it honestly", and `securityMarkdown` does (`## Supply chain (Dependabot — demo data)`, security.ts:240). But the Security page never reads `supply.demo`: with `SUPPLY_CHAIN_PROVIDER=mock`, the register's advisories column shows deterministic fabricated counts (e.g. "2C 3H 12 ↗") styled identically to real data, each linking to `https://github.com/<repo>/security/dependabot` — a page that will show something entirely different.
- **Root cause**: The honesty flag was wired into the clipboard artifact but not the on-screen one; the page passes only `{fullName, critical, high, total}` down, dropping the provenance.
- **Impact**: Anyone demoing or evaluating with the mock provider sees invented vulnerability counts presented as fleet fact; clicking through to GitHub contradicts the dashboard and erodes trust in the real numbers too.
- **Fix sketch**: When `supply.demo`, render a small "demo data" chip next to the advisories column header (and/or suppress the GitHub deep-links), mirroring the markdown's label. One boolean prop on `SecurityRiskRegister`.

## 4. "Paste-ready CI gate snippet" silently covers at most 8 failing repos
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/org/[slug]/security/page.tsx:56-62` (cap at `src/lib/org/security.ts:176`)
- **Scenario**: The Control-matrix header offers "Copy CI gate snippet", built from `gate.failingRepos` and commented as "Concrete, paste-ready CI enforcement for THIS fleet — failing repos first". But `securityGate.failingRepos` is `failing.slice(0, 8)` — an undocumented cap sized for the old "weakest repos" card. An org with 20 gate-failing repos copies a snippet that enforces 8 of them, with no "…and 12 more" marker, while the tile right above says "20 fail".
- **Root cause**: The snippet consumer assumes `failingRepos` is exhaustive; the producer caps it for display. Related cap drift across the same data: markdown register caps at 15 (with an explicit "…and N more" line), PDF at 20 (ditto), snippet at 8 (silent).
- **Impact**: A team that pastes the snippet believes the whole fleet is gated; the 12 uncovered failing repos ship ungated — a quietly incomplete enforcement artifact generated by the security page itself.
- **Fix sketch**: Build the snippet from the full register (`sec.register.filter(r => r.gateReason)`) instead of the capped `failingRepos`, or append a `# …and N more failing repos — see the risk register` trailer when truncated. Name the display cap (`FAILING_DISPLAY_CAP = 8`) where it's sliced.

## 5. AuditLogViewer has two filter-apply models, and the CSV link follows the un-applied one
- **Severity**: Low
- **Category**: interaction-inconsistency
- **File**: `src/components/org/audit/AuditLogViewer.tsx:143-151` (inputs 173-189, CSV 191)
- **Scenario**: Changing the Action select refetches immediately (`changeAction`), but since/until/actor only take effect on the "Apply" button — pressing Enter in the actor field does nothing (no `<form>`/onKeyDown). Meanwhile `csvHref` is rebuilt from live state on every keystroke, so after typing an actor WITHOUT clicking Apply, "Download CSV" exports a filter set the on-screen table has never shown — the filed evidence and the reviewed rows disagree.
- **Root cause**: Two interaction models coexist (auto-apply vs. explicit apply) and the CSV anchor binds to raw input state rather than the last-applied filter set.
- **Impact**: Confusing filter UX (date changes appear to "do nothing" until users find Apply), keyboard users can't submit from the text input, and the CSV can silently diverge from the visible table in a compliance-export context.
- **Fix sketch**: Wrap the filter row in a `<form onSubmit={applyFilters}>` (Enter submits; make Apply `type="submit"`), keep a separate `applied` filter state, and derive both the table loads and `csvHref` from `applied` — or auto-apply date/actor on change/blur to match the select.
