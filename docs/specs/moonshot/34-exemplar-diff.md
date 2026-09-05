# 34 — Exemplar Diff: signal-level comparison against a peer repo or cohort

size L · effort 6 / impact 8 / risk 3 · gate **contract** · lane **W2-J1** · wave **2**

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/report/compare.ts` — extract the evidence/gap set diff out of `diffScans` into an exported
  pure helper. **Behaviour-preserving refactor only.** The `reconcileDoneRec` region (and W1-E's
  outcome-ledger hook landed inside it in wave 1) is not touched.
- `src/lib/report/compare.test.ts` — extend with the helper's contract tests.
- `src/lib/report/llm-markdown.ts` — new exported `exemplarMarkdownSection()`; `reportLlmMarkdown()`
  gains one **optional** second argument and is byte-identical when it is omitted.
- `src/app/report/compare/page.tsx` — accept `?against=`, resolve the exemplar, render the panel.
- `src/components/report/ScanComparePicker.tsx` — an optional third "Against" field.
- `src/components/report/ScanComparePicker.test.tsx` — the new field's cases.
- `docs/features/reporting/report.md` — the compare section + the Known-gaps edit (below).

**Files to create**
- `src/lib/report/exemplar.ts` — **pure** (no DB, no `next/*`, no clock): ref grammar,
  `ExemplarProfile` / `ExemplarDiff` types, `diffAcrossRepos`, `selectOrgBest`, `buildCohortProfile`,
  `transferJoin`, floors.
- `src/lib/report/exemplar-load.ts` — the **server-only** sibling that reads Prisma
  (`build-not-in-gate` memory: pure module + `-load.ts` sibling keeps the client boundary intact).
- `src/lib/report/{exemplar,exemplar-load,llm-markdown.exemplar}.test.ts`.
- `src/app/report/compare/ExemplarPanel.tsx` + `ExemplarPanelParts.tsx` (server, presentational —
  route-colocated so the lane never enters `src/components/report/**` beyond the one picker),
  `ExemplarCopyButton.tsx` (client), `ExemplarPanel.dom.test.tsx`.

**Prisma models/columns needed:** *none*. Every input already persists
(`ScanDimension.evidence/gaps/signalScore`, `Scan.practiceShape` `schema.prisma:558`,
`Scan.engineProvider`, `Scan.rubricVersion`, `Repository.isPrivate/primaryLanguage`).

**Director-owned lines requested at merge**
1. `src/lib/db/org-insights.ts`: add `export` to the module-private `BENCHMARK_ELIGIBLE`,
   `CORPUS_BASIS`, `COHORT_MIN`, `CORPUS_MIN` (four keywords, no logic change) so the cohort exemplar
   reuses the *same* eligibility filter and floors instead of a second copy that can drift. If
   refused, `exemplar-load.ts` declares them locally naming the original — drift risk on the record.
2. `context-map.json` → "Reporting & Visualization › Trends & Comparison" `filePaths`: add
   `src/lib/report/exemplar.ts`, `exemplar-load.ts`, `src/app/report/compare/ExemplarPanel.tsx`.
3. `src/lib/db/wire-safe-dates.test.ts`: add `ExemplarProfile` and `ExemplarOption` (both declare
   `scannedAt: string | null`).
4. **No** `feature-doc-map.json` change: `src/lib/report/**`, `src/app/report/**`,
   `src/components/report/**` already map to `docs/features/reporting/report.md`.

**MUST NOT TOUCH:** `src/lib/mcp/**` · `src/app/api/mcp/route.ts` · `src/app/api/report/llm/route.ts`
and its `route.test.ts` · `src/lib/db/**` (read-only imports only) · `prisma/**` ·
`src/lib/practices/apply.ts` (W2-J2) · `src/lib/db/improvement.ts` · `compare.ts`'s
`reconcileDoneRec`/`RecReconciliation` region (W1-E) · `roadmapPriority.tsx` (W1-E).

**Handoffs to other lanes**
- **→ W2-K (#17, MCP registry):** the tool `compare_against_exemplar`. Input
  `{ repo: string; against?: string; scanId?: string }`; the handler calls `resolveExemplar()` +
  `diffAcrossRepos()` + `transferJoin()` from `@/lib/report/exemplar*`; output is `ExemplarDiff` plus
  `TransferRow[]`; scope `mcp:read`; org resolved from the token, never from the caller's argument;
  `cohort:` refs allowed only when the subject repo is public. W2-K owns registration, the plan gate
  and the envelope; J1 ships the functions and stable type exports, nothing under `src/lib/mcp/**`.
- **→ whoever owns `src/app/api/report/llm/route.ts`:** wiring `?against=` into that endpoint. Out of
  J1's set; the section is already reachable from the compare page's copy button without it.
- **→ W2-J2 (#33, practice adoption):** `transferJoin()` returns a `practiceId`; the apply link is a
  plain href into the Practices tab. J1 opens no PR and calls nothing in `practices/apply.ts`.

## Goal

Answer the question the diff engine structurally cannot: *what does a stronger repo — a named peer,
the org's best on this dimension, or the public cohort's top decile — have at the **evidence** level
that this repo lacks, and which practice transfers it?* Competitive angle: Factory rolls a fleet up
to "% at L3+" and DX/Jellyfish compare metrics; only a scanner that persists per-dimension evidence
strings across a neutral corpus can say "they have a coverage gate and an AGENTS.md test section, you
have neither, here is the practice that adds them".

**Known gaps this edits in `docs/features/reporting/report.md`:** the compare section's implicit
one-repo framing ("two scans", `?a=&b=`) is replaced by the two-axis framing (time *and* exemplar).
The **"Textual, not semantic, diffing"** known gap **stays** — it is more load-bearing here than in
the time diff, and the spec's honesty rule below restates it on-screen. It is edited, not deleted, to
name the exemplar path. (Deleting a true limitation is the failure mode `docs/DOC-DRIFT.md` records.)

## Behaviour

### The set-diff extraction (`compare.ts`)

```ts
/** Set difference over normalized evidence/gap strings. Duplicates on a side are PRESERVED
 *  (one repeated string is one entry on each side) — the exact semantics diffScans has today. */
