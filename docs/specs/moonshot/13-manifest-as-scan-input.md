# 13 — Manifest-as-scan-input: declared-vs-proven capability conformance

size L · effort 7 / impact 9 / risk 5 · gate: **contract** · lane **W1-A Standard** · **wave 1**
(built FIRST in W1-A; #16 Doctor per-check ledger follows by the same builder)

## Premise check against the current tree (read this first)

Three premises from the finding were re-verified; one is wrong, one is materially *stronger* than
written, and the rest hold.

1. **HOLDS.** `buildManifestData` derives every capability from `commandsFor(report.repo.primaryLanguage)`
   — `src/lib/standard/manifest.ts`, `buildManifestData` (~L37–45). `TYPECHECK` / `SOURCE_FILE` are
   keyed on `LangCommands["ci"]`. No repo evidence is consulted.
2. **FALSE (moved).** The finding cites `tracks.ts:702-747` for `resolveStack`. `src/lib/onboarding/tracks.ts`
   is 399 lines and contains no such function; `resolveStack` lives in **`src/lib/onboarding/stack.ts`**
   (`export function resolveStack`, ~L49) and is called once per report from `selectTracks`
   (`tracks.ts` ~L362). The design below targets `stack.ts`, which means **W1-A's write set must be
   widened by one file** (see Write set).
3. **STRONGER than written.** The finding says the scan "never parses" the manifest. It is worse:
   `aiStandard()` reads `idx.content(".ai/manifest.yaml")` (`src/lib/analyze/index.ts`, ~L158), but
   `RepoIndex.content()` only sees files in `snapshot.files`, and **`pickFilesToFetch`
   (`src/lib/github/source.ts`, ~L744) never requests `.ai/manifest.yaml`**. So the +4 "Manifest
   declares capabilities + control placement" D1 signal is **unreachable today** — only the +2
   tree-presence signal ever fires. This is the load-bearing consequence: the moment W1-B adds the
   file to the fetch list, an existing detector starts scoring on repos it never scored before. That
   is handled explicitly under "Score-movement rule" and is why this item is gate: contract.
4. **HOLDS.** `doctor.mjs`'s `--run` write-back of `verified` exists (`src/lib/standard/doctor.ts`,
   inside the `DOCTOR` template literal) and the POSTed body is `{repo, headSha, score, fails, warns,
   unchecked}`; `recordConformance` (`src/lib/db/org-watch.ts`, ~L462) persists only
   `aiConformance{,Fails,Warns,At}`. Per-check telemetry is **#16's** scope, not this spec's.
5. **HOLDS.** `Scan.passportJson` / `Scan.contextHealthJson` + the `Repository.*` latest-cache mirror
   is the established display-only sidecar shape (`prisma/schema.prisma` ~L264/566,
   `src/lib/db/scans-persist.ts` ~L124–146, ~L402–406). `manifestJson` copies it exactly.
6. **HOLDS.** `contextGate` (`src/features/standing/passports/autonomy/autonomyGateBuilders.ts` ~L114)
   already consumes `a.manifest` as a bare presence boolean and `conformance` as a number — the
   verified-capability count drops straight in.

One correction to the finding's own framing: the doctor's parser **cannot be extracted and shared**.
`DOCTOR` is a JavaScript source string authored with no backticks and no `${}` so it embeds verbatim
in a template literal and in SKILL.md. `read.ts` is therefore a **TypeScript re-implementation of the
same regex-YAML subset, pinned to the doctor by a parity test**, not a refactor.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to create**
- `src/lib/standard/read.ts` — the TS reader for the doctor's regex-YAML subset (pure, no IO).
- `src/lib/standard/readout.ts` — `ManifestReadout` type + `buildManifestReadout()` (pure).
- `src/lib/standard/read.test.ts` — reader + round-trip + doctor-parity tests.
- `src/features/standing/passports/capabilityMatrix.ts` — pure fleet aggregation (≤200 LOC).
- `src/features/standing/passports/capabilityMatrix.test.ts`
- `src/features/standing/passports/CapabilityMatrix.tsx` — the matrix surface (≤200 LOC).
- `src/features/standing/passports/CapabilityMatrixLegend.tsx` — legend + honest-absence copy.

