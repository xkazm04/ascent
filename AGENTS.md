<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Code structure

## Max 300 LOC per `.tsx` file

Keep every React component file (`.tsx`) at **300 lines of code or fewer**. A file approaching the limit is the signal to extract, not to keep appending.

- **Remedy:** pull internal sub-components, their private helpers, and constants into **co-located files** in the same directory (e.g. `report/ScoreWaterfall.tsx`, `report/DimensionCard.tsx`). The original file keeps the orchestrator/page component and imports the extracted pieces. Preserve behavior exactly — extraction is pure relocation, not a redesign. Add `"use client"` to any extracted file that uses hooks or event handlers.
- **Related (`.ts` modules):** a large non-component module (the rule targets `.tsx`, but apply the spirit) is best split into themed sub-modules with the original file kept as a **thin re-export barrel**, so callers and `db/index.ts`-style barrels stay unchanged. See `src/lib/db/org.ts` and `src/lib/db/scans.ts` for the pattern.
- **Check before committing a `.tsx` you grew:**
  ```powershell
  Get-ChildItem -Recurse -Filter *.tsx src | Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
    ForEach-Object { [pscustomobject]@{ LOC=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName } } |
    Where-Object { $_.LOC -gt 300 } | Sort-Object LOC -Descending
  ```
  (Use `-LiteralPath` so App Router `[slug]`/`[owner]` bracket dirs aren't treated as wildcards.)
- **Status:** the codebase currently has **zero** `.tsx` files over 300 LOC — keep it that way. New and edited `.tsx` files must comply from the start; if an edit would push a file over the limit, extract first (don't commit the over-limit file).

---

# Documentation Sync — one surface, same-session enforcement

Ascent has one docs surface for implemented product: **`docs/features/<area>/`**,
where `<area>` mirrors a group in `context-map.json`. Development happens through
Claude with no second human reviewer to catch drift, so enforcement lives here and
in a Stop hook.

**The design choice is per-session gap-prevention, not a periodic catch-up.** Drift
compounds across sessions much faster than a batch pass can clear it. A
six-agent audit on 2026-07-28 measured the cost of not having this rule: of 22
feature docs, only 8 were current, 9 were materially wrong, and two whole
context-map groups had no doc at all. The worst cases weren't missing docs — they
were docs that confidently asserted a limitation the code had since removed
(`practices.md` said bulk-apply didn't exist; `apply-batch` had shipped). A reader
trusts a stated "Known gap" more than silence, so a stale one does more damage
than an absent doc. Full evidence: [`docs/DOC-DRIFT.md`](docs/DOC-DRIFT.md).

## The rule

When a turn edits **feature source** with a **user-visible** effect — new route,
tab, or command; changed flow; removed feature; new schema column that surfaces in
UI; renamed table; new tier gate — update the coupled feature doc **in the same
turn**.

If the change is internal-only (refactor, bugfix without behavior shift, generated
code, test-only), no doc update is needed. Dismiss the hook with one short sentence
naming why.

**When you close a gap, delete the "Known gap" that described it.** This is the
single highest-value half of the rule and the one the audit shows gets skipped.

## Source → doc map

[`scripts/docs/feature-doc-map.json`](scripts/docs/feature-doc-map.json) is the
authoritative map; each entry declares `area`, `doc`, and `sourceGlobs`. Quick
reference:

| Source area | Feature doc |
| --- | --- |
| `src/lib/scan.ts`, `src/lib/analyze/**`, `src/app/api/scan/**` | `docs/features/scanning/scan.md` |
| `src/lib/maturity/**`, `src/lib/scoring/engine.ts` | `docs/features/scanning/maturity-model.md` |
| `src/lib/scoring/gate*.ts`, `src/app/api/gate/**` | `docs/features/scanning/gate.md` |
| `src/lib/llm/**`, `src/lib/db/org-llm.ts` | `docs/features/scanning/llm-providers.md` |
| `src/lib/{auth,access,authz}.ts`, `src/lib/supabase/**`, `src/app/api/auth/**` | `docs/features/github/auth.md` |
| `src/lib/github/**`, `src/app/api/app/**`, `src/app/connect/**` | `docs/features/github/github-app.md` |
| `src/components/onboarding/**`, `src/app/launch/**` | `docs/features/onboarding/wizard.md` |
| `src/lib/standard/**` | `docs/features/onboarding/ai-manifest-spec.md` |
| `src/lib/alerts.ts`, `src/app/api/cron/digest/**` | `docs/features/fleet/alerts.md` |
| `src/app/api/cron/rescan/**`, `src/lib/db/org-watch.ts`, `src/lib/scan-credit.ts` | `docs/features/fleet/rescan.md` |
| `src/app/api/cron/purge/**`, `src/lib/db/retention.ts` | `docs/features/data/retention.md` |
| `src/lib/practices/**`, `src/app/api/practices/**` | `docs/features/org-dashboard/practices.md` |
| `src/app/org/**`, `src/components/org/**`, `src/lib/org/**` | `docs/features/org-dashboard/org-intelligence.md` |
| `src/lib/scoring/orgsim.ts`, `src/components/org/{plan,backlog,live,executive}/**` | `docs/features/org-planning/plan.md` |
| `src/lib/memory/**`, `src/lib/db/org-memory*.ts` | `docs/features/org-knowledge/memory.md` |
| `src/lib/org/skill-*.ts`, `src/lib/db/org-{skills,api-tokens}.ts` | `docs/features/org-knowledge/skills.md` |
| `src/app/report/**`, `src/components/report/**`, `src/lib/report/**` | `docs/features/reporting/report.md` |
| `src/lib/{plans,polar,entitlement}.ts`, `src/app/api/billing/**` | `docs/features/billing/billing.md` |
| `src/lib/db/usage.ts`, `src/lib/rate-limit.ts` | `docs/features/billing/usage.md` |
| `src/app/api/badge/**`, `src/lib/badge.ts` | `docs/features/billing/badge.md` |
| `prisma/schema.prisma`, `src/lib/db/{client,scans}.ts` | `docs/features/data/data-model.md` |
| `src/components/{ui,deck,landing}/**`, `src/app/about/**` | `docs/features/design-system/README.md` |

When you add a feature area, add an entry to `feature-doc-map.json` **and** create
`docs/features/<area>/README.md` in the same change.

## The Stop hook

`.claude/settings.json` registers a Stop hook running
`node scripts/docs/check-doc-sync.mjs` before every turn ends. It walks the current
turn's transcript for `Edit`/`Write`/`MultiEdit`/`NotebookEdit` calls, drops skip
patterns (tests, generated code, `docs/`, `drizzle/`, `.claude/`), matches the rest
against `feature-doc-map.json`, and exits 2 naming the affected doc(s) if no
`docs/features/*` file was touched. It honors `stop_hook_active`, so it can't loop.

When you see the reminder, **either** update the named doc(s) this turn, **or**
reply with one short sentence explaining why it's internal-only. Don't ignore it
silently — the dismiss path is the explicit trade-off for per-session enforcement.

Tests: `node scripts/docs/__tests__/check-doc-sync.test.mjs` (231 assertions, no
deps). It verifies the glob semantics and that **every** `sourceGlob` matches at
least one tracked file — a renamed directory would otherwise silently switch the
nag off for a whole area.

## Docs that are not feature docs

- `docs/*.md` top level — living cross-cutting docs (PRD, ARCHITECTURE, SETUP,
  VISION-TRANSITION, VALUE-CASE, REFERENCE-SCAN-AUDIT, DOC-DRIFT). Not hook-enforced.
- `docs/archive/**` — dated, point-in-time artifacts. **Append-only; never edit to
  make them "current."** Their value is being an accurate record of a past moment.
- `docs/harness/` — gitignored local scan-run output. Not part of the corpus.
