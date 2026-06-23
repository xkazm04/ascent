# Code Refactor — Design System: UI Primitives & Deck
> Context group: Marketing Site & Design System
> Total: 3 findings (Critical: 0, High: 1, Medium: 1, Low: 1)

This context is largely clean. There is no dead code (every primitive, type, and helper is referenced — verified by repo-wide grep; `signedDelta` is consumed by `org/PeriodSummary.tsx`, the deck trio is used by `about/AboutLanding.tsx` + `landing/prototypes/*`, and `Dateline`/`HairlineGrid` are used by `landing/prototypes/index/*`), no leftover `console.log`/debug, no commented-out blocks, no stale TODOs, and no unused imports. The findings below are all the same theme: the canonical mono-uppercase eyebrow treatment (`Kicker`) is hand-re-rolled inside two of its sibling primitives instead of being composed, and the copies have already begun to drift.

## 1. Dateline hand-rolls the canonical Kicker-muted treatment instead of composing Kicker
- **Severity**: High
- **Category**: duplication
- **File**: src/components/ui/Dateline.tsx:16 (with src/components/ui/Kicker.tsx:16-17)
- **Scenario**: `Dateline`'s class string embeds `font-mono text-xs uppercase tracking-[0.22em] text-slate-500` — which is byte-for-byte the markup `Kicker` emits for `tone="muted"` (`font-mono text-xs uppercase tracking-[0.22em]` + `text-slate-500`). `Kicker`'s own header comment declares it "One treatment for the ~86 hand-rolled `font-mono uppercase tracking-widest` labels scattered across the app", yet `Dateline`, a sibling in the same `components/ui` folder, bypasses it and re-inlines the literal.
- **Root cause**: `Dateline` predates or was written in parallel with the `Kicker` consolidation; because it mixes the eyebrow typography with its own layout chrome (`flex items-center justify-between border-b border-divider pb-4`) on a single element, the author copied the type tokens inline rather than nesting a `Kicker`.
- **Impact**: The brand "eyebrow" treatment now lives in two places that must be kept in sync by hand. A tracking/size tweak to the canonical eyebrow (the stated single source of truth) silently skips `Dateline`. Finding 2 shows this drift has already happened in the third copy. Low bug-risk but real maintenance tax and a credibility hole in the "one treatment" claim.
- **Fix sketch**: Behavior-preserving consolidation. Render the left cell through the kit: keep `Dateline`'s layout/border classes on the wrapper but drop the type tokens from it (`flex items-center justify-between border-b border-divider pb-4 ${className}`), and wrap the text in `<Kicker tone="muted">{left}</Kicker>` / `<Kicker tone="muted" className="hidden sm:inline">{right}</Kicker>` (Kicker renders a `div`; switch the spans accordingly or have Kicker accept the element — minimal). Since the resolved classes are identical, output is unchanged. No external callers change (`IndexHero.tsx` is the only consumer and passes only `left`/`right`/`className`).

## 2. Stat re-rolls the same eyebrow label and has already drifted to tracking-[0.2em]
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/ui/Stat.tsx:23 (with src/components/ui/Kicker.tsx:16-17)
- **Scenario**: `Stat`'s label line is `font-mono text-xs uppercase tracking-[0.2em] text-slate-500` — the third copy of the muted eyebrow, except the letter-spacing is `0.2em`, not the canonical `0.22em` used by `Kicker`/`Dateline`. So the same conceptual label renders at two slightly different trackings depending on whether it came from `Kicker` or from a `Stat`. (The same `0.2em` variant has also leaked into the out-of-scope `org/ui.tsx` `OrgTable` thead, line 104 — evidence the drift is spreading.)
- **Root cause**: Same as Finding 1 — the label markup was inlined when `Stat` was authored, then the canonical value was later standardized to `0.22em` in `Kicker` without back-propagating to the copies.
- **Impact**: Visible inconsistency (stat tiles' labels are marginally tighter-tracked than every other eyebrow) plus the same dual-maintenance cost. This is the concrete cost of the duplication in Finding 1 — the copies have measurably diverged.
- **Fix sketch**: Replace the literal label `div` with `<Kicker tone="muted">{label}</Kicker>` (Kicker already renders a `div`, so the DOM shape is preserved). This both removes the duplicate and corrects the `0.2em`→`0.22em` drift in one move. If the `0.2em` look is intentionally desired for tiny stat labels, instead add a `size`/`tracking` prop to `Kicker` and route both through it — but the cleaner default is to converge on the canonical value. No prop/signature change to `Stat`; the only visible diff is the 0.02em tracking correction.

## 3. DeckNav uses a fourth, near-identical mono-label variant inline
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/deck/DeckNav.tsx:39
- **Scenario**: The active-section dot label is `font-mono text-xs uppercase tracking-wider …` — yet another inline mono-uppercase label, this time with `tracking-wider` and dynamic accent/slate color, sitting outside the `Kicker` abstraction.
- **Root cause**: `DeckNav` lives in `components/deck` (not `components/ui`), was likely written before the `Kicker` kit, and its label needs per-state color toggling that the current 2-tone `Kicker` doesn't express, so it stayed inline.
- **Impact**: Minor — it adds a fourth tracking value (`wider`) to the eyebrow family and keeps one more mono-label copy out of the kit. Mostly a consistency note; the dynamic color genuinely doesn't fit today's `Kicker` API, so this is the weakest of the three.
- **Fix sketch**: Lowest priority — only worth touching if/when `Kicker` grows a color override (e.g. an optional `className`-driven color or an `"active"` tone). Today, leave as-is or, at most, normalize `tracking-wider`→`tracking-[0.22em]` to match the eyebrow family if the visual is acceptable. Do not force it through `Kicker` while the accent/slate state toggle has no home there — that would not be behavior-preserving.