**Files to edit**
- `src/lib/standard/manifest.ts` — `buildManifestData(report, opts?: { observed?: ManifestReadout })`;
  observed capabilities/controls/agents/boundaries win over `commandsFor` guesses.
- `src/lib/standard/index.ts` — barrel: re-export `readManifestYaml`, `buildManifestReadout`, types.
- `src/lib/onboarding/stack.ts` — `resolveStack(report)` prefers `report.manifest` commands over
  `commandsFor`; `StackContext` gains `source: "manifest" | "language" | "placeholder"`.
- `src/lib/onboarding/tracks.ts` — `stackLabel` / `stackDeliverable` say "from this repo's
  `.ai/manifest.yaml`" when `source === "manifest"`.
- `src/lib/onboarding/skill.ts` — new `## What this repo has already proven` section (verified
  capabilities + where each control is wired) between `currentState()` and `controlModel()`.
- `src/lib/analyze/index.ts` — **the `aiStandard()` readout hook only**: parse the manifest through
  `readManifestYaml` instead of the three inline regexes, keeping label text and point values byte-identical.
- `src/lib/scan-compose.ts` — one line: `report.manifest = buildManifestReadout(snapshot)` beside
  `report.contextHealth`.
- `src/lib/db/scans-persist.ts` — `manifestJson` on the `Scan` create and the `Repository` latest-cache
  update, mirroring `contextHealthJson` exactly (four call sites).
- `src/lib/db/org-rollup.ts` — `OrgRepoRow.manifest: ManifestReadout | null`, parsed from
  `Repository.manifestJson` (same defensive parse as `contextHealth`).
- `src/features/standing/passports/PassportsTab.tsx` + `PassportsSwitcher.tsx` — mount the matrix as a
  switcher view.
- `src/features/standing/passports/autonomy/autonomyGateBuilders.ts` — `contextGate` reads verified
  capability count; `source` flips `"mock"` → `"scan"` when a readout is present.
- `docs/features/onboarding/ai-manifest-spec.md` — the "read back" half of the contract (below).
- `docs/features/org-dashboard/org-intelligence.md` — the Passports capability-matrix section.

