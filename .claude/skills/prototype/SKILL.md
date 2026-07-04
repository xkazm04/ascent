---
name: prototype
description: Iteratively prototype an ascent UI surface through directional variants behind a tab switcher, then consolidate and refactor the winner into the brand system. Use when the user wants to level up a component they consider a pillar of the app (visual appeal, creativity, UX clarity) — e.g. an org dashboard panel, a report view, the launch star-map, or an onboarding step. Not for fixed-scope tweaks or bug fixes.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Prototype — Directional Variant Workflow (ascent)

A disciplined A/B prototyping loop for refining an ascent UI surface. Start from a named file, produce radically different directional variants behind a tab switcher, let the user prune/fuse across rounds until one direction wins, then consolidate + refactor into the brand system. The workflow is distilled from a real 5-round session; the guardrails cut the rounds needed next time.

**This skill is tuned to ascent.** It knows the brand kit (`@/components/ui`, `BRAND.md`), the org-dashboard primitives (`@/components/org/ui`), the color/level helpers (`@/lib/ui`), the App-Router server/client split, and the hard **300-LOC-per-`.tsx`** rule. Use those, not raw slate hexes and hand-rolled chrome.

---

## When to use

The user says things like "help me master this component", "prototype ideas on top of X", "this is a pillar of the app and I want it to be amazing", "iterate until we reach an amazing result". The request carries an **open direction** and a **visual quality bar**, not a specific change list. Typical ascent targets: an `/org/[slug]/*` dashboard tab, a report panel (`src/components/report/*`), the launch star-map (`src/components/launch/*`), the live war-room, an onboarding step.

## When NOT to use

- Fixed-scope requests ("change the accent to a lighter azure", "widen this column") — just edit.
- Bug fixes.
- Non-visual code (data layer `src/lib/db/*`, GitHub/scan logic, API routes).
- User asks for "three layouts" but wants them all shipped — that's a build task, not prototyping.

---

## Coordination & safety

ascent has **no** active-runs ledger — coordination here is lighter than the source workflow, but the branch is often mid-flight (`git status` at session start frequently shows **20-30 modified files** from other work). That makes isolation the whole game.

1. **Work in a git worktree.** Prototyping always creates multiple variant files = multi-file by definition, and you must not entangle it with the modified files already in the tree. Default to:
   ```bash
   git worktree add .claude/worktrees/prototype-<name> -b prototype-<name>
   cd .claude/worktrees/prototype-<name>
   ```
   The worktree also lets the user run `npm run dev` in both the main checkout (untouched) and the worktree (with variants) and compare side-by-side.
2. **Never `git stash`** other sessions' work — not even `--keep-index`. If a commit step needs a clean stage, `git add <path>` **per file** (never `git add -A` / `git add .` / `git add -u`); leave everything else alone.
3. **Don't write to files that already show as `M`** in `git status` unless the user explicitly named them. Apply tight, single-line diffs so unstaged work is preserved.
4. **Commits are user-gated** (repo norm: commit only when asked). If the user does want per-round history, one atomic commit per round of variants / per pruning decision / per consolidation — inside the worktree, so the main checkout stays clean. End commit messages with the co-author trailer:
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
5. **Clean up the worktree after the winner lands.** From the main checkout: `git worktree remove .claude/worktrees/prototype-<name>` and `git branch -D prototype-<name>`.

If the target is small and the tree happens to be clean, a worktree is optional — but say so and confirm before prototyping in place.

---

## Step 0: Collect the starting file

The skill takes no arguments. When invoked, ask the user **one short question** and wait:

> "Which surface should I prototype on? Paste the path (e.g. `src/components/org/RepoDimensionHeatmap.tsx` or `src/app/org/[slug]/tech-stacks/page.tsx`)."

Don't guess the file from conversation context unless the user already named a concrete path in the same turn. If their reply describes the component by purpose rather than a path, ask a clarifying follow-up — picking the wrong file wastes whole rounds.

---

