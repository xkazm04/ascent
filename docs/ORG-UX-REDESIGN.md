# /org UX redesign — stop explaining the picture, draw it

**Status:** active build plan · opened 2026-09-08
**Scope:** every `?tab=` panel of the org dashboard (`src/features/**`, `src/components/org/**`)
**Owner rule:** a page that needs a paragraph to be understood is a page that has not been designed.

---

## 1. The diagnosis, measured

The org dashboard has **415 non-test components** across 24 tabs. Of those, **13 files contain a
single SVG element**. Meaning is carried by tables, meters and — overwhelmingly — by *prose that sits
above the visual and tells you what the visual is about to say*.

| Signal | Measurement |
| --- | --- |
| `SectionHeader description=` instances across /org | **79** |
| Explanatory chrome + paragraph copy (narrow regex, understates) | **~20.6k chars ≈ 3.7k words** |
| Tabs with **zero** SVG in any component | **17 of 24** |
| Tabs whose only graphical encoding is `Meter` (a 1‑D bar) | **11** |
| Files carrying `<table>` / `OrgTable` | 27 |

The report surface (`src/components/report/`) is the counter-example and the proof this repo can do
better: `RadarChart`, `AltimeterGauge`, `PostureQuadrant`, `ProvenanceTrack`, `DimLine`, `FillBar`.
`ProvenanceTrack`'s own header states the discipline we are missing everywhere else — *"Drawing the
same ±6 ribbon on all nine was a diagram of a lever that half of them do not have."* That surface
draws mechanisms. `/org` narrates them.

### The three anti-patterns, by name

**A1 — The essay lede.** A `SectionHeader description` of 150–300 characters explaining what the
component below shows, before the reader has looked at it.

> `ControlTimelineCard.tsx` — *"What each branch-protection and posture control was, when it changed,
> and — where a GitHub event named one — who changed it. Scan- and probe-sourced rows carry no actor:
> nobody performed those in a way we observed. Distinct from the Security tab's D9 check battery and
> from Passports › Doctor checks."*

Three separate jobs are fused here: (a) naming the component, (b) defining a data caveat, (c)
disambiguating it from two sibling surfaces. Only (a) belongs in a header, and (a) is one noun phrase.

**A2 — The narrated caveat.** A true, load-bearing epistemic qualifier delivered as a sentence the
reader must hold in their head while looking at a grid that does not show it.

> `ControlTimelineCard.tsx` — *"A dash under State means the control was not readable at the last
> observation — missing evidence, not a finding."*
> `DeliveryTrendSection` — *"An em dash is a missing measurement, not a zero."*
> `StancePerimeter` — *"declared, not enforced."*
> `AdmissionColumn` — *"The tier a scan DERIVES is a measurement. Admission is the decision."*

**These sentences are the most valuable text on the page and the worst-placed.** The distinction
*measured vs declared vs unobserved* is exactly the kind of thing a visual system encodes natively —
filled vs outlined vs hatched — and exactly the kind of thing prose fails to enforce, because prose
cannot stop a reader from reading a dash as a zero. Every one of these is a **design brief, not a
paragraph.**

**A3 — The rationale preamble.** Product argument shipped into the runtime UI.

> `stanceShared.tsx` — *"Without a published stance the fleet has one undifferentiated risk surface:
> a docs PR and a migration get the same review, and nothing marks the paths that should never be
> agent-authored. Draw the perimeter once and every repo inherits a band."*

This is a good paragraph. It belongs in the **empty state**, where the reader has nothing to look at
and a reason to act — not above a populated panel, permanently.

---

## 2. The law (every wave applies this, verbatim)

1. **Prose is demoted, never deleted.** Each sentence removed must land in exactly one of four
   places, and the agent records which in its commit body:
   - **(E) Encoded** — becomes a visual state: fill/outline/hatch, a gap in a line, a band, a tick.
   - **(D) Disclosed** — moves into an on-demand affordance: `<title>` on the SVG shape, a `WhyChip`
     popover, a legend row. Present on hover/focus, absent at first sight.
   - **(O) Onboarding** — moves into the **empty / zero / degraded state**, where the reader has no
     data and genuinely needs the argument (A3 belongs here, always).
   - **(F) Feature doc** — moves to `docs/features/<area>/*.md`. Disambiguation between sibling
     surfaces ("distinct from the Security tab's D9 battery") is documentation, not chrome.
   *If a sentence fits none of these four, it may stay — and the agent says why in the commit.*

