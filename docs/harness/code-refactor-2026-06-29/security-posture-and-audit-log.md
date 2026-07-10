# Code Refactor — Security Posture & Audit Log
> Total: 4 | Critical: 0 High: 2 Medium: 1 Low: 1

## 1. PDF document scaffolding duplicated across the three pdf/*-document.tsx files
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/pdf/security-document.tsx:9-47,110-113 (also src/lib/pdf/briefing-document.tsx:16-63,179-182 and src/lib/pdf/report-document.tsx:9-49,128-131)
- **Scenario**: Each of the three PDF documents independently re-declares the same theme palette (`ACCENT`/`INK`/`MUTED`/`FAINT`/`LINE`), a byte-identical `scoreColor(s)` (the 80/60/40 band → color), the same base `StyleSheet` keys (`page`, `kicker`, `h1`, `rule`, `statsRow`, `stat`, `statLabel`, `statVal`, `statSub`, `sectionH`, `footer`, `muted`), and the same fixed footer block (`Scored by … · … pageNumber / totalPages`). `security-document.tsx` and `briefing-document.tsx` additionally contain a word-for-word identical `Stat` sub-component.
- **Root cause**: The security PDF was created by copy-pasting briefing-document.tsx (its own header comment says "Mirrors briefing-document.tsx's light theme"); no shared PDF theme module was ever extracted, so each new `*-document.tsx` clones the chrome.
- **Impact**: ~70 lines of identical scaffolding live in triplicate. A theme tweak (palette, footer wording, score thresholds) must be hand-applied in 3 files and silently drifts when one is missed; the three documents already differ subtly in `h1` size (24 vs 22) for no reason traceable to a shared source.
- **Fix sketch**: Add `src/lib/pdf/theme.ts(x)` exporting the color constants, `scoreColor`, the shared base `StyleSheet` fragment, the `Stat` component, and a `<PdfFooter brand subject />` component. Have all three `*-document.tsx` import them and keep only their document-specific styles/sections. Net: ~140 → ~50 lines of chrome.

## 2. recordOrgAudit's "resolve orgId then audit" tail is re-rolled in ~13 routes
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/scans-audit.ts:57-65 (canonical helper) vs. ~13 hand-rolled call sites
- **Scenario**: `recordOrgAudit(action, slug, meta, actorId)` exists expressly as "the single home for the 'resolve orgId, then audit on success' tail that every owner-gated org mutation repeats" — it does `const orgId = (await getOrgId(slug).catch(() => null)) ?? undefined; return recordAudit(...)`. Yet only 3 routes use it (org/members, org/playbooks/[id], org/playbooks/[id]/apply). Thirteen other routes inline the exact same tail: `const orgId = (await getOrgId(x.toLowerCase()).catch(() => null)) ?? undefined;` followed by `recordAudit(action, meta, { orgId, actorId })`. Confirmed sites: api/app/webhook, api/cron/rescan, api/practices/apply, api/practices/apply-batch, api/org/alerts, api/org/plan, api/org/gate-policy, api/org/invites, api/org/invites/accept, api/org/llm-provider (×2), api/org/skills/[id] (×2), api/report/passport/pr, api/report/passport/overrides.
- **Root cause**: The consolidation helper was introduced after most of these routes already shipped, and the migration to it stalled after 3 routes. The manual `.toLowerCase()` is itself redundant because `getOrgId` already normalizes (`slug.trim().toLowerCase()`).
- **Impact**: ~15 copies of the same 1–2 line resolve-and-record boilerplate; any change to how org audits are stamped (e.g. capturing a failed-resolution warning) must be applied in 14 places, and the redundant `.toLowerCase()` invites the false belief that callers must pre-normalize.
- **Fix sketch**: Replace each `getOrgId(...).catch(...) ?? undefined` + `recordAudit(action, meta, { orgId, actorId })` pair with a single `recordOrgAudit(action, slug, meta, actorId)`. Drop the now-unused `getOrgId` import from those routes. Each route loses 1–2 lines and an import.

## 3. Four near-identical org-slug→id resolvers; scans-audit.ts uses two of them inconsistently
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/scans-audit.ts:5-6,63,143 — imports BOTH `resolveOrgId` (from scans-shared) and `getOrgId` (from org-rollup)
- **Scenario**: The same `organization.findUnique({ where: { slug }, select: { id } }) → id ?? null` lookup is implemented four times: `resolveOrgId` (src/lib/db/scans-shared.ts:183-189, exported), `getOrgId` (src/lib/db/org-rollup.ts:34-39, exported via the `@/lib/db` barrel, adds `isDbConfigured()` guard + `slug.trim().toLowerCase()` normalization), plus byte-identical private copies in src/lib/db/segments.ts:34-37 and src/lib/db/plan.ts:41-44. scans-audit.ts reaches for `getOrgId` in `recordOrgAudit` but `resolveOrgId` in `getAuditLog` — two different resolvers for the same job in one file.
- **Root cause**: Each module grew its own resolver; the only differences are accidental (whether casing is normalized and whether DB-config is guarded), not intentional, so they quietly diverge in behavior.
- **Impact**: Four implementations of a one-liner that should be canonical; the casing-normalization difference is a latent inconsistency (a mixed-case slug resolves under `getOrgId` but not under `resolveOrgId`), and the dual import in scans-audit.ts is actively confusing.
- **Fix sketch**: Keep the most defensive one (`getOrgId`, with normalization + db-guard) as the single canonical resolver, re-export it from scans-shared if an internal-only seam is needed, delete the private copies in segments.ts/plan.ts, and have scans-audit.ts use it in both functions. Update tests that mock `resolveOrgId`.

## 4. security/page.tsx recomputes the filtered supply-chain repo list twice
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/org/[slug]/security/page.tsx:138-140
- **Scenario**: `supply.repos.filter((r) => r.total > 0)` is evaluated once for the `.length > 0` guard and again for `.slice(0, 8).map(...)` immediately below.
- **Root cause**: The guard and the render were written inline against the raw `supply.repos` without hoisting the shared filtered array.
- **Impact**: Trivial double work and a place where the two `r.total > 0` predicates could drift; minor readability cost.
- **Fix sketch**: Hoist `const withAdvisories = supply.repos.filter((r) => r.total > 0);` above the JSX and reference it in both the guard and the `.slice(0, 8).map(...)`.
