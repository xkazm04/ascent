# Prism migration gaps (phases 1 to 3 of retiring Altimeter)

Status: **2026-10-22, phase 3 landed: the theme switch is retired and Prism is the only look** (see "Done in phase 3"). Written at phase 1: find everything not yet in Prism, migrate what can be migrated
without changing the Altimeter render. Phase 2 finishes what is listed under "Remaining"; phase 3 deletes the
switch (`KIT-REDESIGN-PROCESS.md`, "Retiring the duality").

"Migrated" means one of: a `*.v2.tsx` Prism composition picked by the entry; or a surface that is fully
theme-neutral (tokens only, no Altimeter literals) and so renders correctly under `theme-prism.css`.
**Nothing here was seen rendered**: no dev server was running, so no Prism shots, no Altimeter pair-check
(`scripts/kit/pairdiff.py`), no roles files. The Altimeter guarantee rests on the edits being
value-identical (`color-mix` over `--color-accent` / `--color-ink`, CSS variables with the old value as default,
entry components that still return the old markup) and on the test suite (full `vitest run`: 19989 passed; phase 3: 19739 passed (-259 from deleted Altimeter and theme tests), build exit 0).

## What the token layer does and does not cover

`theme-prism.css` re-points: `--color-accent*`, `--color-ink`, `--color-surface*`, `--color-divider`, `--color-tone-flat`,
`--color-white`, the slate ramp 50..950, fonts, `--text-micro`, and (since this pass) the stock **sky / blue / indigo / cyan**
ramps onto the cool slate ramp. Status colours (`danger`, `warn`, `success`, `tone-*`, stock red/amber/emerald/lime/orange)
are deliberately not re-pointed (BRAND-PRISM open conflict 1). It does not reach literal hex / rgba / `style={{}}` / SVG /
canvas / CSS-module palettes: those are the "measured remainder" below.

## Inventory

### Org tabs (`ORG_TAB_IDS`, 28 ids; 3 are aliases and `segments` is a sub-view of Repositories)

| Tab (feature dir) | Before | Now | What is left |
| --- | --- | --- | --- |
| overview (`standing/overview`) | v2 | v2 | partial: fleet rows, trajectory SVG labels still Altimeter-shaped (HANDOFF follow-ups 3, 7, 8) |
| repositories + segments (`standing/repositories`) | v2 | v2 | `PALETTE` for user-picked segment colours keeps `#3b9eff` as first swatch (data) |
| tech-stacks | none | **v2 (this pass)** | `StackRadarChart`, `StackSpreadStrip`, `MatrixGrid` reused, token-restyled only |
| passports | v2 | v2 | `passport-display.ts` band colours (`#3b9eff` beta/hostile) are data hues |
| security | none | **v2 (this pass)** | `SecurityCheckMatrix`, `SecurityFindings` reused as-is |
| adoption | none | **v2 (this pass)** | `AdoptionCurve`, `MatrixGrid`, `SectionHelp` reused as-is |
| governance | v2 | v2 | |
| registry / skills / memory / practices | v2 | v2 | `MemoryCard` sky chips now neutral via the ramp |
| knowledge | none | **v2 (this pass)** | Loom grid internals |
| surfaces | none | **v2 (this pass)** | previews and playground keep their own `--kb-*` bindings |
| live | partial | partial | cockpit v2; desk, on-air wall, theater, war-room, outcome sheet are separate Altimeter compositions (blues now routed through variables, Prism overrides added; the compositions themselves are not redrawn) |
| proposals, lessons (`inflight/*`) | none | **v2 (this pass)** | `ProposalDetail`, follow-up chips and modals reused |
| executive | v2 | v2 | briefing share page chrome (`/share/briefing`) is separate |
| digest | none | **v2 (this pass)** | `DigestDimChart` and sub-panels token-restyled only |
| delivery | v2 | v2 | `ai/*` panels (UnitEconomics, Outcomes) still named Altimeter in comments, token-driven |
| contributors | none | **v2 (this pass)** | section internals (tables, care sections) |
| teams | none | **v2 (this pass)** | empty / error states still v1 markup |
| members | none | **v2 (this pass)** | `MembersTable`, `MemberInvites` reused |
| integrations | v2 | v2 | |
| pairing | none | **v2 (this pass)** | `AddRepoForm`, `PairingList` reused |
| audit | none | **v2 (this pass)** | action and verdict badges are still mono uppercase (`AuditLogCells` shared by both themes) |
| settings | v2 | v2 | |
| developer (`features/developer`, `/org/developer`) | none | **v2 (this pass)** | `Care*` section bodies keep their markup |
| followups, executive aliases | n/a | n/a | aliases redirect |