## Phase 1: Verify the actually-rendered component

**Don't trust the filename.** The file the user named may not be what actually renders. This was the single most expensive mistake in the source session — two rounds landed on the wrong file.

1. Read the component the user named.
2. Grep for JSX usage (`rg '<{Name}\b'`) and imports (`rg "from ['\"].*{Name}['\"]"`).
3. In ascent, follow the App-Router chain: a page is `src/app/**/page.tsx`, which usually composes several presentational panels from `src/components/**`. The real render target is often a **panel**, not the page.
4. If the named file has **zero JSX usages**, it's a helper/barrel, not a rendered view — find the one that IS rendered by following imports from the relevant `page.tsx`.
5. **Note server vs client.** Async, data-fetching `page.tsx` files are **server components** (no hooks). Presentational panels marked `"use client"` hold the interactivity. This decides where the tab switcher can live (Phase 2).
6. **Confirm with the user in one sentence** before proceeding: "The named file is the server page that fetches data; the actually-rendered panel is `X` — prototyping on `X`, with the page passing its data down. OK?"

---

## Phase 2: Scaffold the tab switcher

Goal: a top-of-surface tab strip that lets the user A/B between variants without forking call sites.

**The App-Router gotcha (ascent-specific):** a tab switcher needs `useState` → it must be a **client component** (`"use client"`). But the prototype target is often an **async server component** (`page.tsx` that awaits data). You cannot put hooks there. Two clean patterns — pick per Phase 1:

- **Target is a presentational panel** (already `"use client"`, receives props): rename the exported function to `{Name}Baseline` inside the file, and re-export `{Name}` as a client wrapper holding `variant` state + the tab strip, delegating the body to the active variant. Consumers stay untouched.
- **Target is the server `page.tsx`**: keep data-fetching in the server page. Create a sibling **client** wrapper `{Name}Switcher.tsx` (`"use client"`) that takes the already-fetched data as props and renders the tab strip + active variant. The page fetches, then renders `<{Name}Switcher {...data} />`. Never move the `await` into the client component.

Rules:
- Every variant accepts the **same Props shape** the component already uses — consumers stay untouched.
- Baseline is the default selected tab so nothing visually changes on load.
- The scaffold is throwaway — a ~15-line tab strip is enough. Style it with brand tokens (`bg-surface/40`, `border-divider`, `text-accent` on the active tab) so it doesn't look like scaffolding, but don't over-engineer it.

---

## Phase 3: Generate 2 **directional** variants

### 3a. Prerequisite — ground your variants in ascent's actual quality bar

Before writing *any* variant code, spend a few tool calls to calibrate. This is the single biggest round-1 uplift: variants that mine the codebase feel like siblings of the app; variants invented in isolation feel like prototypes. Do all four, in order, every time:

1. **Read the brand doc and import from the kit.** `src/components/ui/BRAND.md` is the design system ("The Index" — editorial, one azure accent, typeset numbers, gated motion). **Do not hand-roll chrome.** Import primitives:
   - **`@/components/ui`** — `Surface` (the panel: `rounded-{xl|2xl} border border-divider bg-surface/40`), `Kicker` (mono uppercase eyebrow — replaces hand-rolled `font-mono uppercase tracking-widest` labels), `Stat` (mono label + `tabular-nums` value + optional delta/goal), `SectionHeading` (`kicker`+`title`+`intro`+`right`, sizes `page`/`lg`/`sm`), `HairlineGrid`, `Dateline`, `SideNav`.
   - **`@/components/org/ui`** (dashboard surfaces) — `Tile` (a `Stat` as a `TILE_LEDGER` cell), `TILE_LEDGER`/`TILE_GRID` (the gap-px hairline bed — tiles no longer self-border; place them in the ledger), `Card`, `OrgTable`, `Meter`, `MeterRow`, `SectionHeader`, `SectionEmpty`/`InlineEmpty`/`OrgEmpty`, `ExportCsvLink`, `DIMS`, `POSTURE_LABEL`/`postureLabel`.
   - **The recurring failure mode is carrying the baseline's raw `<select>`/`<input>`/hand-rolled card forward.** If the baseline hand-rolls chrome, **upgrade it in the variants** — don't carry the debt.
