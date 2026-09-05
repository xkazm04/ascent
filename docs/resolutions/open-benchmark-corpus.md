# Open benchmark corpus: snapshots, cohorts, consent, dataset, federation

_Concept doc, 2026-08-29. Deck item **#2** (concept-doc first) in the moonshot round table
(`docs/BACKLOG.md`). Merges four scout findings — 04#4 (federated corpus over persisted fleet
snapshots), 08#4 (the Register as an open versioned dataset), 10#3 (versioned corpus snapshots +
consent ledger), 11#1 (the open index + cohort read model) — into one design. Extends
[`T3-fleet-intelligence.md`](T3-fleet-intelligence.md) §0a/§0c and Direction 2, which is where
this item was first parked as "blocked"._

---

## The question

Four independent scouts arrived at the same asset from four contexts: **store the corpus instead of
recomputing it, cohort it, publish it, and let deployments outside this database contribute to it.**
Each half is cheap. Together they are a *policy* decision, not an engineering one, because three of
the four halves are irreversible in practice:

1. **Publishing a percentile publishes the rubric's biases.** D30 (the GitHub-native scoring floor,
   `docs/REFERENCE-SCAN-AUDIT.md` Part 1) is *fixed* but never *re-scan-validated*. A public dataset
   over an unvalidated corpus is worse than none: it is a citable wrong number.
2. **Consent cannot be retracted from a downloaded CSV.** Once a snapshot ships, the erase path is
   "publish a correction", not "delete a row".
3. **Federation makes us a data controller for other people's deployments.** A self-hosted AGPL
   instance pushing an envelope to Ascent Cloud is a cross-org data flow that must be defensible
   from the first line of code.

Hence a doc before a spec: the build is ~15 files, and the part needing a human is sequence + floors.

---

## Ground truth in code today

Verified against the tree at `42c7b12e`. **One merged premise is FALSE and it changes the plan.**