export interface StringSetDiff { onlyInA: string[]; onlyInB: string[]; shared: string[] }
export function diffStringSets(a: readonly string[], b: readonly string[]): StringSetDiff;
```
`norm()` (trim → collapse whitespace → lowercase) stays the single normalizer and stays unexported
except through this helper. `diffScans` is rewritten to call it twice per dimension; its output must
be byte-identical (the fail-before below pins that).

### The exemplar ref grammar (pure, `exemplar.ts`)

`parseExemplarRef(raw): ExemplarRef | null` — an unparseable ref returns `null` and the page says so
rather than silently falling back:

| Token | Meaning |
|---|---|
| `repo:<owner>/<name>` (bare `<owner>/<name>` accepted) | a named peer repo, resolved **inside the viewer's org only** |
| `org:best` / `org:best:<D1..D9>` | the org's highest `signalScore` on that dimension (overall score for the bare form), subject repo excluded |
| `cohort:lang:<language>` / `cohort:archetype:<solo\|team\|org>` | the **public** corpus's top decile for that slice |

`formatExemplarRef(ref)` is the canonical URL token, so the compare URL stays shareable.

### `ExemplarProfile` — the exemplar side, one shape for all three modes

```ts
export interface ExemplarProfile {
  key: string;                      // canonical ref, echoed into the URL
  kind: "repo" | "org-best" | "cohort";
  label: string;                    // "acme/web" · "best in org for D2" · "TypeScript · top decile"
  repoFullName: string | null;      // null for cohort — a cohort is NEVER attributed to repos
  scannedAt: string | null;         // ISO string (wire-safe-dates), null for cohort
  overallScore: number | null;
  dimensions: ComparableDimension[]; // cohort: consensus evidence + MEDIAN scores
  population: number | null;         // cohort member count; null for single-repo modes
  basis: { rubric: string; excludesMockEngine: true; minSupport: number | null };
}
```
Honest-null rules: a dimension the exemplar side did not score is **absent**, never 0. A cohort
dimension whose members disagree below `minSupport` contributes no evidence rather than a thin list.

### `diffAcrossRepos(subject: ComparableScan, exemplar: ExemplarProfile): ExemplarDiff`

Per dimension, in canonical `DIMENSIONS` order, using `diffStringSets`: `absentSignals` (in the
exemplar, not the subject — **the transfer list**), `aheadSignals` (the reverse; a one-directional
panel would be dishonest), `gapsOnlyInSubject`, `scoreGap` / `signalGap` = `exemplar − subject`
**null unless both sides scored the dimension**, and `transferLine: string | null` ("D2 +14: exemplar
has *Coverage tracking configured*; *Found 61 test files*"), null rather than a filler sentence.
Diff-level: `notComparable: DimensionId[]` (one-sided dims, excluded from every count),
`absentSignalCount`, `aheadSignalCount`, `nothingToTransfer`, `basis`. Framing is **has / lacks**,
never better/worse: a signal a library lacks and a service carries is a difference, not a defect, and
the panel says so once at the top.

### Floors and eligibility (`exemplar.ts` constants, `exemplar-load.ts` queries)

- `EXEMPLAR_ELIGIBLE` = the `BENCHMARK_ELIGIBLE` filter (`engineProvider != "mock"`,
  `rubricVersion === SCORING_RUBRIC_VERSION`, today `r10`) applied to **both** sides: a mock-engine
  scan is a different scoring function, an old-rubric row a retired instrument. An ineligible
  *subject* still renders, with the basis line saying the two sides differ — honest, not hidden.
- `COHORT_EXEMPLAR_MIN = 5` repos **and** `COHORT_MIN_ORGS = 3` distinct owning orgs. The second
  floor is what this item adds: five public repos from one tenant is a de-facto private view of that
  tenant, and `CHAMPION_MIN_POP = 3` is the codebase's floor for "is this pattern real".
- Top decile = `Math.max(3, Math.ceil(n * 0.1))` members by overall score. `COHORT_SUPPORT = 2/3` — a
  signal enters the profile only at that share of the decile; `minSupport` travels in `basis`.
- Below any floor: `{ kind: "below-floor", population, min }` — never a partial cohort, never a silent
  fallback to a smaller slice. `EXEMPLAR_CANDIDATE_CAP = 2000` rows per cohort query
  (mirrors `BENCHMARK_CORPUS_CAP`).

### `exemplar-load.ts` (server-only reads)

```ts
export type ExemplarResolution =
  | { kind: "ok"; profile: ExemplarProfile }
  | { kind: "not-found" } | { kind: "forbidden" }
  | { kind: "below-floor"; population: number; min: number }
  | { kind: "unavailable" };                 // DB down / not configured — degrades like every sibling

