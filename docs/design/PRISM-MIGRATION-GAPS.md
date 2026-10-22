# Prism migration gaps (phases 1 and 2 of retiring Altimeter)

Status: **2026-10-22.** Phase 1 of 3: find everything not yet in Prism, migrate what can be migrated
without changing the Altimeter render. Phase 2 finishes what is listed under "Remaining"; phase 3 deletes the
switch (`KIT-REDESIGN-PROCESS.md`, "Retiring the duality").

"Migrated" means one of: a `*.v2.tsx` Prism composition picked by the entry; or a surface that is fully
theme-neutral (tokens only, no Altimeter literals) and so renders correctly under `theme-prism.css`.
**Nothing here was seen rendered**: no dev server was running, so no Prism shots, no Altimeter pair-check
(`scripts/kit/pairdiff.py`), no roles files. The Altimeter guarantee rests on the edits being
value-identical (`color-mix` over `--color-accent` / `--color-ink`, CSS variables with the old value as default,
entry components that still return the old markup) and on the test suite (full `vitest run`: 19989 passed).

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
* `src/app/page.tsx`: landing follows the theme (`page.doors.test.ts` mocks `getTheme`).
* 13 org tabs gained `*.v2.tsx` compositions (table above); `NextMoveLink` kept in the three admin v2 files so
  `tab-link-graph.test.ts` keeps seeing the edges.

## Done in phase 2 (2026-10-22)

* **Kit is Prism-only** (`PrismLock`) and now specimens ScoreRing, AltimeterGauge, RadarChart, StackRadarChart, MatrixGrid heat cells, LevelBadge/ScorePill, the Live desk and the On Air wall (`KitViz`, `KitBatch6`, `KitLive`); treatments in `src/app/kit-viz.css`.
* **Parts promoted** from the v2 files: `Notice`, `FilterBar`/`FilterCount`, `SortHead`, `DecisionLedger`, `FillBar`/`BarRow`, `Display as="span"`, `Caption as`. Call sites repointed; the local `DecisionLedger.v2.tsx` is gone. Not built, by decision: a section header with a `WhyChip` slot (`SectionHead actions` already is the slot), `RowCard`/`PersonRow` beyond `BarRow` (one reuse), a client drawer theme read (`useIsPrism` stays).
* **Flattening rules** for the new v2 modules: `src/app/kit-modules.css` (roots gained `data-role` on Security, Adoption, Tech stacks, Proposals, Lessons; the others already had one). Remaining item 2 below is therefore half done: the interiors still carry their markup, now with their radius, muting floor, caps and inputs corrected by CSS.
* **Polish**: Prism focus floor for bare links and buttons, `type-*` roles in place of `text-[..rem]` in Passports v2, ad hoc error paragraphs became `Notice`.
* Still **not seen rendered** (no dev server was running on :3100 for either phase); see the report of this pass.

## Remaining (for phase 3 and the owner)

1. **Visual verification of every v2 and of the new kit sections** (Altimeter pair-check at 0 px, Prism shots at 1280x800, 1920x1080, 1440x3200, `scripts/kit/roles/<module>.json`, drive scripts). Never done for the phase-1 or phase-2 work. Check first: the MatrixGrid heat ramp (white text on paper at up to 36%), AltimeterGauge rope hues, the focus floor next to `outline-none` components.
2. **Interior components** reused by the v2 files that are still Altimeter-shaped in markup: `StackRadarChart`, `SecurityCheckMatrix`, `SecurityFindings`, `AdoptionCurve`, `DigestDimChart`, `TeamsMatrix`, `AuditLogCells`, `MembersTable`, Care* bodies, Loom grid, `ProposalDetail`. CSS corrects radius, caps, floor and inputs; card boxes and layout remain. One-off figure sizes (`text-[1.75rem] font-light` in SegmentMaturity, ContextDecayRows) want a Prism figure role.
3. **Out-of-layout / non-themeable surfaces**: `global-error.tsx`; the `/about` Remotion compositions (`components/about/compositionShared.tsx` re-declares `#3b9eff`/`#080d1a` as hex and lerps them, so it cannot read CSS variables); canvas in `FleetMap`; `chartScale.ts` canvases; OG images, email and PDF (intentionally brand-fixed, skip).
4. **Data hues that are Altimeter blue** (decision, not a leak): `passport-display.ts`, `trends/deployTone.ts`, `STACK_COLORS`, `repoTrajectoryFilters.ts`, `liveWarRoomShared.ts`, segment default colour `#3b9eff` (`lib/db/segments.ts`, stored in the DB), brand colour defaults `#2563eb`.
5. **Public routes have no Prism composition**: `/pricing`, `/report/**`, `/launch`, `/about*`, `/onboarding`, `/portfolio`, `/usage`, `/leaderboard`, `/scorecard`, `/trends` render through tokens only. HANDOFF decision "poster scale vs dashboards" applies.
6. **Prism landing parity**: self-hosted setup block, gallery rail, header/footer, `selfHosted` flag.
7. **AGENTS.md import-rule conflict**: v2 files import `ScopeFilterBar`, `NextMoveLink`, `TechStackSelector`, `RepoDimensionModal`, `DIMS`/`fmtHours`/`postureLabel` from `components/org/shared`.
8. **Phase 3 must know**: delete `PrismLock` and the Altimeter notes in `docs/features/design-system/README.md`; the kit CSS lives in three files (`kit.css`, `kit-viz.css`, `kit-modules.css`) that all key on `html[data-theme="prism"]`, so removing the switch means either keeping the attribute on `<html>` or dropping that prefix. Components with hooks added this pass (`data-kit`, `data-role`, `data-dimension`, `--heat`) are inert in Altimeter. `useIsPrism` is still used by Athena, the Live headline sparkline and the war room.
9. Not run: `npx eslint`, `npm run copy:check`.
