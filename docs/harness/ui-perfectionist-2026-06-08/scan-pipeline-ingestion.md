# UI Perfectionist — Scan Pipeline & Ingestion

> Total: 8 findings (0 critical, 2 high, 4 medium, 2 low)
> Context: Scan Pipeline & Ingestion | Files audited: 6

## 1. Metadata advertises "7 dimensions" while the model and the page both say 9
- **Severity**: High
- **Category**: visual-consistency
- **File**: src/app/layout.tsx:18
- **Scenario**: The `<head>` description (the text Google, Slack, Twitter/X, LinkedIn unfurl into the share card and search snippet) reads "a 5-level maturity ladder across **7 dimensions**". The actual rubric in `src/lib/maturity/model.ts:68` defines D1–D9 (nine `DIMENSIONS`), and the live hero paragraph at `src/app/page.tsx:50` renders the truthful `{DIMENSIONS.length}` = "9 dimensions". So the first impression off-site contradicts the first impression on-site.
- **Root cause**: The metadata string was hand-hardcoded to a count that has since drifted; unlike the body copy it does not interpolate `DIMENSIONS.length`, so it silently desynced when dimensions were added.
- **Impact**: A factual inconsistency on the highest-leverage surface (the share/search snippet for the whole product). It reads as carelessness on a tool whose entire pitch is rigor and accuracy.
- **Fix sketch**: Build the description from the source of truth so it can never drift: `description: \`Score how AI-native your engineering org is from a GitHub repo: a ${LEVELS.length}-level maturity ladder across ${DIMENSIONS.length} dimensions, with evidence and a roadmap to the next level.\`` (import `DIMENSIONS, LEVELS` from `@/lib/maturity/model`; `metadata` is module-scope server code so this is free).

## 2. No keyboard-skippable landmark / "skip to content" affordance on the app shell
- **Severity**: High
- **Category**: accessibility
- **File**: src/app/layout.tsx:31
- **Scenario**: A keyboard or screen-reader user landing on `/` must tab through the entire sticky `SiteHeader` (logo, Levels, Method, Pricing, Org demo, auth controls — `src/components/Brand.tsx:42-86`) on every navigation before reaching the primary action, the ScanForm input. There is no skip link and no `<main>` target to jump to. `page.tsx:28` does render `<main>`, but it has no `id` and nothing focuses it.
- **Root cause**: The shell was built header-first without a bypass-blocks mechanism (WCAG 2.4.1). The repo clearly cares about a11y (a `.focus-ring` token, `aria-live`, glyph redundancy), so this is an oversight, not a stance.
- **Impact**: Every keyboard visit pays a 6–8 tab "tax" to reach the one thing the landing page exists for. This is the kind of gap the product itself would flag in a scan.
- **Fix sketch**: Add `id="main"` to the `<main>` in `page.tsx` and a visually-hidden-until-focused skip link as the first child of `<body>` in `layout.tsx`: `<a href="#main" className="focus-ring sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-on-accent">Skip to scan</a>`.

