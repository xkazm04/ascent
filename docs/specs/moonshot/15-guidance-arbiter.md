# 15 — Guidance arbiter: canonical source, projections, verified contradictions, D1 coherence

size L · effort 6 / impact 8 / risk 5 · gate **contract** · lane **W2-I** · wave **2**

Merged from two scout findings: `01#5` (guidance graph + coherence facet in D1, Maturity Model &
Scoring Engine) and `03#3` (`.ai/` as canonical source with generated projections and a doctor drift
check, AI-Native Standard). One design: **the graph is the arbiter, the manifest is where the verdict
is declared, the doctor is where it is enforced in-repo.**

## Premise check against the tree (2026-08-29)

All cited premises **held**, with four corrections that change the design:

1. `src/lib/analyze/index.ts` `d1` sums presence per format (CLAUDE.md 22 · AGENTS.md 16 · Cursor 14 ·
   Copilot 14 · Windsurf 10 · Aider 10 · MCP 10 · `.claude/` 8 · prompts 8 · Continue/Cline 8 ·
   devcontainer 4 = **132 before quality**), so a four-copy repo clamps to 100 on presence alone.
   Confirmed. `guidanceQuality` grades exactly one text (`idx.content("claude.md") || "agents.md" ||
   "agent.md"`). Confirmed.
2. `CLAIM_SCORED_DIMENSIONS = ["D4"]` and `verifyClaims` exist as described — but the verifier's
   `BY_ID` map is **D4-global**, `facetPoints(id)` takes no dimension, and `isProsePath` rejects every
   `.md` path for `operational` facets. Guidance files are all markdown, so D1 facets must be
   `judgment` kind and need a **new guidance-file allowlist** rule instead of the prose rule.
3. `pickFilesToFetch` step 0 (`src/lib/github/source.ts:761-770`) fetches guidance **content** for at
   most **4** files. The graph is only ever as wide as that slice — a 5-format repo is measured on 4.
   Raising the cap is W1-B's file → handoff, not a lane edit.
4. `PRACTICES` (`src/lib/practices.ts`) is **one practice per dimension** and three callers key on
   that (`PRACTICE_BY_DIM` in `db/improvement.ts:25`, `PRACTICES.find(p => p.dimId === dimId)` in
   `db/org-insights.ts:1220`, `PLAYBOOK_TEMPLATES`). A second `dimId: "D1"` row would silently shadow
   `agent-guidance` in the first map. So the starter is a **new practice with a uniqueness guard and a
   `PRACTICE_BY_DIM` change to "first wins"**, not a bare append.