2. **Never hand-pick a color.** From `@/lib/ui`: `scoreHex`/`LEVEL_HEX` (level & score color, red→green ramp — for scores/levels *only*), `heatCell` (score-tinted fill + computed-contrast ink), `LEVEL_CLASSES`, `LEVEL_GLYPH`/`scoreGlyph`, `DIMENSION_SHORT` (D1…D9 short labels), `readableTextOn`, `IMPACT_CLASS`/`EFFORT_CLASS`, `timeAgo`/`freshness`. From `@/components/ui`: `deltaHex`/`fmtDelta`/`signedDelta` (period delta — lime up · orange down · slate flat). The one accent is `bg-accent`/`text-accent` (`#3b9eff`); surfaces are `bg-surface/40`; the single hairline is `border-divider`. **Numbers are `font-mono … tabular-nums`; labels are mono, uppercase, wide-tracked (or a `Kicker`).** A raw `bg-violet-500/15` / `text-amber-300` / hand-picked hex is a tell.
3. **Mine one or two polished sibling surfaces for the bar.** Strong ascent references:
   - `src/components/launch/ConstellationField.tsx` + `FleetMap.tsx` — the `/launch` star-map: cinematic SVG, decorative background, the app's hero visual.
   - `src/components/org/LiveWarRoom.tsx` — the `/org/[slug]/live` ops wall: dense live tiles, count-ups, reshuffles, celebratory bursts.
   - `src/components/report/*` (`Charts.tsx`, `DimensionExplorer.tsx`, `DimensionCard.tsx`) — the report, the product's showcase.
   - `src/components/onboarding/OnboardingFlow.tsx` — a multi-step flow with phase transitions.
   - the landing `TrajectoryChart` (referenced in `BRAND.md`) — dependency-free SVG styled to the tokens.
   **If the user names inspiration surfaces, treat that as authoritative** — mine those even if the filenames don't match the target.
4. **Extract three things from each reference:** (a) *layout shape* — masthead/`Dateline` + section + hairline bed?; (b) *motion language* — what animates (entrances, meter fills, draw-ons), what's a deliberate signature loop (star twinkle, live-dot pulse), and note it's all gated under `prefers-reduced-motion`; (c) *typography + data patterns* — what's rendered as a big `font-mono tabular-nums` stat, where `Kicker`/uppercase labels sit, how `scoreHex`/level color and `fmtDelta` carry meaning.

Skip this and round 1 gets thrown away wholesale. Spend the tool calls.

### 3b. Directional variants

The critical word is *directional*. A variant is not "baseline with spacing tweaked"; it's a completely different **mental model** for the same data. Each variant earns its name by carrying a **single central metaphor** through layout, typography, motion, iconography, and copy voice.

Good variant pairs (ascent-flavored):
- **altimeter / strata** (elevation gauge, the `.strata` motif, ascent-as-climb) + **ledger / index** (editorial data-dense single column with a `Dateline` masthead)
- **constellation / star-map** (spatial SVG, repos as stars) + **blueprint / instrument** (technical drawing, mono readouts, engineering aesthetic)
- **war-room / live board** (dense ops tiles, deltas front-and-center) + **narrative / trajectory** (linear story of the climb over time)
- **heatmap matrix** (grid, `heatCell` per cell) + **butterfly / mirror** (two sides compared per dimension)

