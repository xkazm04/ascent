# Code Refactor — Usage Metering & Public Badge
> Total: 5 | Critical: 0 High: 0 Medium: 3 Low: 2

## 1. Badge `readableOn` re-implements ui.ts's WCAG luminance + contrast-pick
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/badge/[owner]/[repo]/route.ts:82-94 (vs src/lib/ui.ts:109-145)
- **Scenario**: The badge route's `readableOn(bg)` parses a hex color, computes WCAG relative luminance via the channel-linearization formula (`v <= 0.03928 ? v/12.92 : ((v+0.055)/1.055)**2.4` with the `0.2126/0.7152/0.0722` weights), then contrast-picks near-black ink (`#04070e`) vs white. `src/lib/ui.ts` already contains the identical luminance math split across `rgbOf` (hex→rgb), `relLuminance` (the same linearization + weights), and the same contrast-pick (`contrastInk = (le+0.05)/0.05` vs a light fallback) inside `heatCell`.
- **Root cause**: ui.ts keeps `rgbOf`/`relLuminance` module-private, so the server badge route grew its own copy of the same WCAG primitives instead of importing them. The two contrast-picks differ only in the "light" color (badge uses pure `#fff`, heatCell uses `#e2e8f0`).
- **Impact**: The WCAG linearization constants now live in two places; a future accessibility retune (or a bug in the magic constants) must be made twice or silently desyncs the badge's text legibility from the rest of the app. ~12 duplicated lines of non-obvious math across two files.
- **Fix sketch**: Export a small helper from ui.ts — e.g. `readableInkOn(hex: string, light = "#fff"): string` built on the existing `rgbOf` + `relLuminance` — and have both `heatCell` and the badge route call it. The badge route already imports `LEVEL_GLYPH`/`LEVEL_HEX` from `@/lib/ui` (client+server safe), so the new import is free; delete `readableOn`'s inline `lin`/`L` block.

## 2. Provider→label map duplicated between /usage and the executive briefing
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/usage/page.tsx:50-59 (vs src/lib/org/briefing.ts:19-30)
- **Scenario**: `usage/page.tsx` declares `PROVIDER_META` mapping `gemini`/`bedrock`/`claude`/`claude-cli`/`mock` to `{ label, color }`, plus a `providerMeta(id)` fallback. `src/lib/org/briefing.ts` declares `ENGINE_LABEL` mapping the same five provider ids to the same human labels (`"AWS Bedrock"`, `"Mock (deterministic)"`, `"Gemini"`, `"Claude"`, `"Claude CLI"`) plus an `engineLabel(provider)` fallback.
- **Root cause**: Both surfaces render `engineProvider` strings (the usage "By inference engine" bars and the briefing's "Scored by" provenance line) but each grew its own provider-vocabulary map. The label half is verbatim-equivalent; the usage map only adds a per-provider chart color on top.
- **Impact**: Adding a provider (or renaming a label, e.g. "Claude CLI") requires editing two unrelated modules; they will drift (one already had a label the other didn't until kept in sync by hand). Two sources of truth for the same id→label vocabulary.
- **Fix sketch**: Add one shared map + `providerLabel(id)` helper (natural home: `@/lib/llm/config` next to the model/price tables, or a small `@/lib/llm/providers.ts`). Have `briefing.ts`'s `engineLabel` delegate to it, and keep only the `id → color` overlay local to `usage/page.tsx` (chart color is a UI concern), looking the label up via the shared helper.

## 3. Local `Stat` in /usage reimplements the canonical `components/ui/Stat`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/usage/page.tsx:36-46 (vs src/components/ui/Stat.tsx:21-42)
- **Scenario**: `usage/page.tsx` defines a private `Stat({ label, value, sub })` whose inner block (mono uppercase kicker label → big `font-mono text-3xl font-bold tabular-nums` value → muted `sub`) is the same number-block the shared, documented `src/components/ui/Stat.tsx` already provides ("the canonical number block … one source of truth for the org dashboard Tiles, the landing stat ledger, and any headline metric").
- **Root cause**: The shared `Stat` is borderless (meant to compose inside a `Surface`/card), whereas the usage page wanted the card chrome (`rounded-2xl border border-slate-800 bg-slate-900/40 p-6`), so it re-declared the whole component instead of wrapping the shared one. It's used ~13 times on this page.
- **Impact**: The headline-metric styling for the billing page diverges from the rest of the app's stat blocks (e.g. the local copy hardcodes `text-white` + its own label classes rather than the shared `Kicker`), so a future restyle of the canonical Stat skips /usage. Adds a redundant component definition to an already-large page module.
- **Fix sketch**: Import `Stat` from `@/components/ui/Stat`; render it inside a small local card wrapper (or the existing `Surface`/`Card` primitive) to keep the bordered tile look. Delete the local `Stat`. The shared `Stat`'s superset props (`color`, `delta`, `goal`) are optional, so existing call sites pass unchanged.

## 4. Duplicated fire-and-forget counter-upsert in badge-analytics vs quota-events
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/badge-analytics.ts:15-29 (vs src/lib/db/quota-events.ts:12-24)
- **Scenario**: `recordBadgeImpression` and `recordQuotaEvent` share the same skeleton: `if (!isDbConfigured()) return;` → normalize a string key (`.toLowerCase().slice(...)`) → `getPrisma().<model>.upsert({ where: <composite>, update: { count: { increment: 1 }, lastSeen: new Date() }, create: { …, count: 1 } })` → `try/catch {}` that swallows every error so analytics never breaks the hot path.
- **Root cause**: Two near-identical "best-effort increment-a-counter row" recorders were written independently against two different Prisma models (`badgeImpression`, `quotaEvent`) with different composite keys.
- **Impact**: The fire-and-forget contract (DB-off guard + increment/`lastSeen` payload + silent catch) is encoded twice and must be kept consistent by hand; a change to the swallow/observability policy touches both. Modest (~6 lines each), but it's the exact "usage recording vs quota-events overlap" the context flags.
- **Fix sketch**: Extract a tiny shared wrapper in `@/lib/db` such as `async function bumpCounter(run: () => Promise<unknown>): Promise<void> { if (!isDbConfigured()) return; try { await run(); } catch { /* best-effort */ } }`, and have both recorders call it with their model-specific `upsert(...)`. The `{ count: { increment: 1 }, lastSeen: new Date() }` update payload can also become a shared const. (The models/keys legitimately differ, so don't over-abstract the upsert itself.)

## 5. Redundant `STYLES`/`Style` indirection in BadgeGenerator
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/badge/BadgeGenerator.tsx:24,28
- **Scenario**: The component already imports `BADGE_STYLES` and `BadgeStyle` from `@/lib/badge`, then adds `type Style = BadgeStyle;` and `const STYLES: readonly Style[] = BADGE_STYLES;` and uses `Style`/`STYLES` throughout.
- **Root cause**: Local aliases left over from before the contract was single-sourced into `@/lib/badge` (the file's own comment notes the style vocabulary is now single-sourced there).
- **Impact**: Two extra names for things that already have canonical names — minor reading overhead and a small "which one is authoritative?" ambiguity. No correctness issue.
- **Fix sketch**: Drop `type Style`/`const STYLES`; use `BadgeStyle` and `BADGE_STYLES` directly (`useState<BadgeStyle>`, `{BADGE_STYLES.map(...)}`). Purely cosmetic; safe.