**Prisma (landed by the wave-1 schema pass, NOT by this lane)**
- `Scan.manifestJson String?` — TEXT, additive, nullable. Per-scan history.
- `Repository.manifestJson String?` — TEXT, additive, nullable. Latest-scan cache.
- `prisma/init.sql`: both columns in the CREATE blocks **and** as
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS` lines (PGlite reconcile).
- **No `wire-safe-dates.test.ts` entry needed**: `ManifestReadout` declares no `Date` — `generatedAt`
  is the manifest's own `YYYY-MM-DD` **string** and `readAt` is an ISO **string** stamped at compose time.

**Director-owned lines requested at merge**
- `src/lib/types.ts`: one additive optional field on `ScanReport` —
  `manifest?: ManifestReadout | null;` importing the type from `@/lib/standard/readout`
  (type lives in the lane so the shared file takes exactly one line).
- `src/lib/db/index.ts`: no new export (persist/rollup paths already exported).
- `context-map.json`: add `src/lib/standard/read.ts`, `src/lib/standard/readout.ts` to the
  "AI-Native Standard & Onboarding Skill" context `filePaths`.
- `scripts/docs/feature-doc-map.json`: no new glob — `src/lib/standard/**` already maps to
  `ai-manifest-spec.md`.

**Write-set widening requested** (§2 lists `src/lib/onboarding/{tracks,skill}.ts` only)
- `src/lib/onboarding/stack.ts` — premise 2; no other wave-1 lane claims it.
- `src/lib/db/scans-persist.ts` (the four `manifestJson` lines) and `src/lib/db/org-rollup.ts` (the
  one row field) — no wave-1 lane claims either; both are additive-only here.

**MUST NOT TOUCH**
- `src/lib/github/source.ts` (W1-B owns `pickFilesToFetch`).
- `src/lib/analyze/index.ts` beyond the `aiStandard()` body; `context-health.ts`, `guidance-graph.ts`,
  `scoring/claims.ts`, the rubric hash (all W2-I).
- `src/lib/standard/pr.ts` (W1-H).
- `src/lib/alerts.ts`, `prisma/**`, `src/lib/db/index.ts`, `context-map.json`, `feature-doc-map.json`.
- `src/lib/db/scans-read.ts` (W1-F holds it this wave — see handoffs).
- `src/lib/practice-artifact.ts` (unclaimed but out of scope, see Out of scope).

**Handoffs to other lanes**
1. **→ W1-B (Fetch + memory mirror):** add `.ai/manifest.yaml` and `.ai/guardrails.yaml` to
   `pickFilesToFetch` **step 0**, unconditionally and *before* the `MAX_FILES` budget is spent
   (they are two files; the `preferScoped` guidance block is the right neighbour). Without this the
   readout is null on every scan and the item is inert. W1-B already owns this file for `.ai/memory/`.
2. **→ W1-F (Retention):** one line in `src/lib/db/scans-read.ts` — select `manifestJson` and parse it
   in the report-reconstruction path (`getScanReportByCommit`), so a permalink report shows the same
   readout the scan produced. If W1-F declines, this ships in wave 2 and the permalink degrades to
   "not assessed by this scan" (the same known omission `docs/REFERENCE-SCAN-AUDIT.md` records for
   `passport`), never to a fabricated empty readout.
3. **→ W2-I (Guidance / rubric r11):** record in the r11 bump note that the D1
   "Manifest declares capabilities + control placement" signal became *reachable* in this wave (see
   Score-movement rule). This lane changes no point value and bumps no rubric.
4. **→ #16 (same builder, next):** `ManifestReadout.controls` is the declared half that #16's
   per-check ledger joins against the doctor's observed half. Do not build the join here.

## Goal, and the Known gap it deletes

Ascent authors the repo's agent-facing contract and then ignores it: the scanner never reads
`.ai/manifest.yaml`, the onboarding skill re-guesses the repo's commands from its primary language,
and the doctor's proven `verified` flags never leave the repo. This item makes the manifest a **scan
input** — parsed, persisted, fed back into generation, and shown fleet-wide as declared vs proven vs
wired. *Competitive angle: every competitor scores a repo against the vendor's own criteria; nobody
scores it against the repo's own vendor-neutral declared contract and independently proves it.*

**Gap deleted:** `docs/features/onboarding/ai-manifest-spec.md` documents a one-way contract — seven
design principles and a doctor spec, with **no read-back path**; principle 7 ("Declared, then proven")
stops at the repo boundary. The spec gains a "Read-back: the manifest as a scan input" section and
principle 7 is completed. `docs/features/onboarding/README.md`'s "Known gaps" list is untouched (its
entries are about wizard sub-flows, not this).

## Behaviour

### Data model — `ManifestReadout` (display-only, never scored in this wave)

```ts
// src/lib/standard/readout.ts
export type ReadoutStatus = "ok" | "unreadable" | "absent";
export interface CapabilityReadout {
  name: string;
  command: string;
  /** true/false as DECLARED by the doctor's write-back; null when the key was absent. */
  verified: boolean | null;
  /** the command still carries a `<placeholder>` — declared but not fillable */
  placeholder: boolean;
  /** where this capability is enforced, from `controls` — [] means declared nowhere. */
  wiredAt: ("prePush" | "ciHardPass")[];
}
export interface ManifestReadout {
  status: ReadoutStatus;
  /** ISO string stamped at compose time. NEVER a Date (wire-safe-dates). */
  readAt: string;
  /** the manifest's own YYYY-MM-DD, or null. */
  generatedAt: string | null;
  schemaVersion: string | null;
  /** major-version mismatch with MANIFEST_SCHEMA_VERSION — parsed leniently, flagged honestly. */
  schemaAhead: boolean;
  capabilities: CapabilityReadout[];
  controls: { prePush: string[]; ciHardPass: string[] };
  paths: Record<string, string>;
  agents: { id: string; kind: string; entrypoint: string }[];
  /** `generatedFrom` entries that are still `<placeholder>` shaped. */
  placeholders: string[];
  /** `controls.*` entries with no backing capability — the declared-vs-declared gap. */
  unbacked: string[];
  /** parse notes, never thrown; capped at 10. */
  notes: string[];
}
```

**Honest-null rules (G4).** No manifest in the tree → `status: "absent"`, `capabilities: []` — the UI
renders "—", never `0/0 verified`. Manifest present but unparseable (bad YAML, truncated by
`MAX_FILE_BYTES`) → `status: "unreadable"` with a note; **a malformed manifest never fails the scan
and never scores 0**. `verified` absent from a capability line → `null` ("not run"), which is *not*
`false` ("ran and failed"). A repo whose manifest is fetched but whose tree lacks `.ai/` cannot occur;
if it does, `absent` wins.

**Idempotency / retention.** `manifestJson` is a pure derivation of the snapshot: re-scanning the same
commit rewrites an identical blob. It is scan-derived data, so it purges with the scan
(`docs/features/data/retention.md` already covers `Repository` scan-derived caches) and is erased with
the repo. No new retention rule.

**Privacy floor.** A capability command is repo content that could embed a token
(`curl -H "Authorization: …"`). `readManifestYaml` runs every command through a redactor before it
reaches the readout: any `\b(gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b` or
`(token|secret|password|api[-_]?key)=\S+` run is replaced with `«redacted»` and a note is added. The
capability matrix is org-scoped behind `requireOrgAccess` and commands are **never** rendered on the
public leaderboard or any aggregate surface, so `CHAMPION_MIN_POP` does not apply (no public
aggregate is created). No audit row: this path publishes nothing and spends nothing.

**Self-hosted / plan gates.** None. The readout is scan-derived and free on every tier; `selfHosted()`
turns plan gates off anyway, and gating a *readout* would make the honest-absence copy indistinguishable
from a paywall.

### Pure modules

```ts
// src/lib/standard/read.ts — no IO, no throw
export function readManifestYaml(text: string | undefined): ManifestReadout;
export function readGuardrailsYaml(text: string | undefined): { neverCommit: string[]; neverTouch: string[] } | null;

// src/lib/standard/readout.ts
export function buildManifestReadout(snap: RepoSnapshot): ManifestReadout;

// src/lib/standard/manifest.ts (signature change, backwards compatible)
export function buildManifestData(report: ScanReport, opts?: { observed?: ManifestReadout | null }): ManifestData;

// src/features/standing/passports/capabilityMatrix.ts
export interface CapabilityCell { state: "verified" | "declared" | "placeholder" | "absent"; wiredAt: ("prePush"|"ciHardPass")[] }
export function buildCapabilityMatrix(repos: OrgRepoRow[]): {
  capabilities: string[];               // union, recommended vocabulary first, then repo-invented
  rows: { fullName: string; cells: Record<string, CapabilityCell>; verified: number; declared: number }[];
  /** repos with no readable manifest — counted, listed, never folded into a denominator. */
  unassessed: string[];
};
```

`readManifestYaml` implements exactly the doctor's subset: `kv`, `sub`, `flow`, the
`capabilities` block scan, and the `paths:`-scoped pointer read. It reads unknown keys into
`paths`/`capabilities` and ignores unknown top-level blocks (spec principle 3).

### Generation reads its own output

- `buildManifestData(report, { observed })`: when `observed.status === "ok"`, each observed
  capability's `command` wins over the `commandsFor` guess, `controls` are carried through verbatim,
  and `boundaries`/`agents`/`purpose` keep the human's edits instead of regressing to `TODO`.
  `generatedAt` is re-stamped; `verified` is carried through (regeneration must not erase a proof).
  Absent/unreadable → today's behaviour byte-for-byte.
- `resolveStack`: a readable manifest with a concrete `test`/`build`/`lint` command yields
  `{ source: "manifest", concrete: true }` **before** the language-candidate walk. The placeholder
  tuple stays the last resort.
- `skill.ts` gains `## What this repo has already proven` — the verified capabilities with their
  commands and where each is wired, or, when there is no readout, one sentence saying the repo has not
  declared a contract yet and Step 0 will create one. No fabricated proof.

### UI — Standing → Passports, "Capabilities" switcher view

`CapabilityMatrix.tsx` renders repo × capability. Chrome from `@/components/org/ui`
(`OrgTable`, `Tile` + `TILE_LEDGER` for the three headline counts, `Meter` for verified/declared
ratio) and `@/components/ui` (`Surface`, `Kicker`, `SectionHeading`). Cell states use the azure accent
at four weights — **no hand-picked hexes**; any score-shaped colour comes from `scoreHex`
(`@/lib/ui`). A `wiredAt` cell carries a hairline underline for `prePush` and a dotted one for
`ciHardPass`, explained in `CapabilityMatrixLegend.tsx`. Repos in `unassessed` render as a separate
"not assessed — re-scan" band **below** the table and are excluded from every denominator (G4).
Both new `.tsx` files stay under the 200-LOC `src/features/**` cap.

`contextGate` gains the readout: `+10` for a present manifest becomes `+10` presence and `+8` scaled
by `verified / declared`, and `source` becomes `"scan"` when a readout exists (it is currently
`"mock"` for any repo with guidance files). The mock staleness penalty is untouched — that is a
separate `DATA_MODEL_GAPS` entry.

### Score-movement rule (G5, and why this is gate: contract)

This lane changes **no point value, no label, no rubric hash**. But W1-B's fetch-list handoff makes
the existing +4 D1 signal reachable for the first time, which can move D1 by 4 points on an
*unchanged commit* for any repo carrying a conformant manifest. The rule: `aiStandard()` is rewritten
to source that branch from `readManifestYaml` while a fixture test pins the emitted points to
`2` and `4` and the label strings byte-for-byte; the reachability is disclosed to W2-I for the r11
bump note (handoff 3). The readout itself is **display-only and never enters the LLM prompt** — the
same pin `context-health.test.ts` holds for Context Health. No guardband change, no D9 change.

## Build order

1. `read.ts` + `readout.ts` + `read.test.ts`: the reader, the redactor, the honest-null statuses, and
   the round-trip test `serializeManifestYaml(buildManifestData(fixture)) → readManifestYaml → equal`.
   Landable alone; nothing consumes it yet.
2. Doctor-parity test: run `read.ts` and the `DOCTOR` string's own regexes over the same fixture
   corpus (including a quoted-command manifest and a repo literally named `on`) and assert identical
   capability maps. This is the guard against the two parsers drifting.
3. `ScanReport.manifest` (Director's one line in `types.ts`) + `scan-compose.ts` sets it +
   `scans-persist.ts` persists `manifestJson` to `Scan` and `Repository`. Gateable: null everywhere
   until W1-B lands the fetch.
4. `aiStandard()` re-sourced through `readManifestYaml`, with the point/label pin test (step's
   fail-before: change a point value → test fails).
5. `buildManifestData(report, { observed })` + regeneration tests (observed wins; `verified` survives;
   absent → byte-identical to today).
6. `resolveStack` + `stackLabel`/`stackDeliverable` + skill's "already proven" section.
7. `org-rollup.ts` row field + `capabilityMatrix.ts` + its test (pure, no UI).
8. `CapabilityMatrix.tsx` / legend / switcher mount + `contextGate` wiring.
9. Docs: `ai-manifest-spec.md` read-back section (completing principle 7), `org-intelligence.md`
   Passports section. Same turn as step 8 (doc-sync rule).

## Tests

**Unit (vitest)**
- **new** `src/lib/standard/read.test.ts` — round-trip; quoted commands containing `"`;
  `verified: null` when the key is absent; `status: "unreadable"` on truncated YAML **with no throw**;
  redaction of a token-bearing command; unknown top-level block ignored; `schemaAhead` on a `1.x`
  manifest. *Fail-before:* an unparseable manifest currently has no code path at all — the test file
  does not compile before `read.ts` exists.
- **new** `src/features/standing/passports/capabilityMatrix.test.ts` — `unassessed` repos are excluded
  from denominators. *Fail-before:* return the unassessed repos as `0/0` cells and the test fails.
- **extend** `src/lib/standard/standard.test.ts`, `describe("manifest <-> doctor round-trip")` — the
  observed-wins regeneration cases. *Fail-before:* drop `opts.observed` and a hand-edited `secretsFrom`
  regresses to `TODO`.
- **extend** `src/lib/analyze/signals.test.ts` — the D1 point/label pin (2 and 4, exact strings) plus a
  fixture asserting a fetched manifest and an unfetched one differ **only** by the +4.
  *Fail-before:* change either number and it fails.
- **extend** `src/lib/onboarding/skill.test.ts` — a manifest-sourced command appears in the skill and
  the language guess does not; with no readout, the "already proven" section is absent (not empty).

**Structural guards**
- `wire-safe-dates.test.ts`: no entry needed (no `Date` on `ManifestReadout`) — but the Director should
  confirm the type is on the guard's *reviewed* list, since it is client-imported via `OrgRepoRow`.
- `id-routes-gated.test.ts`: untouched — this item adds **no route**.
- `scripts/docs/check-doc-sync.mjs`: satisfied by step 9 (`src/lib/standard/**` → `ai-manifest-spec.md`).
- LOC: 200-cap check on the two new `src/features/**` `.tsx` files and `capabilityMatrix.ts`.

**e2e / UAT**
- **Sam (staff engineer)** — the primary journey: run the onboarding skill on a repo that already has a
  manifest and confirm the generated tracks quote *his* commands, not `npm test`. Re-run after step 6.
- **Dana (VP engineering)** — Passports → Capabilities: "which repos have proven their tests run".
  Re-run after step 8. No briefing/PDF change, so M1 does not bind.
- Playwright: one spec asserting the "not assessed — re-scan" band renders for a repo with no readout
  and that no `0/0` appears.

## Gate + done criteria

Builder gate in order: `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` →
LOC checks → Playwright (UI moved). Done when: a scanned repo carrying `.ai/manifest.yaml` persists a
non-null `manifestJson`; the onboarding skill for that repo quotes the manifest's commands; the
Passports capability matrix shows declared/verified/wired with unassessed repos separated; a
deliberately corrupted manifest yields `status: "unreadable"` and a **green** scan; `ai-manifest-spec.md`
carries the read-back section.

## Out of scope (explicitly)

- **#16 Doctor per-check ledger** (same lane, next): `ConformanceReport` / `ConformanceFinding`, the
  per-check control matrix, `recordConformance`'s widened payload, `requireChecks` on the gate. This
  spec touches `recordConformance` **not at all**.
- **#15 Guidance arbiter / graph** (W2-I): the manifest `guidance` block, `project`, the D1 coherence
  rubric bump and the rubric hash. This lane bumps no rubric.
- **#14 `.ai/memory` mirror** (W1-B): `paths.memory` is read into `ManifestReadout.paths` as a string
  and nothing follows the pointer.
- **#35 Fleet foundation rollout** (W1-H): `standard/pr.ts`, batch PRs, Actions secrets.
- **#5 Gate-as-code** (concept-doc first): a manifest-declared *bar* that a gate enforces. The readout
  is display-only here and must not become a gate input.
- **#8 Agent-admission compiler** (W4-O): compiling declared capabilities into enforced per-repo
  controls or rulesets.
- **Deferred deck items this must not absorb:** **#6** signed maturity attestation (the readout is not
  signed and claims no provenance), **#29** score-input ledger (persisting the *snapshot* for
  re-scoring — `manifestJson` is a derived readout, not an input archive), **#30** reproducibility
  certificate, **#2** open benchmark corpus (no public/cross-tenant capability aggregate).
- **Practice starters** (`src/lib/practice-artifact.ts` `buildArtifact`) still call `commandsFor`
  directly. Threading the readout through `RepoContext` is a follow-up: the file is unclaimed this
  wave and touching it would collide with W2-J2's practice work at merge.