Deliverables per variant:
- File: `{Name}{Variant}.tsx` in the same folder. Add `"use client"` if it uses hooks or handlers.
- Short header comment: the metaphor + why it differs from baseline.
- **Reuse brand primitives and real color helpers** — don't reinvent `Meter`, `Tile`, `Surface`, or a score color.
- Degrade gracefully for the edge cases the baseline handles (empty/no-scan state via `SectionEmpty`/`OrgEmpty`, unscanned repos, null deltas, single-stack orgs).
- **Prefer data-concrete symbols over abstract markers.** ascent's real nouns beat decorative shapes: repo names, tech-stack chips (`techChips`), `LevelBadge`, dimension scores (D1…D9), posture labels, `fmtDelta` deltas, `reportPermalink` links. Pull from the live data model (`@/lib/types`, the org-rollup / scan types) — the user scores a variant on whether it encodes *real* data they already care about.
- **Design for extraction — and the 300-LOC rule.** A variant is scored partly on what it contributes back: named sub-components (`ScoreWaterfall`, `DimensionPanel`, `PostureDial`) that could live elsewhere as co-located files, not a monolith. Every `.tsx` must stay **≤ 300 LOC**; if a variant grows past that, extract a sub-component the same turn.
- **Answer "what am I looking at?" in round 1.** If the user is choosing among nouns (repos, stacks, segments, teams), the affordance for picking them must show *meaningful stats* — the facts needed to choose: overall score + level, adoption/rigor, scanned coverage, posture, last-scan freshness. Name-only chips with a decorative dot are a round-1 failure. Derive the fields from the actual types — read the relevant `src/lib/db/*` / `@/lib/types` shape and surface the non-obvious ones.
- **Answer "what's the takeaway?" in round 1 for output surfaces.** If the surface reports a result (a score, a ranking, movers, a forecast), each result carries *signal about why it matters*: a level/posture label, a delta vs baseline or period (`fmtDelta`, `+8 vs 90d ago`), a plain-language line (`Frontend leads · Backend·Python trails 13 pts`). Raw bars alone are a round-1 failure.

**Do not propose 3+ variants in round 1.** Two is right. More = analysis paralysis; the user picks a direction by round 2 anyway.

---

## Phase 4: Iterate by subtraction and fusion

After round 1 the user will usually reject one variant outright, pull a strong element from one into another, or give specific feedback on the leading candidate. Process each:

- **Rejection → delete immediately.** Remove file, import, and tab entry. Don't keep it "just in case" — dead code distracts future rounds.
- **Fusion → extract + merge + delete source.** Take the strong element out of variant A, merge it into variant B at the position the user named, delete A entirely. The live tab count shrinking each round is a good signal.
- **Specific feedback → apply inside the chosen variant.** Do NOT spawn a new variant for a targeted fix — the user asked for refinement, not more options.
- **Add a new variant only when explicitly asked** ("create a new variant with X direction").
- **Hoist shared pieces mid-prototype.** The moment two variants render the same structure (even styled differently), extract the shared sub-component into a co-located file and let both import it — waiting until refactor time doubles every tweak. When variant B is built *on top of* A's card/sigil/strip, export the shared primitive from A the same turn you create B. Keep `"use client"` on any extracted file with hooks/handlers.

Each round: end with an **explicit menu** of what changed, then ask for the next move. Don't auto-advance.

---

## Phase 5: Declare the winner and consolidate

Trigger keywords: "I think we have it", "this is the one", "promote X to default", "set X as the production baseline", "X becomes our go-to". The last two carry a broader mandate — they authorize cleanup beyond the prototyping variants (step 3).

1. Stop iterating.
2. Make the winner the default tab, or remove the switcher entirely and render only the winner (collapse the client wrapper / `{Name}Switcher.tsx` back into a plain render).
3. Delete remaining non-winner variants from disk and imports. If the keyword was "production baseline" or equivalent, the cleanup scope extends to *legacy variants on the same surface* the user is now willing to cut — ask once if unsure; don't delete silently.
4. Run **`npx tsc --noEmit`** once to confirm no dangling references.
5. Check the **300-LOC rule** on every touched `.tsx` (command below). If the winner is over, extraction is required before this phase is done.
6. **Do NOT refactor further in this phase.** Refactor is a separate, explicit request — premature refactor destroys diff visibility while the user is still evaluating the winner live.

