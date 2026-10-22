# Prism migration gaps (phase 1 of retiring Altimeter)

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

## Remaining (for phase 2)

1. **Visual verification of every v2 added here** (Altimeter pair-check at 0 px, Prism shots at 1280x800, 1920x1080, 1440x3200,
   `scripts/kit/roles/<module>.json`, drive scripts). None were possible without a dev server.
2. **Interior components** reused by the new v2 files that are Altimeter-shaped (card boxes, mono caps, `rounded-*`): `StackRadarChart`,
   `MatrixGrid`, `SecurityCheckMatrix`, `SecurityFindings`, `AdoptionCurve`, `DigestDimChart`, `TeamsMatrix`, `AuditLogCells`,
   `MembersTable`, Care* bodies, Loom grid, `ProposalDetail`. The per-module `data-role="<module>-v2"` flattening rules in
   `kit.css` exist for the older modules (governance, passports, practices, delivery, executive, memory, registry, settings, skills)
   and **not yet** for the new ones.
3. **Out-of-layout / non-themeable surfaces**: `global-error.tsx`; Remotion-style about compositions; canvas in `FleetMap`
   (star palette); `chartScale.ts` canvases; OG images, email and PDF (intentionally brand-fixed, skip).
4. **Data hues that are Altimeter blue** (decision, not a leak): `passport-display.ts` (`#3b9eff`, `#7dd3fc`), deploy marker
   `trends/deployTone.ts` `#60a5fa`, `STACK_COLORS` `#3987e5`/`#1596b0`, `repoTrajectoryFilters.ts` and `liveWarRoomShared.ts`
   `manual: #38bdf8`, segment default colour `#3b9eff` (`lib/db/segments.ts`, stored in the DB), brand colour defaults `#2563eb`.
5. **Public routes have no Prism composition**: `/pricing`, `/report/**`, `/launch`, `/about*`, `/onboarding`, `/portfolio`, `/usage`,
   `/leaderboard`, `/scorecard`, `/trends` render through tokens only. HANDOFF decision "poster scale vs dashboards" applies.
6. **Prism landing parity**: self-hosted setup block, gallery rail, header/footer, `selfHosted` flag.
7. **AGENTS.md import-rule conflict**: the new v2 files import `ScopeFilterBar`, `NextMoveLink`, `TechStackSelector`,
   `RepoDimensionModal`, `DIMS`/`fmtHours`/`postureLabel` from `components/org/shared` (as the older v2 files already do).
8. Not run: `npx next build`, `npx eslint`, `npm run copy:check`.

## Kit parts the new v2 files wanted (Prism specimens for `/kit`)

`DecisionLedger` (selectable rows plus sticky batch bar; now local in `features/inflight/proposals/DecisionLedger.v2.tsx`),
`FilterBar` (filter menus + search + archive switch), `Display` accepting `span`, a paper-fill bar / meter, sortable table head,
`Caption` as `div`/`span`, ruled status banner (red boxed notices in audit), section header with `WhyChip` slot, `RowCard` /
`PersonRow` (Care profile, contributors), a client-drawer theme read other than `useIsPrism`. Altimeter-only components with
no specimen at all: `AltimeterGauge`, `RadarChart`, `StackRadarChart`, `MatrixGrid` heat cells, `LevelBadge`, score rings, the
Live desk and on-air wall (they carry their own palette module).