export async function resolveExemplar(
  ref: ExemplarRef,
  ctx: { orgSlug: string; subjectFullName: string },
): Promise<ExemplarResolution>;

export async function listExemplarOptions(
  ctx: { orgSlug: string; subjectFullName: string; primaryLanguage: string | null; archetype: RepoArchetype },
): Promise<ExemplarOption[]>;              // { value, label, group } — picker options only

/** The cohort seam. Today: the live public corpus. #2 (open benchmark corpus) swaps in the
 *  rubric-versioned snapshot behind the SAME signature — no caller changes. */
export type CohortSource = (q: CohortQuery) => Promise<CohortMember[]>;
export const livePublicCorpus: CohortSource;
```

**Tenant rules — the whole security surface of this item:**
- `repo:` / `org:best` resolve **only** within the `orgSlug` the page already derived from
  `readableOrgForOwner(owner)`; the query carries `orgId` beside the name (gate-then-constrain), so a
  crafted `against=` naming another tenant's repo is `not-found`, not `forbidden` (no existence oracle).
  When `orgSlug === DEFAULT_ORG_SLUG` (`"public"`), `isPrivate: false` is on the query — the
  defence-in-depth clause `loadScanComparison` already carries (`scans-read.ts`).
- `cohort:` **always** queries the public org with `isPrivate: false` regardless of the viewer, and
  returns aggregate-only: no member repo is named, listed, linked or counted per-repo. This is the
  cross-tenant leak the finding names; the two floors plus aggregate-only are the answer, each pinned
  by a fail-before in `exemplar-load.test.ts`.
- No writes, so no audit row — consistent with `getOrgBenchmark` over the same corpus. Stated because
  a cross-tenant read that writes nothing is a choice, not an omission.

### Transfer-to-practice join (pure, `exemplar.ts`)

```ts
export interface TransferRow {
  dimId: DimensionId; absentSignals: string[];
  practice: { id: string; label: string; what: string } | null;   // PRACTICES by dimId
  housePattern: { outline: string[]; exemplars: number } | null;  // the org's MINED shape, if offerable
  applyHref: string | null; skillsHref: string | null;
}
export function transferJoin(
  diff: ExemplarDiff,
  mined: MinedPractice[],                    // minePracticeShapes(getOrgPracticeShapes(orgSlug))
  orgSlug: string | null,
): TransferRow[];
```
`PRACTICES` is one entry per dimension `D1..D9` (`src/lib/practices.ts`), so the join is total; a
dimension with no mapped practice yields `practice: null` and the row still shows the absent signals.
`housePattern` comes from `minedStarter(m)` / `m.outline`, `null` unless the miner judged the pattern
offerable. This generalizes the existing `ExemplarPointer` join (`roadmapPieces.tsx:56`) from "what
good looks like" to "what *they* have" rather than inventing a second join. Links via
`orgTabHref(slug, "practices"|"skills")`; `null` for a public-org viewer, so nothing dangles.

### UI

`/report/compare?repo=owner/repo&a=&b=&against=<ref>` (page stays `force-dynamic`, server-rendered).
- `ScanComparePicker` gains a second row: an **Against** `<select>` (Baseline / Compared unchanged),
  grouped `<optgroup>`s — *Your repos* · *Org best* · *Cohort* — plus "None". Selection pushes
  `against=` into the URL exactly like `a`/`b`, so the exemplar comparison is shareable and
  back-button-safe. Options come from `listExemplarOptions`; the picker itself stays presentational.
- `ExemplarPanel` (server) below `WhatChanged`: a `Surface` header carrying the exemplar label, the
  basis line (rubric, engine filter, cohort population + support), and the honesty line *"Signal-level,
  not semantic: evidence strings are model-phrased, so a reworded equivalent reads as absent."* Then
  per moved dimension a `DimensionDiffCard`-shaped block with two columns — **They have · You lack**
  — the `aheadSignals` collapsed under "You have that they don't", and the transfer row beneath.
- Primitives from `@/components/ui`: `Surface`, `Kicker`, `SectionHeading`, `Stat`; deltas via
  `DeltaPill` (`@/components/report/deltas`); level/score colour **only** via `LEVEL_HEX` / `scoreHex`
  (`@/lib/ui`); mono `tabular-nums` for every number. No hand-picked hex, no re-hardcoded
  `border-slate-800`.
- Notices (amber `role="status"`, matching the existing unhonored-ids notice): unparseable ref ·
  `not-found` · `below-floor` (with population and floor) · `unavailable`. Each says the comparison
  was **not** made; none silently substitutes another exemplar. `nothingToTransfer` renders "Nothing
  this exemplar has is missing here" — a real answer, not an empty panel.
- LOC: `page.tsx` is 175 today; the resolution block is extracted and the panel is split in two, so
  every `.tsx` stays under 300.

### LLM markdown

```ts
export function exemplarMarkdownSection(brief: ExemplarBrief): string;   // "## Against exemplar"
export function reportLlmMarkdown(report: ScanReport, extra?: { exemplarSection?: string }): string;
```
Appended immediately before `## Ask`. With `extra` omitted the output is byte-identical to today —
the byte-stability guarantee, and what keeps `src/app/api/report/llm/route.test.ts` (a file this lane
must not edit) green untouched. The section carries the basis line and the per-dimension absent
signals, and never names a repo for a cohort. The compare page renders it and hands the string to
`ExemplarCopyButton`.