300-LOC check (from `AGENTS.md`; use `-LiteralPath` so `[slug]` dirs aren't globbed):
```powershell
Get-ChildItem -Recurse -Filter *.tsx src | Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object { [pscustomobject]@{ LOC=(Get-Content -LiteralPath $_.FullName).Count; Path=$_.FullName } } |
  Where-Object { $_.LOC -gt 300 } | Sort-Object LOC -Descending
```

Exit this phase with: one component, the winner is the live render, typecheck clean, every touched `.tsx` ≤ 300 LOC, the user can reload and see the winner.

---

## Phase 6: Refactor (only on request)

ascent's `AGENTS.md` already prescribes the pattern — follow it rather than inventing structure.

**Check for a sibling folder to mirror first.** `src/components/report/`, `launch/`, `onboarding/` all show the ascent convention: the orchestrator keeps the page/panel component and imports **co-located** sub-components in the same directory (`report/ScoreWaterfall.tsx`, `report/DimensionCard.tsx`). Match whatever the nearest sibling does, file-for-file.

1. **Extract, don't restructure.** Pull internal sub-components, their private helpers, and constants into co-located files in the same directory. The original file keeps the orchestrator and imports the pieces. **Preserve behavior exactly — extraction is pure relocation.** Add `"use client"` to any extracted file that uses hooks or handlers.
2. For a large non-component **`.ts`** module, split into themed sub-modules and keep the original as a **thin re-export barrel** so callers and `db/index.ts`-style barrels stay unchanged (see `src/lib/db/org.ts`, `src/lib/db/scans.ts`).
3. **300 LOC per `.tsx` is a hard rule here**, not a guideline — the codebase is at zero files over 300 and must stay there. A file approaching the limit is the signal to extract, not to keep appending.
4. Update the single consumer import site(s). `Grep` for the old filename first — don't assume one call site.
5. Keep sibling exports (shared constants, helpers used elsewhere) stable — unexpected broken imports erode trust.
6. Typecheck once at the end (`npx tsc --noEmit`), not between files.
7. Update `context-map.json` if you changed which files a feature owns (per `.claude/CLAUDE.md`).

---

## Guardrails (learned the hard way)

### Watch for external reverts
Linters, formatters, or the user can revert your writes mid-session (this repo's memory index and files get touched by other processes — you'll see `Note: <file> was modified…` markers). If a marker contradicts your latest change, don't re-argue — re-apply it. Reverts can accumulate on one orchestrator file (imports / tab entries / type-union members / render branches silently rolled back). If the user says "something reverted my progress", `grep` to enumerate what's still missing, then re-apply the whole round's wiring in one batch.

### Don't touch files outside the prototype scope
The branch usually carries 20-30 unrelated `M` files. A sharp correction from the source session: "did you stash or throw changes elsewhere? I lost progress." If a file shows `M` in `git status`, **do not write to it** unless the user named it. This is exactly why Phase 0 recommends a worktree. Tight single-line diffs only.

### Typography is a recurring quality axis
Per `BRAND.md`: numbers are `font-mono … tabular-nums`; labels are mono, uppercase, wide-tracked (or a `Kicker`). Lean `text-base` for body copy; reserve `text-xs`/`text-sm` for those mono labels. Never use arbitrary pixel sizes (`text-[10px]`) — that's a prototype-grade shortcut. **Brighter, not muted:** to promote copy, bump size *and* drop the opacity mute (`text-slate-400 → text-slate-200`/`text-white`, `font-normal → font-medium`). "Promote" means "make more present".

### Animation austerity — but keep the brand signatures
`BRAND.md` principle #5: "Motion is a beat, gated." Entrances and draw-ons only; everything degrades under `prefers-reduced-motion`. Prefer the existing utilities: `.animate-fade-up`, `.animate-fade-in`, `.animate-phase-in`, `.animate-meter`, or framer-motion entrance-once. **Reject new always-on motion** you invent (looping scans, drifting particles, ambient rotations, `hover:-translate-y-*` on cards). The *deliberate* signature loops already in the app — the `/launch` star twinkle (`.launch-star`), the live-dot pulse (`.live-dot`), the war-room flash — are intentional and are already gated in `globals.css`; don't add new ones outside those established motifs. **Every animation you add must be gated under `@media (prefers-reduced-motion: reduce)`** (the `ascent-*` keyframe utilities already are — new inline framer-motion is not, so guard it). Rule of thumb: if the user would see the motion after leaving the screen idle, cut it.

### Server vs client components
Hooks (`useState`/`useEffect`/framer-motion `motion.*`) require `"use client"`. You cannot use them in an async data-fetching `page.tsx`. Keep the `await` in the server component and pass data as props to a client variant/wrapper (Phase 2). A variant that suddenly needs interactivity → add `"use client"` at the top of *that variant's* file, not the page.

### framer-motion on SVG `cx`/`cy`/`r` — use transforms
Animating raw SVG attributes via `animate={{ cx, cy, r }}` can render `"undefined"` mid-mount and throw DOM validation errors. Instead: wrap in `motion.g` and animate `x`/`y` (children stay `cx={0} cy={0}`), or keep a static `r` and animate `scale`. Safe to animate: `strokeDashoffset`, `pathLength`, `opacity`, and transforms (`x`, `y`, `scale`, `rotate`). ascent uses framer-motion + SVG in `launch/` and the report charts — this bites there.

### Don't use `useMemo` for side effects
`useMemo(() => { if (x) setStage(...) }, [x])` fires setState during render — wrong. The intent is `useEffect`. Before every consolidation/variant write, grep your own output for `useMemo\(.*set[A-Z]` and swap to `useEffect`.

### Preserve shared exports during consolidation
If the baseline file re-exports helpers used by siblings (icons, `POSTURE_META`, small utilities), keep those re-exports stable when refactoring internals. Broken imports in unrelated files erode trust.

### One-shot typecheck, not continuous
`npx tsc --noEmit` is slow — batch file writes and typecheck once at the end of a round. Pre-existing unrelated errors on this branch are not yours to fix; triangulate to your own touched files.

### Keep baseline as reference, not as a ceiling
Baseline is preserved for A/B, not because it's the target. Early rounds should feel radically different. If the user's feedback keeps pushing variants toward the baseline, propose a new direction rather than compressing toward it.

---

## Signals the iteration is converging

Green flags: tab count decreasing (3→2→1); feedback shifting from "wrong direction" to "tweak this specific thing"; the user names the winning metaphor positively ("the altimeter reading works", "constellation is interesting"); layout-level specifics (rail width, tile order, keyboard numbers).

Red flags → reset direction: wholesale rejection round after round; the user restating the baseline as their preference; variants being asked to back-port features the baseline already has.

---

## Exit checklist

- [ ] Winner is the default rendered component; server/client split is correct (`"use client"` only where hooks live).
- [ ] All non-winner variants deleted from disk, imports, and tab configs; `{Name}Switcher` collapsed if the switcher was removed.
- [ ] `npx tsc --noEmit` clean on touched files (pre-existing unrelated errors ignored).
- [ ] Every touched `.tsx` ≤ 300 LOC (ran the check).
- [ ] Brand compliance: primitives from `@/components/ui` / `@/components/org/ui`, colors from `@/lib/ui`/`deltaHex` — no hand-picked hexes or raw hand-rolled `<select>`/cards.
- [ ] Consumer import paths still resolve (grep the old filename → zero stale references).
- [ ] New animations gated under `prefers-reduced-motion`.
- [ ] Worktree removed and branch deleted after the winner lands (if one was used).
- [ ] If refactored: co-located sub-components mirror a sibling folder; `context-map.json` updated if ownership changed.

When every box is checked, summarize the journey in 1-2 sentences (what metaphor won, what the winning variant does differently) — that's what the user quotes in a PR description.
