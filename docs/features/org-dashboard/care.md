# Care — UC3 "individual care" in the app

_Status: **prototype round (C1)**. The tab is wired for real in the shell, the read model exists, and
three directional variants render behind a switcher. The data layer (C3/C4) is not built: the live path
returns an honest empty state._

The `Care` tab is where UC3 lands in the product (design: [`../../REGISTRY-AND-CARE-IMPL.md`](../../REGISTRY-AND-CARE-IMPL.md)
§5, strategy: [`../../GOLDEN-USE-CASES.md`](../../GOLDEN-USE-CASES.md)). The local `/mentor` skill is the
**sensor and coach** — it must run where the developer's sessions are, and transcript content never
leaves the machine. This tab is the **memory, the map and the bridge**: it keeps the profile and journal
across machines, grounds moves in the standing of every repo the developer commits to, and turns a kept
move into a registry skill authored by the person who proved it.

## One tab id, two modes

`?tab=care` (`ORG_TAB_IDS`, the **Chosen** nav group, last item before Governance; also in
`PERSONAL_TAB_IDS` and `MIGRATED_ORG_TAB_IDS`). The mode is resolved **inside the tab** by
`Organization.kind`, so the shell stays ignorant of workspace kind:

| Mode | What it shows |
| --- | --- |
| **personal** (`kind = "personal"`) | The developer's home: profile card (self-stated, edited on their machine) · moves board (proposed / trying / kept / dropped, each with the journal evidence, the fleet evidence and an expected saving; "promote to registry" on kept moves) · session-shape strip of the 30-day counts **they chose to share**, with an optional anonymous org band · the repos they commit to and those repos' open recommendations · journal of weekly retro lines · setup + the privacy ledger |
| **org** | The anonymized aggregate **under the champion floors**: care adoption as counts · most-kept moves fleet-wide → "author as registry skill" · anonymized interview themes ("asks") · session-shape distribution as quartile bands · kept move → repo score delta. **Never a per-person row** |

The anti-surveillance guarantee is structural, not cosmetic: `CareOrgView` has **no field that could
hold a person**, and `CHAMPION_MIN_POP` (from `src/components/org/shared/champions.ts` — the same floor
Contributors / Adoption / Teams use) is stated on screen rather than silently applied.

## Files

| Piece | File |
| --- | --- |
| Types, constants, pure derivations | `src/lib/org/care-view.ts` |
| Server loader (`getCareView`) | `src/lib/org/care-view-load.ts` |
| Fixture view models (`?demo=`) | `src/lib/org/care-view.fixture.ts` |
| Tab (server) | `src/components/org/library/care/CareTab.tsx` |
| Variant switcher (client) | `.../CarePanelSwitcher.tsx` |
| Variants | `.../CarePanelCompanion.tsx`, `.../CarePanelClimb.tsx`, `.../CarePanelCockpit.tsx` |
| Shared sub-components | `.../CareBits.tsx`, `CareProfileCard`, `CareMovesBoard`, `CareSessionShape`, `CareRepoGaps`, `CareJournal`, `CarePrivacyLedger`, `CareWhyStrip`, `CareOrgAggregate`, `CareClimbChart`, `CareAltimeter`, `CareCockpitGauges` |
| Legacy path redirect | `src/app/org/[slug]/care/page.tsx` → `?tab=care` |

`care-view.ts` is deliberately **pure** (types + constants + helpers) with the `@/lib/db` read split into
the `-load.ts` sibling, because every variant is a client component and imports those helpers — the same
client/server boundary split as `skill-usage-load.ts`.

## The three prototype directions

- **Companion / Journal** — a private notebook: `Dateline` masthead in the first person, profile at top,
  moves as a four-column board, journal as dated entries. Org mode reads as a *shared notebook of what
  helps here*.
- **Climb / Trajectory** — the developer's ascent: a dependency-free SVG trajectory (cumulative kept
  moves as a step line, time returned as the shaded area, the repos they commit to as elevation ticks in
  the right margin), an altimeter reading habits as altitude inside the org band, moves as the next
  handholds. Org mode is the *distribution* of climbs, as bands.
- **Instrument / Cockpit** — the flight deck: session-shape `Meter` dials with the org median as the
  threshold marker, moves as adjustments with an expected effect, the privacy ledger as a switch panel.
  Org mode is fleet gauges with the denominator and the floor printed on each face.

Every variant renders **both modes** and the empty / below-floor states.

## Viewing the prototype

`/org/<slug>?tab=care` is the live (empty) state. Fixtures:
`?tab=care&demo=personal`, `&demo=personal-empty`, `&demo=org`, `&demo=org-below-floor`. A fixture always
stamps a visible `fixture · <state>` chip so a prototype is never mistaken for a developer's real data.

## Known gaps

- **No data layer.** `getCareView` decides the mode and returns empty; there are no `PersonalMentorProfile`
  / `MentorMove` / `MentorJournal` tables and no `POST /api/me/mentor/share` yet (C3), and no floored org
  aggregate (C4). Nothing on this tab is fabricated in the live path.
- **Actions are unwired.** Share, Install mentor, Mark kept/dropped, Promote to registry and "author as
  registry skill" `console.info` their intent; the PR-opening bridge to the registry lands with C4.
- **No variant has been chosen.** The switcher and the three variants are all still on disk; consolidation
  collapses to one.
- **The `/mentor` skill does not exist yet** (C2) — nothing can share to this tab until it ships in the
  `npx ascent` distributable.