### Plan gates, self-hosted, privacy

No plan gate: org and org-best modes read data the tenant already owns, cohort mode reads the public
corpus and is already floored. `selfHosted()` turns plan gates off repo-wide and changes nothing
here; on a self-hosted install the public corpus is that install's own, so the cohort option simply
does not clear `COHORT_MIN_ORGS` and is hidden by `listExemplarOptions` — the floor, not a flag, is
the mechanism. No escape-hatch env flag is introduced. No new PII: evidence strings are repo-level
detector output, and `CHAMPION_MIN_POP` does not apply because no individual is named anywhere.

## Build order

1. **Extract `diffStringSets`** in `compare.ts`; `diffScans` calls it. Gate: `compare.test.ts` passes
   unchanged. Landable alone.
2. **`exemplar.ts` core** — ref grammar, types, `diffAcrossRepos`, floors + `exemplar.test.ts`.
3. **`exemplar.ts` selection** — `selectOrgBest` and `buildCohortProfile` (pure over member lists,
   including both floors, the decile rule and the support threshold) + tests.
4. **`exemplar-load.ts`** — `resolveExemplar` / `listExemplarOptions` / `livePublicCorpus` behind the
   `CohortSource` seam, with the tenant and public-only guards + `exemplar-load.test.ts`.