## 3. Disabled "Scan" button drops the value-empty state below the AA contrast floor
- **Severity**: Medium
- **Category**: accessibility
- **File**: src/components/ScanForm.tsx:103
- **Scenario**: Until the user types, the submit button is `disabled` and carries `disabled:opacity-50`. The button is `bg-accent` (#3b9eff) with `text-on-accent` (#04070e). Halving opacity over the dark `bg-slate-950/70` form drags the small-caps mono label well under 4.5:1, so the primary CTA's label is hard to read in its default resting state — exactly when a first-time visitor is deciding whether to engage.
- **Root cause**: `opacity-50` fades the whole element (fill + text together) rather than communicating "disabled" with a distinct token. The codebase already understands this trap — `heatCell` in `src/lib/ui.ts:94-115` explicitly avoids element-`opacity` for the same readability reason — but the pattern wasn't applied here.
- **Impact**: The headline CTA looks washed-out/low-quality at first paint and fails contrast in its most common state.
- **Fix sketch**: Replace `disabled:opacity-50` with an explicit disabled skin that keeps text legible, e.g. `disabled:bg-slate-800 disabled:text-slate-400` (clears AA) while retaining `disabled:cursor-not-allowed`. Consider keeping the button enabled and validating on submit, since `normalizeRepo` already handles empty input.

## 4. Mobile users lose the `github.com/` prefix with no replacement cue
- **Severity**: Medium
- **Category**: responsive
- **File**: src/components/ScanForm.tsx:84
- **Scenario**: The `github.com/` prefix is `hidden ... sm:flex`, so below 640px it vanishes entirely. The remaining cue is the placeholder `owner/repo` (line 94), which disappears the instant the user types. On a phone — the context where people paste a full `https://github.com/...` URL from a browser share sheet — the field gives no standing hint about what it wants.
- **Root cause**: The prefix doubles as the field's only persistent affordance label, but it was made desktop-only for width reasons without substituting a mobile equivalent.
- **Impact**: Weaker affordance on the exact viewport most likely to paste a messy URL. (`normalizeRepo` is forgiving enough to recover, so this is a clarity/polish gap, not a breakage.)
- **Fix sketch**: On `<sm`, surface the prefix as a small persistent helper line under the field (e.g. a `sm:hidden` `<p className="mt-1.5 font-mono text-[11px] text-slate-500">github.com/owner/repo</p>`), or keep a compact `gh/` prefix chip visible at all widths.

## 5. Three near-identical card patterns repeated inline instead of one extracted component
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/page.tsx:115
- **Scenario**: The landing page hand-rolls the same surface — `rounded-xl border border-slate-800 bg-slate-900/40 p-N` — three separate times: How-it-works (`page.tsx:115`, `p-6`), Dimensions (`page.tsx:130`, `p-5`), and Pricing's non-featured tier (`page.tsx:159`, `p-6`). The padding silently varies (`p-5` vs `p-6`) and the heading sizes drift (`text-lg` vs default), with no shared primitive enforcing consistency.
- **Root cause**: Each section was authored independently with copy-pasted card chrome; there's no `<Card>`/`<Panel>` primitive, so border/bg/radius tokens live in three places and can desync (as the padding already has).
- **Impact**: Inconsistent spacing rhythm between sibling sections, and any future restyle of "the card" must be done in N places — a maintenance and visual-consistency liability on the marketing surface.
- **Fix sketch**: Extract a `<Panel className?>` (or `Card`) wrapper owning `rounded-xl border border-slate-800 bg-slate-900/40` with a default padding, and have the three sections compose it. Standardize on one padding (`p-6`) unless density genuinely differs.

## 6. Hero is the only section with no empty/loading state for its dynamic chips
- **Severity**: Medium
- **Category**: states
- **File**: src/components/ScanForm.tsx:39
- **Scenario**: The "Try:" chips come from `examples` (top AI-native repos from the live gallery, `page.tsx:23`). `getPublicScanGallery()` is awaited per-request (`page.tsx:22`); on a slow/cold DB this delays the whole RSC render, and when it returns null the form falls back to `FALLBACK_EXAMPLES`. That fallback is good — but the chips render with no skeleton/transition, so on a fast index update the row can pop/reflow, and there is no visual distinction between "live top repos" and "static fallback," so the social-proof framing ("Try: facebook/react") can be misleading when the index is empty.
- **Root cause**: The chip row renders eagerly with whatever array is present; there's no placeholder treatment and no provenance signal distinguishing live vs. fallback examples.
- **Impact**: Minor layout pop and a subtle trust issue — fallback examples look like "currently trending" data when they're hardcoded defaults.
- **Fix sketch**: Reserve the row height to prevent reflow, and label the row by source — e.g. "Top this week:" when `examples?.length`, "Try:" for the static fallback — so the chips never overstate the data behind them.

## 7. Hero CTA microcopy uses middots that are read aloud and add no semantic structure
- **Severity**: Low
- **Category**: accessibility
- **File**: src/app/page.tsx:56
- **Scenario**: The reassurance line "Free for public repos · No signup · Results in under a minute" (and the footer credit at `Brand.tsx:112`) joins three independent claims with a raw `·` (U+00B7) inside one text node. Screen readers announce these as one run, often vocalizing the middot ("middle dot"), so the three benefits read as a single garbled sentence rather than three distinct selling points.
- **Root cause**: The separators are decorative punctuation baked into the string with no list semantics or `aria-hidden` wrapping.
- **Impact**: The trust microcopy — meant to lower friction at the CTA — is degraded for SR users and isn't machine-structured as the three discrete benefits it represents.
- **Fix sketch**: Render the three claims as `<ul>`/`<li>` (or `<span>`s) with the `·` as separate `aria-hidden` spans, so each benefit is announced cleanly: `<span>Free for public repos</span><span aria-hidden>·</span>…`.

## 8. Inline error message appears/disappears with no transition and shifts layout
- **Severity**: Low
- **Category**: polish
- **File**: src/components/ScanForm.tsx:130
- **Scenario**: On an invalid submit the form border flips to danger and `.animate-shake` fires (nice), but the inline `<p className="mt-2 text-sm text-danger">` is mounted/unmounted abruptly via `{error && …}`. The message hard-pops in and shoves the chip row below it down by its line height with no fade, and vanishes just as abruptly on the next keystroke — a small but jarring jump on a polished hero.
- **Root cause**: The error is a conditionally-rendered node with no enter transition and no reserved space, so its appearance always causes a layout reflow of everything beneath it.
- **Impact**: Minor visual jank on the form's most important feedback moment; the shake is undercut by the abrupt copy-shift.
- **Fix sketch**: Pair the existing shake with the project's `.animate-fade-up` (already defined in `globals.css:74`) on the error `<p>`, and/or reserve a `min-h` for the message slot so showing/clearing it doesn't reflow the chips.