2. **First sight is graphical.** The topmost element of every panel below the header is a shape that
   carries the panel's headline reading. Not a sentence, not a table header row.

3. **A header is a noun phrase.** `SectionHeader title` stays; `description` is deleted or reduced to
   **≤ 60 characters that state the unit or the window**, never the meaning ("last 90 days · 41 repos"
   is legal; "Where each dimension stands now, and how it moved over the week" is not).

4. **Encode the epistemic state, don't assert it.** One vocabulary across the whole dashboard:

   | State | Encoding | Replaces the sentence |
   | --- | --- | --- |
   | measured / observed | **solid fill**, full opacity | — |
   | declared but not enforced | **outline only**, dashed stroke | "declared, not enforced" |
   | not judged / not readable | **hatched** (45° 2px pattern), no value | "not judged, never as passing" |
   | missing measurement | **gap in the line / void cell**, never 0 | "an em dash is not a zero" |
   | decided by a human | **accent ring** around the mark | "admission is the decision" |
   | superseded / retired | **50% opacity + strikethrough rule** | "supersedes rather than deletes" |

   These live in **one module** and are imported. An agent that hand-rolls a hatch pattern has failed
   the wave.

5. **No new dependency.** Dependency-free SVG, on `chartScale.ts` (`vScale`, `linScale`,
   `LEVEL_BANDS`) and `LEVEL_HEX` / `scoreHex` from `@/lib/ui`. Colour is never picked by hand.
   `BRAND.md` governs: one azure on cold ink, the red→green ramp for levels and *nothing else*.

6. **Every graphic is accessible or it does not ship.** Follow `RadarChart.dom.test.tsx`: the SVG
   carries `role="img"` + a generated `<title>`/`aria-label`, and dense charts render a `sr-only`
   table equivalent built from the same data the geometry is. Motion respects
   `usePrefersReducedMotion` (`chartMotion.ts`). Entrances only, no loops.

7. **Tables survive where a table is the right shape** — auditable row-level evidence (Audit,
   Members, Evidence pack). The rule targets tables used *as a substitute for* an overview graphic,
   which is the whole first screen of Contributors, Delivery and Governance today.

---

## 3. The shared kit (Wave 0 — nothing else starts until this lands)

Five parallel agents will otherwise each invent a gauge. New module tree, server-safe unless noted:

```
src/components/org/viz/
  states.ts          the §2.4 vocabulary: HATCH_ID, <VizDefs/>, stateFill(), stateStroke(), STATE_LABEL
  Legend.tsx         symbol-first inline legend; one row per state actually present in the data
  WhyChip.tsx        "use client" — ⓘ disclosure holding a demoted caveat; keyboard reachable
  Distribution.tsx   ranked band / quartile strip with a "you" marker      (contributors, developer)
  BandLadder.tsx     nested concentric bands + what crosses each edge      (governance stance, passports)
  BudgetPack.tsx     packed-vs-omitted fill, omissions grouped by reason   (memory recall)
  FlowRibbon.tsx     3-stage ribbon: spend → output → reviewed             (delivery unit economics)
  StateTrack.tsx     state-over-time lane; change markers, gaps as voids   (governance timeline, adoption)
  MatrixGrid.tsx     declared × observed × enforced heat matrix            (passports, practices)
  ConcentrationCurve.tsx  Lorenz/bus-factor curve with the risk knee       (contributors, teams)
  index.ts           barrel
```

Each ships with a `.dom.test.tsx` proving: the state vocabulary renders the right encoding per state,
a `sr-only` equivalent exists, and reduced-motion is honoured. **`states.ts` is the load-bearing
file** — every later wave imports it and no wave re-defines a hatch, a dash pattern or a state label.

---

## 4. Triage — all 24 tabs