5. **`transferJoin`** over `PRACTICES` + `minePracticeShapes` + tests.
6. **Picker + page wiring** — `against=` parsing, resolution, every notice state; no panel yet.
7. **`ExemplarPanel`** + parts + dom test; brand + LOC check.
8. **`exemplarMarkdownSection`** + `ExemplarCopyButton` + `llm-markdown.exemplar.test.ts`.
9. **Docs** — `report.md` compare section rewritten to the two-axis framing; the textual-diffing gap
   edited to name the exemplar path; the module table gains the two new files.

## Tests

- `src/lib/report/compare.test.ts` (extend). **Fail-before:** make `diffStringSets` dedupe within a
  side; the existing `diffScans` "computes deltas, transitions, gap movement…" case must fail. New
  cases: duplicates preserved, `shared` populated, normalization applied to the *lookup* only (the
  returned strings keep their original casing).
- `src/lib/report/exemplar.test.ts` (new). Ref grammar round-trips and rejects garbage;
  `diffAcrossRepos` yields `null` gaps for one-sided dimensions (**fail-before:** coerce a missing
  side to 0 → "never fabricates a score gap" fails); `aheadSignals` non-empty when the subject leads;
  `buildCohortProfile` returns `null` at 4 repos and at 5 repos from 2 orgs (**fail-before:** drop
  `COHORT_MIN_ORGS` → the second case passes, which is the leak); support drops a 1-of-3 signal.
- `src/lib/report/exemplar-load.test.ts` (new, mocked `getPrisma`). **Fail-before, one per guard:**
  remove `isPrivate: false` from the cohort query → "no private repo ever enters a cohort" fails;
  remove `orgId` from the `repo:` query → "a ref naming another tenant's repo resolves not-found"
  fails; remove `EXEMPLAR_ELIGIBLE` → "a mock-engine scan is never an exemplar" fails. Plus:
  `resolveExemplar` returns `unavailable` (not a throw) when the DB is down; the cohort result names
  no repo (assert the serialized profile contains no `/`-shaped full name).
- `src/components/report/ScanComparePicker.test.tsx` (extend): the Against field renders only when
  options exist; selecting pushes `against=`; "None" removes the param and keeps `a`/`b`.
- `src/app/report/compare/ExemplarPanel.dom.test.tsx` (new, `@vitest-environment jsdom`): both
  has/lacks columns render; a one-sided dimension shows the not-comparable badge and no delta; the
  basis + "signal-level, not semantic" line is always present; `below-floor` renders the floor.
- `src/lib/report/llm-markdown.exemplar.test.ts` (new): `reportLlmMarkdown(r)` is byte-identical to
  `reportLlmMarkdown(r, {})` and to a pre-change fixture; the section lands before `## Ask` and names
  no repo for a cohort brief.
- **Structural guards touched:** `wire-safe-dates` (two new client-imported types, Director-landed);
  doc-sync (report.md in the same turn). `id-routes-gated` is untouched — no `[id]` route is added.
- **UAT journey to re-run:** **Sam** (developer, UC1) — open a report, follow "Compare", pick an
  exemplar, reach a practice. Secondary: **Dana** (UC2) for the org-best path from a fleet repo.

## Gate + done criteria

`npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks (300 `.tsx`;
nothing here is under `src/features/**`) → e2e for `/report/compare` (UI moved). Done when: a repo
with a stronger sibling shows a non-empty transfer list with a practice link; a 4-repo cohort shows
the floor message; a private repo never appears in any cohort profile in the fail-before tests; the
LLM markdown is byte-stable without the new argument; `report.md` reflects both axes.

## Out of scope (explicitly)

- **#2 Open benchmark corpus** (concept-doc): rubric-versioned snapshots, percentile API, federation,
  consent. This lane reads the **live** public corpus behind the `CohortSource` seam and nothing
  else; when #2 lands it supplies the same shape and no caller changes.
- **#17 Work-time registry over MCP** (W2-K): the `compare_against_exemplar` tool — handed over above.
- **#33 Practice adoption ledger** (W2-J2): applying a practice, adoption tracking, house-pattern
  versions. This lane links to the Practices tab and writes nothing.
- **#9 Intervention outcome ledger** (W1-E): measuring whether a transfer worked. No
  `InterventionOutcome` row is written here and `reconcileDoneRec` is untouched.
- **#29 Score-input ledger** / **#31 signed tenant history bundle** (deferred): offline re-score and
  cross-tenant history export. **#37 Data-bound deck diagrams** (deferred): no marketing surface
  reads this diff.
- Semantic (embedding) matching of evidence strings, and any change to `norm()` or the guardband
  (G5). The under-match is labelled on screen, not engineered away.