- **FALSE — "the corpus is contaminated; no engine or rubric filter" (10#3 claim (c), T3 §0c).**
  T3's Phase 2a **shipped**. `BENCHMARK_ELIGIBLE` (`src/lib/db/org-insights.ts:795-798`) is
  `{ engineProvider: { not: "mock" }, rubricVersion: SCORING_RUBRIC_VERSION }`, applied to both the
  `some` predicate (`:848`) and the per-repo `take: 1` (`:855`) *and* to the cohort side (`:877`,
  commented "same instrument on both sides, or the comparison means nothing"). `CORPUS_BASIS`
  (`:802`) is returned with every benchmark. So corpus hygiene is done and the blocker list is
  shorter than every finding assumed: **D30 is the only remaining precondition.**
- TRUE — no persistence. There is no `CorpusSnapshot` / `RegisterSnapshot` / `FleetSnapshot` model
  anywhere (`grep CorpusSnapshot|benchmarkSharing|corpusContribution prisma src` → 0 hits). Every
  percentile is a live read: `getOrgBenchmark` (`org-insights.ts:824`) over `BENCHMARK_CORPUS_CAP =
  5000` repos ordered by `updatedAt desc` (`:850`) — a recency *sample*, not a population, so a
  percentile printed in a Q2 board PDF cannot be re-derived in Q3.
- TRUE — cohorts are language-only (`:927-928`), floored at `COHORT_MIN = 5` peer **orgs**;
  `CORPUS_MIN = 5` floors the whole-corpus percentile (`:938`). `percentileOf` (`:817`) returns
  `null` below its `min`. `Scan.archetype`, `Scan.rubricVersion`, `Scan.engineProvider`,
  `Repository.primaryLanguage`, `Repository.stars` are all persisted; none but language is a cohort.
- TRUE — nothing public. `src/lib/register/data.ts` ranks `REGISTER_CANDIDATE_CAP = 500` (`:106`,
  `:222`) in memory per request, re-asserting `isPrivate: false` on both fetches (`:212`, `:155`);
  no JSON/CSV form, no cohort slice, no percentile. Percentiles reach only tenant surfaces
  (`portfolio.ts:101`, `briefing.ts:104-106`).
- TRUE — fleet history is derived and purgeable. `getOrgRollup` recomputes `trend` from raw `Scan`
  rows each render, clamped to `retentionCutoff(org.plan)` (`org-rollup.ts:519-543`), and
  `retention.ts` deletes scans beyond `retentionMaxScans`. `TeamStandingSnapshot`
  (`prisma/schema.prisma:1013-1028`) proves the persisted-snapshot pattern already works here.
- TRUE — `selfHosted()` (`src/lib/env.ts:73`) deployments hold one org, so `CORPUS_MIN` is never
  met and every percentile surface renders `—` permanently.
- TRUE — a consumer is already queued: **#9 intervention outcome ledger** ships
  `aggregateLift({ scope: "corpus" })` as a *pure, tested, uncalled* function
  (`docs/specs/moonshot/09-intervention-outcome-ledger.md:158-181, 215-222`) and explicitly defers
  cross-tenant aggregation to this item. **Nothing is blocked on us today**; #9 lands org-scoped.

**Dropped from the merge:** 11#1's corpus-fed landing instruments and its quarterly "State of the
AI-native index" page (marketing surfaces over the same read model, additive once it exists, and
not this doc's lane to claim); and 04#4's "signed with the deployment's key" — attestation is deck
item **#6 (deferred)**, so federation ships with a bearer token and no signature claim until then.

---

## Design options

### Option A — Snapshot only (tenant-facing), no publication, no federation

Add `CorpusSnapshot` + a nightly cron; re-point `getOrgBenchmark` / `portfolio` / `briefing` at the
dated snapshot; per-dimension percentiles; caption becomes "snapshot 2026-08-29 / rubric r10".
Nothing leaves the tenant boundary.

*Against the guardrails:* clean. G4 is strengthened — the floors move to write time. No new privacy
surface, no consent, no D30 exposure (the internal percentile already ships with the same bias).
Self-hosted stays `—`. ~6 files.

### Option B — A + public aggregate dataset (no per-repo rows), no federation

A, plus `GET /api/corpus/snapshots(.csv)` publishing the **quantile table** (cohort × metric ×
rubric × N), a `/methodology` page carrying the exclusions, the floors and a **Known biases**
section naming D30 and the config-as-code D9 ceiling, and a percentile chip on the public report /
register / scorecard sourced from that table.

*Against the guardrails:* aggregate-only, so no repo is ranked by a row we publish (a public repo's
score is already on its scorecard). G1/G9 apply — the biases section is body text, not a footnote.
**Gated on D30**: this is the first surface where a biased percentile becomes citable. 08#4's
per-repo JSONL export is the piece to *not* ship — it duplicates what the register renders while
creating a bulk-egress surface with a retraction problem.

### Option C — B + federated contributions from self-hosted deployments

C adds `Organization.benchmarkSharing = off | anonymous` (admin-gated, default off, audit row on
change), a `CorpusContribution` envelope (snapshot aggregates + cohort keys, no org identity, no
repo names), an outbound push from self-hosted instances, and a publish-side k-anonymity floor
requiring ≥ `CONTRIB_MIN_DEPLOYMENTS` distinct contributors per cohort cell before that cell is
served or published. `getOrgBenchmark` falls back to the federated cohort when the local corpus is
under floor, stamping `corpusBasis.source = "local" | "federated"`.

*Against the guardrails:* the only option that compounds with AGPL adoption and the only one that
gives a self-hosted deployment a real number. Also the only one creating a cross-org data flow and
an outbound call from a customer's own infrastructure: default off, explicit opt-in, and the
default-off lives in the *definition* of the sharing reader (the `AGENTS.md` escape-hatch
convention, inverted), never at a call site. Consent carries a documented "aggregates already
published are not retractable" clause on the erase path.

---

## Recommendation

**Ship A now. Ship B after the D30 protocol below returns a pass. Design C's schema in A's schema
pass but ship no outbound call in this round.**

Reasons, in order:

1. A is a *correctness* win independent of policy: it makes every printed percentile re-derivable,
   which is exactly what a board PDF and a diligence pack (T3 Direction 1) need, and it lifts the
   read cost off `/portfolio` and the digest cron.
2. B's whole value is external citation, and a citation of a number whose known bias is
   unvalidated is the failure mode `REFERENCE-SCAN-AUDIT.md` exists to prevent. The gate is one
   measurement, not a quarter of work.
3. C's cost is not its code, it is its irreversibility. Landing `benchmarkSharing` as a column with
   an admin toggle that does nothing but record intent (and a documented envelope shape) costs one
   migration and keeps the option open; the push can ship the round after with real contributors to
   test against. Federation with a corpus of one contributor is theatre.

Cohorts (`language | archetype | sizeBucket | techGroup | all`, each independently floored at
`COHORT_MIN`) belong in A, not B: they are the thing that makes the snapshot worth storing, and they
are tenant-visible immediately.

---

## Decisions for the owner

1. **Ship A → B → C in that order, one round apart?** (Recommend: **yes**.)
2. **Publish aggregate quantiles only, never a per-repo dataset row?** (Recommend: **yes** — kills
   08#4's JSONL export; the register already renders per-repo public scores in HTML.)
3. **Is "the corpus" the cross-tenant benchmark sample or the PUBLIC-org register?** (T3 D-T3-5,
   still open. Recommend: **the benchmark sample**, with the register defined in the methodology as
   a *view* of it, so the two cannot print different medians.)
4. **`CONTRIB_MIN_DEPLOYMENTS` floor for a federated cohort cell: 3 or 5?** (Recommend: **5**, to
   match `COHORT_MIN`; a cell below it serves `null`, never a widened cohort.)
5. **Default `benchmarkSharing` for a *cloud* tenant: `off` or `anonymous`?** (Recommend: **off**
   for both cloud and self-hosted. An opt-out corpus is a support incident.)
6. **Does the snapshot cron run under `selfHosted()`?** (Recommend: **yes, locally** — a one-org
   deployment still gets a dated fleet series out of it; only the outbound push is gated.)
7. **Rubric bump behaviour: re-baseline old snapshots or leave them?** (Recommend: **leave them**,
   partitioned by `rubricVersion`; a cross-rubric percentile is never computed, and the methodology
   page says so.)
8. **Publish the D30 result itself, pass or fail?** (Recommend: **yes** — the published limitation
   is the asset, per T3 §2c.)

---

## Preconditions

### P1 — The D30 golang-floor re-scan validation protocol (blocking for B and C; not for A)

T3 §0a states what would settle it; this is that stated as runnable steps. The baseline is
`reference-data/dump-<org>.json` (10 files, present in the tree), which holds the **pre-fix**
rollups and per-repo reports for `rust-lang, golang, astral-sh, vercel, stripe, grafana, clickhouse,
tokio-rs, cloudflare, huggingface` — 109 unique repos.

1. **Pin the instrument.** In `.env.local`: `LLM_PROVIDER=claude-cli` **or** an API provider with
   `LLM_TEMPERATURE=0` (`src/lib/llm/config.ts:93`). Note `claude-cli` has **no temperature knob**
   (T3 W1), so a claude-cli run is *not* an anchored run: prefer the API provider for the pass/fail
   call and treat a claude-cli run as a smoke pass only. Record `LLM_PROVIDER`, the model id, and
   `SCORING_RUBRIC_VERSION` (currently `r10`, `src/lib/maturity/model.ts:97`) into the run header.
2. **Freeze the rubric for the duration.** No `r10 → r11` bump may land between baseline extraction
   and the re-scan; deck item **#15** bumps to r11, so this protocol runs **before** W2-I merges or
   the whole run is re-done.
3. **Extract the baseline.** A read-only script (`scripts/d30-baseline.mjs`) walks the ten dumps and
   emits `reference-data/d30-baseline.json`: per repo `{ fullName, overall, D3, D6, D9 }` and per org
   `{ org, avgOverall, n }`. No network, no DB.
4. **Re-scan the same 109 repos.** For each `fullName`, `POST /api/scan` with
   `{ url, mock: false, fresh: true }` against a locally running server. `fresh: true` is mandatory:
   `scan-cache.ts:149` otherwise serves the persisted report and the run measures nothing. Serialize
   the loop (median ~6 min/scan, `scan-timing` memory ⇒ ~11h wall clock; chunk it across sessions,
   the output is per-repo JSON). A repo that 404s or is archived is recorded as `skipped` with the
   reason and excluded from both sides of every comparison.
5. **Compare.** `scripts/d30-compare.mjs` joins baseline to re-scan and prints, per org, ΔavgOverall
   and the per-repo ΔD3/ΔD6/ΔD9 distribution, plus the count of repos whose **level band** changed.
6. **Acceptance, both conditions required:**
   - **(a) The floor is gone.** `golang` avgOverall moves off 20 into the band of its GHA-native
     peers — concretely `avgOverall ≥ 36` (the corpus floor excluding golang, `clickhouse` 36) and
     `golang/go` D3 ≥ 35 (matching the synthetic assertion in `signals.test.ts:286-336` against a
     real repo).
   - **(b) Calibration did not drift.** The GHA-native orgs barely move: `|ΔavgOverall| ≤ 3` for
     `vercel` and `huggingface`, and ≤ 5 for every other GHA-native org. The P0 changes claim a
     byte-identical GitHub path; a larger move falsifies that claim and the whole corpus needs
     recalibrating before anything is published.
7. **Wobble control.** Any org failing (b) by ≤ 2 points is re-run once (the empirical noise band is
   `SCORE_NOISE_BAND = 2`, `src/lib/maturity/noise.ts`, n=1) before being called a failure. Deltas
   inside the band are reported as `≈`, never as movement.
8. **Record the verdict** in `docs/REFERENCE-SCAN-AUDIT.md` as a dated **Part 5** (append; never
   rewrite Parts 1–4) and in `docs/features/scanning/maturity-model.md`. A **fail** on (a) reopens
   the D30 backlog; a **fail** on (b) blocks B *and* invalidates the currently-shipping tenant
   percentile, which is a higher-severity finding than this item.

### P2 — Non-blocking but required in A's own PR

- `getOrgMovers` still partitions on strict sign (T3 W2); a snapshot that stores movers must apply
  `isWithinNoise` at write time or it freezes `+1` as a "gainer" forever.
- The register/benchmark eligibility predicate must exist in exactly **one** module before B, or the
  public and tenant numbers will disagree (T3 correction #8).

---

## Write set if accepted (Option A, with C's column)

**Schema (Director-owned, wave schema pass — builders never edit these):**

```prisma
model CorpusSnapshot {
  id            String   @id @default(uuid())
  takenAt       DateTime @default(now())
  dayKey        String   // local calendar day, matching org-rollup's localDayKey
  rubricVersion String
  cohortKind    String   // "all" | "language" | "archetype" | "size" | "techGroup"
  cohortKey     String   // "" for all
  metric        String   // "overall" | "adoption" | "rigor" | "D1".."D9"
  nOrgs         Int
  nRepos        Int
  p10 Int; p25 Int; p50 Int; p75 Int; p90 Int; mean Int
  source        String   @default("local") // "local" | "federated"
  @@unique([dayKey, rubricVersion, cohortKind, cohortKey, metric])
  @@index([rubricVersion, cohortKind, cohortKey, metric, dayKey])
}
```

plus `Organization.benchmarkSharing String? // null|"off"|"anonymous"` (C, inert in A) and
`Scan.sizeBucket String?` (`xs|s|m|l|xl` by contributor count, written at persist time). Every column
is scalar — no TEXT-JSON rule applies. The client-facing snapshot row type declares `takenAt`/`dayKey`
as `string` and gets a `wire-safe-dates.test.ts` entry.

**New files:** `src/lib/corpus/snapshot.ts` (pure `aggregateCorpus(rows, floors) → CorpusRow[]`,
client-importable, no Prisma) + `snapshot.test.ts`; `src/lib/corpus/eligibility.ts` (see handoffs);
`src/lib/db/corpus.ts` (write + dated read); `src/app/api/cron/corpus/route.ts` (retention-style
batch budget, cron-authed).

**Edited:** `src/lib/db/org-insights.ts` (`getOrgBenchmark` reads the latest snapshot ≤ asOf and
falls back to the live path when none exists, so self-hosted keeps working; `corpusBasis` gains
`snapshotDay` + `source`); `src/lib/org/briefing.ts` (caption names snapshot day + rubric);
`src/lib/org/portfolio.ts` (same basis); `src/lib/db/scans-persist.ts` (`sizeBucket`).

**Director-landed lines:** `src/lib/db/index.ts` barrel export for `src/lib/db/corpus.ts`;
`context-map.json` entry for `src/lib/corpus/**`; `scripts/docs/feature-doc-map.json` mapping
`src/lib/corpus/**` + `src/app/api/cron/corpus/**` → `docs/features/fleet/benchmark.md` (new doc).

**Docs:** new `docs/features/fleet/benchmark.md`; `docs/features/data/retention.md` gains the "the
corpus snapshot survives the scan purge" note; the T3 §0c "corpus is contaminated" paragraph is
corrected there (this doc supersedes it) rather than edited in place.

**Handoffs to other lanes:**
- **#9 (W1-E, outcomes):** no dependency in this round. When B lands, `aggregateLift({ scope:
  "corpus" })` gets its first caller through `src/lib/corpus/snapshot.ts`'s floors — the same
  `nOrgs ≥ 5` / no-private-sample rule, one implementation.
- **#34 (W2-J1, exemplar diff):** needs the eligibility + cohort predicate as an importable module,
  not a private const in `org-insights.ts`. A extracts `BENCHMARK_ELIGIBLE` / `COHORT_MIN` /
  `CORPUS_BASIS` into `src/lib/corpus/eligibility.ts` and re-exports from `org-insights.ts`, so J1
  can pick a cohort-matched exemplar without duplicating the predicate. This is the one line of A
  that J1 should be told about before it starts.
- **Marketing lane:** corpus-fed landing instruments and the quarterly index page (11#1) are theirs
  once the snapshot read model exists; not claimed here.

---

## Out of scope

- **#6 Signed maturity attestation (deferred)** — the deployment-signed envelope 04#4 described.
  Federation ships with a bearer token and makes **no** signature or provenance claim until #6.
- **#7 AI Trust Center (concept-doc)** — a tenant *publishing its own* scorecard. We publish only
  aggregates in which no tenant is identifiable; the two consent models must not be merged.
- **#31 signed tenant history bundle** and **#29 score-input ledger** (both deferred) — export and
  offline re-score of a tenant's own series: adjacent, different consent story.
- **#37 data-bound deck diagrams (deferred)** — the marketing consumption of this read model.
- **T3 Direction 1 (diligence pack)** — consumes the percentile; its `benchmarkAvailable: false`
  suppression stays until B ships. Posture hysteresis (D-T3-6) and W1–W4 stay tracked in T3.