| Tab | prose | svg | Verdict | Headline move |
| --- | ---: | ---: | --- | --- |
| `standing/governance` | 2536 | 0 | **A — redesign** | Stance perimeter as `BandLadder`; control ledger as `StateTrack` (dash → void cell) |
| `shared/memory` | 1952 | 0 | **A — redesign** | Recall budget as `BudgetPack`; decay as a curve; reflect clusters as a merge graphic |
| `bought/contributors` | 1473 | 0 | **A — redesign** | Concentration as `ConcentrationCurve`; quartile prose → `Distribution` |
| `standing/passports` | 1473 | 1 | **A — redesign** | Clearance as `BandLadder`; capability/control matrices as `MatrixGrid` w/ hatch |
| `bought/delivery` | 1184 | 3 | **A — redesign** | Unit economics as `FlowRibbon`; DORA as a small-multiple, not 6 tables |
| `standing/repositories` | 849 | 2 | **B — retune** | Leaderboard keeps its table; add a fleet distribution above it |
| `admin/settings` | 1270 | 0 | **B — retune** | Provider cards: capability matrix instead of paragraph per provider |
| `shared/practices` | 1055 | 0 | **B — retune** | Rollout strip → `MatrixGrid` (declared/adopted/enforced per repo) |
| `bought/executive` | 731 | 0 | **B — retune** | A briefing should be ~all graphic; period-over-period as one instrument |
| `standing/overview` | ~ | 1 | **B — retune** | Landing surface: Fix-first as ranked impact bars, not sentences |
| `standing/adoption` | 483 | 0 | **B — retune** | Adoption is a curve; currently meters + prose |
| `shared/skills` | 696 | 0 | **B — retune** | Reuse/adoption per skill as a strip |
| `bought/teams` | 548 | 0 | **B — retune** | Per-dimension team grid → small-multiple heat |
| `standing/tech-stacks` | 173 | 2 | **B — retune** | Already partly visual; align to the kit |
| `shared/knowledge` | 398 | 0 | **B — retune** | Bundle coverage as a matrix |
| `bought/digest` | 508 | 0 | **B — retune** | Pasteable artifact — keep text, fix the *screen* rendering |
| `standing/security` | 188 | 0 | **B — retune** | D9 battery as a check grid w/ hatch for not-run |
| `shared/registry` | 335 | 0 | **C — light** | Sync-health strip only |
| `inflight/live` | 1135 | 3 | **C — targeted** | 52 files, high risk. Header/legend pass only, no re-architecture |
| `admin/members` / `audit` / `pairing` / `integrations` | — | 0 | **C — leave** | Setup + audit surfaces: instructions are legitimately instructions |
| `developer/*` | 634 | 0 | **B — retune** | Personal surface; `Distribution` for the org band |

---

## 5. Waves

Grouped so **write sets cannot collide** — every agent owns whole feature directories, and only
Wave 0 touches `src/components/org/`.

| Wave | Agents | Areas |
| --- | --- | --- |
| **0** | 1 (serial) | `src/components/org/viz/**` — the kit + its tests |
| **1** | 5 | governance · memory · contributors · passports · delivery |
| **2** | 5 | overview · repositories · executive · practices · adoption |
| **3** | 5 | settings · skills · teams · tech-stacks · knowledge |
| **4** | 4 | security · digest · developer · live (targeted) |

### Per-agent contract

Every wave agent is given, verbatim:

1. **Own only your directory.** `src/features/<group>/<tab>/**`. Never edit `src/components/org/viz/**`
   (Wave 0 owns it), never edit another agent's directory, never edit `src/lib/**` unless the tab's
   data genuinely lacks a field — and then say so loudly in the commit rather than reshaping a shared
   query.
2. **Apply §2 exactly.** For every sentence you remove, tag it `E`/`D`/`O`/`F` in the commit body.
3. **Import the kit.** `@/components/org/viz`. Do not re-implement a state encoding.
4. **Repo law.** ≤ 200 LOC per file under `src/features/**` (extract co-located siblings, `"use client"`
   only on files that need it). `.dom.test.tsx` for anything interactive or graphical.
5. **Doc sync (Stop hook).** Update the coupled doc from `scripts/docs/feature-doc-map.json` in the
   same turn — and **delete any "Known gap" the redesign closes.**
6. **Gate before commit:** `npm run typecheck` and `npx vitest run <your paths>`. Red gate → fix the
   tree. `--no-verify`, force-push and `ASCENT_SKIP_GATE=1` are denied at the permission layer.
7. **Commit on the current branch, atomically, with a pathspec** (`git commit -- <paths>`) — parallel
   agents share this checkout. **Never `git add <dir>`, never `stash`, never `reset --hard`.** Do not
   push.

---

## 6. Definition of done

- `SectionHeader description` count across `/org` falls from **79** to **< 15**, and every survivor is
  ≤ 60 characters of unit/window.
- Every Tier-A and Tier-B tab opens on a graphical element.
- The §2.4 state vocabulary is defined once and imported everywhere; grep finds no second hatch.
- No caveat is lost: every demoted sentence is traceable through a commit tag to a legend, a
  `<title>`, an empty state, or a feature doc.
- `npm run typecheck` and the unit suite are green at the end of every wave.