Counts, by the 29 modules of the kit coverage ledger: **before** 13 had a v2 composition (Live only partly) and 16 had none;
**after** 27 have one. Two are lighter: Athena (kit action buttons under Prism, drawer body untouched) and Live (cockpit only). `bought/(root)`
has no composition of its own. Interior components that no v2 file replaces are theme-neutral by token only; that mass is Remaining 2.

### Top-level routes (`src/app/**/page.tsx`: 24 non-redirect routes)

`/org/[slug]/*` (18 pages) are all `redirect()` into `?tab=` and are not surfaces.

| Route | Status | Notes |
| --- | --- | --- |
| `/` | **migrated (this pass)** | now picks the Prism landing from the theme (was `?landing=prism` only). Not yet carried by Prism landing: self-hosted setup panel, public gallery rail, `SiteHeader`/`SiteFooter` |
| `/kit` | migrated | specimen page |
| `/org/developer` | migrated (this pass) | see the table above |
| `/pricing`, `/privacy`, `/terms`, `/invite/[token]`, `/portfolio`, `/usage`, `/me`, `/org` | theme-neutral | token layer only, no Prism composition; no Altimeter literals found |
| `/report`, `/report/[owner]/[repo]`, `/report/compare`, `/trends`, `/leaderboard`, `/scorecard/[owner]` | theme-neutral, partial | report heroes' blue glows fixed; level ramp (`LEVEL_HEX`) is a status ramp; `AltimeterGauge` is the name of the dimension chart (data-hue, not themed blue); `chartScale.ts` canvas `#0b1322` / `#020617` |
| `/about`, `/about-org` | partial | page glows fixed; the Remotion-style compositions (`about/compositionShared.tsx` `ACCENT`, `ACCENT_SOFT`, `ACCENT_FAINT`, `lerpHex`) need hex strings and stay Altimeter blue |
| `/launch` | partial | accent, glow and sky fixed; star palette canvas math unchanged |
| `/onboarding` | theme-neutral | wizard; `SelfHostSetupPanel` token-only |
| `/share/briefing/[token]` | neutral by design | deliberately not accent-coloured (`shareChrome.tsx`) |
| `/live/shared/[token]`, `/theater/[slug]` | partial | war room / theater compositions; same as Live |

### Shared chrome

Header (`Brand.tsx` `SiteHeader`, `IdentityMenu`), footer, `OrgShell` / `OrgTabNav`, Athena drawer, modals, error and
not-found pages, loading shells: **theme-neutral**, token-only. Athena's primary action and next-step link now use kit
`PrimaryAction` / `GhostAction` under Prism (via `useIsPrism`). `global-error.tsx` renders outside the root layout with its own
inline Altimeter blue (`#3b9eff`) and cannot read the theme: needs a decision (Remaining 3).

## Migrated in this pass

* `src/app/theme-prism.css`: sky / blue / indigo / cyan ramps re-pointed (fixes ~110 class uses at once, including the 75 audit
  action badges); Prism overrides for the literal-blue rules in `globals.css` (selection, deck progress and scroll cue,
  launch sky, constellation hover, row flash).
* Glows and gradients in `/about`, `/about-org`, `/launch`, report hero and conversion CTA, war room: `rgba(59,158,255,a)` and
  `#080d1a` became `color-mix` over `--color-accent` / `--color-ink` (same pixels in Altimeter).
* `fleetMapStars.ts` `ACCENT`, `PracticeCascade` stroke, repositories `Sparkline`, `AthenaChart`: `var(--color-accent)`.
* Live desk and on-air wall CSS modules: every blue literal became a scope variable with the old value as default, plus a
  `:global(html[data-theme="prism"])` block re-pointing the palette; inline blues in `RoundsSection` / `FlightLog*`.
* `src/app/page.tsx`: landing followed the theme (superseded in phase 3: always Prism).
* 13 org tabs gained `*.v2.tsx` compositions (table above); `NextMoveLink` kept in the three admin v2 files so
  `tab-link-graph.test.ts` keeps seeing the edges.

## Done in phase 2 (2026-10-22)

* **Kit is Prism-only** (`PrismLock`) and now specimens ScoreRing, AltimeterGauge, RadarChart, StackRadarChart, MatrixGrid heat cells, LevelBadge/ScorePill, the Live desk and the On Air wall (`KitViz`, `KitBatch6`, `KitLive`); treatments in `src/app/kit-viz.css`.
* **Parts promoted** from the v2 files: `Notice`, `FilterBar`/`FilterCount`, `SortHead`, `DecisionLedger`, `FillBar`/`BarRow`, `Display as="span"`, `Caption as`. Call sites repointed; the local `DecisionLedger.v2.tsx` is gone. Not built, by decision: a section header with a `WhyChip` slot (`SectionHead actions` already is the slot), `RowCard`/`PersonRow` beyond `BarRow` (one reuse), a client drawer theme read (`useIsPrism` stays).
* **Flattening rules** for the new v2 modules: `src/app/kit-modules.css` (roots gained `data-role` on Security, Adoption, Tech stacks, Proposals, Lessons; the others already had one). Remaining item 2 below is therefore half done: the interiors still carry their markup, now with their radius, muting floor, caps and inputs corrected by CSS.
* **Polish**: Prism focus floor for bare links and buttons, `type-*` roles in place of `text-[..rem]` in Passports v2, ad hoc error paragraphs became `Notice`.
* Still **not seen rendered** (no dev server was running on :3100 for either phase); see the report of this pass.