Also verified: `MANIFEST_SCHEMA_VERSION = "0.2.0"` (types.ts, pinned to the SPEC.md header by
`types.test.ts`); `SCORING_RUBRIC_VERSION = "r10"`; the doctor ships checks 1–6 (the spec's
conformance clause names 1–6, so a new check is **8** only if W1-A's #16 work took 7 — see handoffs);
`agents: []` is still a TODO in `buildManifestData`; the Context Health display-only pin
(`context-health.test.ts`) greps three files for the literal `contextHealth`, which this spec never
adds to.

## Write set (authoritative — the Director diffs the PR against this list)

**Files to edit**
- `src/lib/analyze/index.ts` — `d1` detector (presence collapse + coherence award + `facets`), the
  `facetPoints` call site.
- `src/lib/analyze/context-health.ts` — export `GUIDANCE_PATH_RE`; nothing else moves (composite stays
  display-only).
- `src/lib/scoring/claims.ts` — per-dimension facet registry, `D1_FACETS`, two-citation verify,
  `allowedPaths`, `multi` facets, `facetContract(dimension)`.
- `src/lib/scoring/prompt.ts` — interpolate one contract per claim-scored dimension.
- `src/lib/scoring/engine.ts` — pass the graph's node paths as `allowedPaths`; render contradiction
  claims as zero-point evidence.
- `src/lib/llm/schema.ts`, `src/lib/llm/provider.ts` — facet enum from all claim-scored dims;
  coerce `path2`/`quote2`. *(W1-C owned `src/lib/llm/**` in wave 1 and has merged — follow-on edit,
  flagged below.)*
- `src/lib/maturity/model.ts` — `SCORING_RUBRIC_VERSION` `r10` → `r11`; D1 `criteria` rewritten.
- `src/lib/maturity/model.test.ts` — re-pin `EXPECTED_RUBRIC_HASH` with the r11 note.
- `src/lib/types.ts` — `GuidanceGraph` / `GuidanceNode` / `GuidanceEdge` / `GuidanceContradiction`,
  `ScanReport.guidanceGraph`, `LlmClaim.path2/quote2`.
- `src/lib/scan-compose.ts` — attach `report.guidanceGraph`.
- `src/lib/db/scans-persist.ts` — persist `Scan.guidanceGraphJson` + `Repository.guidanceGraphJson`.
- `src/lib/db/org-rollup.ts` — select + `parseGuidanceGraphJson` beside `contextHealthJson` (:478).
- `src/lib/practices.ts` — the `consolidate-guidance` starter (data only) + the by-dimension guard.
- `src/lib/db/improvement.ts` — **one line**: `PRACTICE_BY_DIM` becomes first-wins.
- `src/lib/standard/{types,manifest,maintain,doctor,spec}.ts` — the `guidance` block, `maintain.mjs
  project`, the projection-drift check, the spec text + version.
- `src/features/standing/repositories/context-health/ContextHealthPanel.tsx`,
  `RepositoriesTab.tsx` — mount the coherence card.
- `docs/features/scanning/maturity-model.md` (D1 detail + rubric table row),
  `docs/features/onboarding/ai-manifest-spec.md` (guidance block, check, versioning),
  `docs/features/org-dashboard/practices.md` (the new starter row).

**Files to create**
- `src/lib/analyze/guidance-graph.ts` (pure parser + coherence) · `guidance-graph.test.ts`
- `src/lib/analyze/guidance-projection.ts` (header render/parse — shared by `maintain.mjs`'s template
  and the graph's projection edges) · `guidance-projection.test.ts`
- `src/features/standing/repositories/context-health/GuidanceCoherenceCard.tsx` +
  `guidanceCoherenceModel.ts` + `guidanceCoherenceModel.test.ts` (≤200 LOC each)
- `src/lib/scoring/claims.d1.test.ts` (D1 half of the claim suite; keeps `claims.test.ts` under cap)

**Prisma (wave-2 schema pass, not this lane)**
- `Scan.guidanceGraphJson String?` — JSON `GuidanceGraph`, TEXT, nullable (pre-r11 rows are null =
  "not assessed", never 0).
- `Repository.guidanceGraphJson String?` — latest-scan cache, same shape, same nullability.
- No index needed (both are read by id/rollup joins that already exist).
- `src/lib/db/wire-safe-dates.test.ts`: add `GuidanceGraph` to the client-imported list —
  `GuidanceNode.lastCommitAt` is declared `string`, never `Date`.

**Director-owned lines requested at merge**
- `context-map.json`: add `src/lib/analyze/guidance-graph.ts`, `guidance-projection.ts` to
  "Maturity Model & Scoring Engine" `filePaths`; add the new `context-health/` components to
  "Fleet Rollups & Insights".
- `scripts/docs/feature-doc-map.json`: extend the `maturity-model.md` entry's `sourceGlobs` with
  `src/lib/analyze/guidance-*.ts`.
- `src/lib/db/index.ts`: re-export `parseGuidanceGraphJson` if the barrel pattern requires it.

**MUST NOT TOUCH** — `src/lib/practices/apply.ts` and `playbook-apply.ts` (W2-J2 owns the apply
path; this lane ships the starter as data only) · `src/lib/github/source.ts` (W1-B) ·
`src/lib/standard/pr.ts` (W1-H) · `src/lib/mcp/**` (W2-K) · `src/lib/report/compare.ts` (W2-J1) ·
`prisma/schema.prisma`, `prisma/init.sql`, `src/lib/db/index.ts`, `context-map.json`,
`feature-doc-map.json`.

**Handoffs to other lanes**
1. **W1-B (fetch list)** — raise `pickFilesToFetch` step 0 from `.slice(0, 4)` to `.slice(0, 6)` so a
   repo running Claude + Codex + Cursor + Copilot + Windsurf is arbitrated on all of its files. If
   W1-B has already merged, the Director lands the one-line change; the graph degrades honestly
   without it (unfetched nodes are `contentSampled: false` and excluded from divergence detection).
2. **W1-A (standard)** — this lane writes `src/lib/standard/{types,manifest,maintain,doctor,spec}.ts`
   *after* W1-A's #13/#16 have merged. **Spec version coordination:** W1-A bumps
   `MANIFEST_SCHEMA_VERSION` to `0.3.0` for the declared-vs-proven block. The `guidance` block is
   additive and ships in the **same 0.3.0** (both land before `master` is tagged); W2-I adds its rows
   to the 0.3.0 field table and the versioning note, and does **not** bump again. If W1-A slipped a
   wave, W2-I performs the 0.2.0 → 0.3.0 bump itself and W1-A joins it. The new doctor check is
   numbered after W1-A's last check (7 if #16 added none, 8 if it did) — read `doctor.ts` at build
   time, do not assume.
3. **W2-J2 (adoption)** — `consolidate-guidance` must appear in the Practices strip and the
   apply/apply-batch path; J2 owns those files and reads the starter from `practices.ts`.
4. **W2-K (MCP)** — optional `get_guidance_graph` tool. Not built here.

## Goal

Make Ascent the neutral referee of multi-vendor agent guidance: parse every guidance format into one
graph, nominate a canonical source, score D1 on **coherence rather than count**, and generate the
other formats as hash-stamped projections a repo's own doctor keeps in sync. *Competitive angle:
every vendor scorer favours its own format and none reads the four against each other — only a vendor
with no agent to upsell can credibly nominate the canonical source.*

**Doc statements this deletes.** `docs/features/scanning/maturity-model.md` §"D1: AI Tooling &
Conventions" currently documents pure presence-summing plus a token/substantive LLM read — replaced by
the r11 rule. `docs/features/onboarding/ai-manifest-spec.md` field table row `agents` ("vendor-neutral
registry") is today a permanent empty TODO with no writer — the guidance block gives it one, and the
spec's "no cross-file comparison" silence is replaced by the drift check. This repo is its own
counter-example: `CLAUDE.md` is one line (`@AGENTS.md`) and today's detector cannot see that.

## Behaviour

### The graph (`src/lib/analyze/guidance-graph.ts`, pure)

```ts
export type GuidanceAgent = "claude" | "agents" | "cursor" | "copilot" | "windsurf" | "aider" | "other";
export interface GuidanceNode {
  path: string; agent: GuidanceAgent; bytes: number | null;
  contentSampled: boolean;             // false when the fetch budget did not reach it
  commands: { key: string; command: string }[];  // normalized capability key -> literal command
  rules: { subject: string; polarity: "never" | "always"; quote: string }[];
  pointers: string[];                  // @refs and md links, tree-resolved
  pointerOnly: boolean;                // body is nothing but pointers (this repo's CLAUDE.md)
  lastCommitAt: string | null;         // ISO string — NEVER a Date (wire-safe-dates)
}
export interface GuidanceEdge { from: string; to: string; kind: "points-to" | "projects-from" | "duplicates" | "diverges"; detail: string }
export interface GuidanceContradiction {
  kind: "command" | "rule"; subject: string;
  a: { path: string; quote: string }; b: { path: string; quote: string };
  confidence: "deterministic" | "possible";   // "possible" = model-cited + verified
}
export interface GuidanceGraph {
  version: "1"; nodes: GuidanceNode[]; edges: GuidanceEdge[];
  canonical: string | null;            // null = ≥2 docs and no source could be nominated (honest null)
  canonicalBasis: "manifest" | "pointer" | "projection-header" | "rank" | null;
  contradictions: GuidanceContradiction[];
  coherence: number | null;            // null when 0 guidance docs — never a fabricated 0
  penalties: { reason: string; points: number; paths: string[] }[];
}
export function buildGuidanceGraph(snap: RepoSnapshot, manifest?: ManifestData | null): GuidanceGraph;
export function parseGuidanceGraphJson(raw: string | null | undefined): GuidanceGraph | null;
```

**Canonical nomination**, first match wins: (1) `.ai/manifest.yaml` `guidance.canonical`;
(2) the unique node every other node points at, where the pointing nodes are `pointerOnly`;
(3) the source named by ≥1 valid `projects-from` header; (4) nothing — `canonical: null`. Rank order
(`CLAUDE.md` → `AGENTS.md` → rules files) is used only for display, never to invent a verdict.

**Coherence** (deterministic, explainable, floor 0): `null` with no docs; `100` with exactly one doc;
otherwise 100 minus — divergent command key **25 each, cap 50** · contradictory rule pair **15 each,
cap 30** · no canonical nominated among ≥2 docs **10** · stale projection hash **10**. Every penalty
emits a `penalties[]` row naming both paths, so the number is always readable back to its evidence.
Nodes with `contentSampled: false` contribute presence only, never a penalty.

### D1 under rubric r11 (`analyze/index.ts`)

The five **instruction-document** formats (CLAUDE.md, AGENTS.md, Cursor rules, Copilot instructions,
Windsurf) stop scoring independently and become one award:

- `GUIDANCE_DOC_POINTS = 22` when ≥1 guidance document exists, regardless of which format.
- `coherenceBonus = round(18 * coherence / 100)` — 18 for a single canonical source, 18 for four
  formats that are in-sync projections, and near 0 for four drifting copies. **Never negative:** a
  contradiction withholds points, it never subtracts (G4/G5 — no new lever that lowers a score on a
  heuristic).
- Tool/config presences (`.aider.conf.yml`, MCP config, `.claude/`, `prompts/`, Continue/Cline,
  devcontainer) are unchanged — they are not competing copies of the same document.
- `guidanceQuality` grades the **canonical** node (was: the first CLAUDE.md/AGENTS.md found), so this
  repo's one-line `CLAUDE.md` is no longer what D1 reads.
- D1 emits `facets` for the claim layer: `canonical_source`, `projections_in_sync`, `guidance_quality`.

**D1 joins `CLAIM_SCORED_DIMENSIONS`.** Consequence, stated plainly: D1 loses its guardband blend
(`engine.ts` scores a claim-scored dimension as `signalScore + claimPoints`), so the model's D1 number
is recorded and ignored, and its judgment reaches the score only through verified citations. D1
becomes fully reproducible. `isContested` already returns false for claim-scored dims (`green.ts:62`).

**`D1_FACETS`** (positive-only; `judgment` kind, since guidance is markdown; ids globally unique
across dimensions):

| id | pts | citations | doc |
|---|---|---|---|
| `canonical_declared` | 8 | 1 | a guidance file names another file as the authority, in words the parser did not match |
| `projection_declared` | 6 | 1 | a generated-from header ties a vendor file to its source |
| `commands_agree` | 6 | 2 | two guidance files state the *same* build/test command — cite both |
| `contradiction` | **0** | 2 | two guidance files tell agents different things — cite both. Scores nothing; renders, persists, and feeds the practice |

`contradiction` is the reconciliation of the two findings: `01#5` wanted contradictions verified by
citation, `03#3` insisted they stay out of the score ("report as *possible*, never fail"). Both hold —
a verified contradiction is **evidence at zero points**, marked `confidence: "possible"`, and only the
deterministic penalties move the number.

### Claims layer (`scoring/claims.ts`)

`FACETS_BY_DIMENSION: Record<DimensionId, readonly FacetSpec[]>` (D4 keeps `D4_FACETS` verbatim as its
entry — r9 semantics unchanged). `FacetSpec` gains `citations?: 1 | 2` and `multi?: number` (how many
claims of this facet survive the seen-set; `contradiction` allows 4). `facetPoints(dim, id)` and
`facetSpec(dim, id)` take the dimension. `facetContract(dimension)` builds one contract per
claim-scored dimension; `prompt.ts` interpolates all of them.
`verifyClaims(claims, snap, dimension, opts?: { allowedPaths?: ReadonlySet<string> })` — new rejection
reasons `not-guidance-file` (path outside `allowedPaths`) and `missing-second-citation`. The engine
passes the graph's node paths as `allowedPaths` for D1, so the model cannot cite a random markdown
file as guidance. Every existing D4 rejection reason and rule is preserved.

### The standard (follow-on edits after W1-A)

`ManifestData.guidance?: { canonical: string; projections: { agent: string; path: string;
generatedFrom: string; hash: string }[] }`, serialized as a YAML block the doctor's regex reader can
parse; `agents[]` is filled from the projections (one `{ id, kind, entrypoint }` per vendor format
found), which retires the standing TODO.

`maintain.mjs project` — renders each declared projection from the canonical file: the canonical body
verbatim, under a header `<!-- generated-from: <path> <sha256:12> · body: <sha256:12> · do not edit;
run: node .ai/maintain.mjs project -->` (Cursor `.mdc` gets its `---` frontmatter first). Zero-dep
(`node:crypto`). Writes the manifest's `hash` back.

Doctor **projection-drift check** (number resolved at build time): for each declared projection —
missing file → `fail`; `generated-from` hash ≠ current canonical hash → `warn` ("stale projection —
run `node .ai/maintain.mjs project`"); `body` hash ≠ the file's own body hash → `fail` (hand-edited);
a guidance file present in the repo but absent from `projections` and not the canonical → `warn`; no
`guidance` block at all → `unchecked` (a repo that has not adopted the block is not failing it).

### Surfaces, gates, floors

- **Repositories tab → Context Health** gains `GuidanceCoherenceCard`: the coherence number (or "not
  assessed"), the canonical file with its basis, a projection in-sync/stale chip per vendor format, and
  each contradiction as two quoted lines with both paths. `Tile`/`Badge`/`Meter` from
  `@/components/ui`; `scoreHex` for the coherence value; `—` for `null`, never `0`.
- **Fleet count** "N repos with contradicting agent guidance" from `org-rollup.ts`, computed off the
  cached `Repository.guidanceGraphJson`; a repo with a null graph is excluded from the denominator and
  the label says so.
- **No plan gate, no new privacy surface.** The graph is per-repo and rendered only inside the org
  dashboard; nothing aggregate-public, so `CHAMPION_MIN_POP` does not apply. `selfHosted()` changes
  nothing here. No audit rows: this lane writes nothing into a customer repo (the projection PR is
  W2-J2's apply path, which already audits).
- Quotes persisted in `contradictions[]` are capped at `CLAIM_QUOTE_MAX` (200) — the same bound the
  claim verifier enforces, so no guidance body is ever mirrored wholesale into the DB.

## Build order

1. **`guidance-graph.ts` + `guidance-projection.ts` + tests.** Pure parser, canonical nomination,
   deterministic contradiction rules, coherence with `penalties[]`. Landable alone; nothing reads it.
2. **Types + persistence.** `GuidanceGraph` in `types.ts`, `report.guidanceGraph` in `scan-compose.ts`
   (memoized on the snapshot, computed once and shared with the detector), `scans-persist.ts` writes
   both columns, `parseGuidanceGraphJson` guards a malformed blob. Still display-only at this step.
3. **Claims generalization.** Per-dimension registry, `citations: 2`, `multi`, `allowedPaths`,
   `facetContract(dimension)`, `prompt.ts`, `llm/schema.ts` + `llm/provider.ts` coercion. D4 behaviour
   byte-identical — the r9 suite is the proof.
4. **D1 rewrite + rubric bump.** Presence collapse, coherence bonus, canonical-node quality grading,
   `facets`, `D1` into `CLAIM_SCORED_DIMENSIONS`, `SCORING_RUBRIC_VERSION = "r11"`, D1 `criteria`
   rewritten, `EXPECTED_RUBRIC_HASH` re-pinned with the r11 note, rubric table row added.
5. **UI.** `GuidanceCoherenceCard` + model + mount in `ContextHealthPanel`; `org-rollup.ts` fleet count.
6. **Standard: manifest block.** `ManifestData.guidance`, serializer, `agents[]` fill, `spec.ts` text,
   `MANIFEST_SCHEMA_VERSION` coordination with W1-A, `types.test.ts` re-pin.
7. **Standard: `maintain.mjs project` + the doctor drift check.** Header render/parse shared with
   step 1's module (the script is authored without backticks — keep it that way).
8. **Practice + docs.** `consolidate-guidance` starter in `practices.ts`, the by-dimension first-wins
   fix in `improvement.ts`, `maturity-model.md`, `ai-manifest-spec.md`, `practices.md`.

## Tests

**Unit (vitest)**
- `src/lib/analyze/guidance-graph.test.ts` (new): pointer-only canonical (this repo's `CLAUDE.md` →
  `AGENTS.md`); four drifting copies → coherence ≤ 40 with named penalties; four in-sync projections →
  100; one doc → 100; zero docs → `null` (**fail-before:** any implementation returning 0 here fails,
  because 0 is a fabricated verdict); an unfetched node never creates a penalty.
- `src/lib/analyze/guidance-projection.test.ts` (new): header round-trip; a hand-edited body changes
  the body hash; a canonical edit changes the source hash.
- `src/lib/analyze/signals.test.ts` (extend): **fail-before** — a repo with CLAUDE.md + AGENTS.md +
  `.cursorrules` + copilot-instructions whose contents contradict must score D1 **below** the same
  repo with one canonical file plus three in-sync projections. Under r10 the first scores higher; that
  inversion is the whole item.
- `src/lib/scoring/claims.test.ts` (extend) + `claims.d1.test.ts` (new): D4 verification unchanged
  (regression pin); a D1 claim citing a non-guidance markdown file → `not-guidance-file`; a
  two-citation facet with one quote → `missing-second-citation`; `contradiction` verifies, awards 0
  and appears in evidence; four contradictions survive `multi`, a fifth is `duplicate-facet`.
- `src/lib/maturity/model.test.ts`: re-pinned hash under `r11` with the note in the existing style.
- `src/lib/standard/standard.test.ts` + `types.test.ts` (extend): manifest with a `guidance` block
  round-trips through the doctor's regex reader; `MANIFEST_SCHEMA_VERSION` still equals the SPEC.md
  header; `maintain.mjs` still contains no backtick or `${`.
- `src/lib/practices.test.ts` or a new guard: **no two `PRACTICES` rows share a `dimId` in a way that
  changes `PRACTICE_BY_DIM`'s answer for D1** — the fail-before is `agent-guidance` being shadowed.
- `src/features/standing/repositories/context-health/guidanceCoherenceModel.test.ts` (new): a null
  graph renders "not assessed", never a zero bar.

**Structural guards touched**
- `src/lib/db/wire-safe-dates.test.ts` — add `GuidanceGraph` (compile-time assertion; `lastCommitAt`
  is `string`).
- `src/lib/analyze/context-health.test.ts` "stays display-only" — must still pass untouched; this lane
  adds no `contextHealth` reference to `prompt.ts` / `engine.ts` / `scan-score-input.ts`.
- `scripts/docs/__tests__/check-doc-sync.test.mjs` — every `sourceGlob` still matches a tracked file
  after the `guidance-*.ts` glob is added.
- LOC: every new `src/features/**` file ≤ 200; `ContextHealthPanel.tsx` must stay ≤ 200 after the
  mount (extract if it would not).

**e2e / UAT**
- Re-run **Sam** (staff engineer) L1/L2: the D1 evidence list must name the canonical file and each
  penalty's two paths — his automatic-trust-failure clause is exactly "a score I cannot re-trace".
- Re-run **Dana** only if the briefing PDF surfaces the fleet count (M1). It does not in this spec, so
  the Director may skip it; say so in the handoff rather than silently.

## Gate + done criteria

Ship-loop order: `npm run lint` → `npx vitest run` → `npm run build` → `npx tsc --noEmit` → LOC checks
→ e2e (UI touched). Done when: a repo with one canonical source and three in-sync projections scores
D1 strictly above the same repo with four drifting copies; the coherence card renders "—" (not 0) for
a pre-r11 scan; `node .ai/doctor.mjs` in a repo with a hand-edited projection exits with a `fail` line
naming the file; `node .ai/maintain.mjs project` is idempotent (a second run writes no diff); the r11
row is in the rubric table and `maturity-model.md`'s D1 section describes the new rule.

## Out of scope

- **#13 Manifest-as-scan-input** (W1-A) — declared-vs-proven capability conformance. This lane *reads*
  the manifest's `guidance` block if present; it does not build the manifest ingestion path.
- **#16 Doctor per-check ledger** (W1-A) — the drift check emits a finding; persisting per-check
  history fleet-wide is #16's `ConformanceFinding`, not this lane's.
- **#33 Practice adoption ledger** (W2-J2) — the apply/apply-batch path, adoption rows and post-merge
  drift for `consolidate-guidance`. This lane ships the starter as data.
- **#14 `.ai/memory` mirror** (W1-B) — memory files are not guidance nodes.
- Deferred deck items this must not absorb: **#5 gate-as-code** (a coherence bar in the CI gate stays
  a concept doc), **#29 score-input ledger** (no persisted re-score inputs here), **#30
  reproducibility certificate**, **#31 signed tenant history bundle**, **#20 Athena as registry
  curator** (no PR-proposing agent action), **#6 signed attestation** (the projection header is a hash,
  not a signature), **#2 open benchmark corpus** (coherence is never published aggregate).
- No penalty scoring, no gate failure and no alert fires on a contradiction — by design, and any diff
  that adds one is a redo (G4/G5).