## Done in phase 3 (2026-10-22, theme switch retired)

* **Prism is forced, not defaulted.** `src/app/layout.tsx` always emits `<html data-theme="prism">` (`THEME_ATTR` in `src/lib/theme/theme.ts`). Removed: the `ascent-theme` cookie reader/writer (a stale `altimeter` cookie is never read), the `?theme=` link, the localStorage migration, `THEME_BOOT_SCRIPT`, `ThemeSwitch`, `ThemeSlot` (both headers) and `PrismLock`. `getTheme()`/`useIsPrism()`/the `theme` prop are gone from every tab.
* **Branches collapsed.** Each `<Tab>.tsx` entry renders its Prism composition directly; the 26 `*.v1.tsx` Altimeter compositions and the components only they used are deleted. `/` always renders `PrismLanding` (`?landing=prism` is ignored).
* Scripts under `scripts/kit/` still set an `ascent-theme` cookie; it is now inert and harmless.

## Dead Altimeter code left for follow-up

* The no-attribute base styles in `globals.css` (Prism overrides win, so they are unreachable but not removed) and the `html[data-theme="prism"]` prefix on every Prism selector (could be dropped once the base is rewritten).
* Shared Altimeter-shaped interior components listed in Remaining 2 are still used by the Prism compositions.

## Owner decisions

* **2026-10-22, blue data hues are KEPT under Prism by choice.** `passport-display.ts` band colours, `trends/deployTone.ts`, `STACK_COLORS`, the segment default colour `#3b9eff` (`lib/db/segments.ts`, stored in the DB) and the `/about` compositions (`components/about/compositionShared.tsx` `ACCENT*`, which needs hex strings) stay as they are. They are data encodings, not theme leaks, so they are not Remaining work.
* **2026-10-22, one shared folder.** `src/components/shared/` is the app-wide shared folder any feature or route may import (it replaces `org/shared`, `org/viz` and `org/followups`). The AGENTS.md import-rule conflict that v2 files hit (`ScopeFilterBar`, `NextMoveLink`, `TechStackSelector`, `RepoDimensionModal`, `DIMS`/`fmtHours`/`postureLabel`) is resolved by that restructuring, not by an exception; `src/components/shared/shared-boundary.test.ts` enforces the direction.

## Remaining (for phase 3 and the owner)

1. **Visual verification of every v2 and of the new kit sections** (Altimeter pair-check at 0 px, Prism shots at 1280x800, 1920x1080, 1440x3200, `scripts/kit/roles/<module>.json`, drive scripts). Never done for the phase-1 or phase-2 work. Check first: the MatrixGrid heat ramp (white text on paper at up to 36%), AltimeterGauge rope hues, the focus floor next to `outline-none` components.
2. **Interior components** reused by the v2 files that are still Altimeter-shaped in markup: `StackRadarChart`, `SecurityCheckMatrix`, `SecurityFindings`, `AdoptionCurve`, `DigestDimChart`, `TeamsMatrix`, `AuditLogCells`, `MembersTable`, Care* bodies, Loom grid, `ProposalDetail`. CSS corrects radius, caps, floor and inputs; card boxes and layout remain. One-off figure sizes (`text-[1.75rem] font-light` in SegmentMaturity, ContextDecayRows) want a Prism figure role.
3. **Out-of-layout / non-themeable surfaces**: `global-error.tsx`; canvas in `FleetMap`; `chartScale.ts` canvases; OG images, email and PDF (intentionally brand-fixed, skip).
4. **Public routes have no Prism composition**: `/pricing`, `/report/**`, `/launch`, `/about*`, `/onboarding`, `/portfolio`, `/usage`, `/leaderboard`, `/scorecard`, `/trends` render through tokens only. HANDOFF decision "poster scale vs dashboards" applies.
5. ~~Prism landing parity~~ (done 2026-10-22): the self-hosted setup panel and the public register were ported into `src/components/landing/prism/` (`PrismSetup`, `PrismRegister`). The landing keeps its own top bar and foot by design, so it does not render `SiteHeader`/`SiteFooter`.
6. ~~Phase 3 must know~~ (done 2026-10-22): the attribute is kept on `<html>`, so `kit.css`, `kit-viz.css` and `kit-modules.css` selectors are unchanged. `useIsPrism` is gone.
7. Not run: `npx eslint`, `npm run copy:check`.
