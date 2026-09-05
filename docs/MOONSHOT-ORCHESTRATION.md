# Moonshot orchestration plan — 22 accepted L/XL items, built in parallel waves

_2026-08-29. Companion to the decision table at the end of [`BACKLOG.md`](BACKLOG.md)
(scan-sweep moonshot round). This is the **execution plan**: how the 22 accepted items become
specs, how they are grouped so parallel builders never collide, how waves are sequenced so the
cheap independent work lands first and the items needing special care land last on a settled
tree. The Director is the strongest available model (Fable 5) in the main checkout; builders are
Opus 5 subagents in isolated worktrees. Deferred (10) and concept-doc (5) items are **out of
scope** here except where noted._

> **Wave 0 is complete (2026-08-29).** The 22 specs live in `docs/specs/moonshot/`, the 5 concept
> docs in `docs/resolutions/`, and [`docs/specs/moonshot/00-INDEX.md`](specs/moonshot/00-INDEX.md)
> now **supersedes §1 and §2 below** for execution: it carries the re-derived write sets, the
> per-wave conflict resolutions (one merged `ControlObservation` model; the memory reflect route
> reassigned to W1-D; W1-D before W1-E; #33's hook moved to `scan-finalize.ts`; #16's gate step
> moved into W4-O), the merge-order constraints, the per-wave schema-pass lists, Director-owned
> lines, the handoff graph, 20 standalone defects surfaced while premise-checking, and the open
> owner questions.

## 0. Principles

1. **Spec before build, write-set before spec.** Every item gets a one-page spec (template §5)
   whose first section is its *write set* — the files and Prisma models it will touch — and a
   *must-not-touch* list. Grouping (§2) is derived from write sets, not from topic.
2. **The schema is a single-owner surface.** `prisma/schema.prisma`, `prisma/init.sql`, the PGlite
   reconcile and `src/lib/db/wire-safe-dates.test.ts` are Class B: builders never edit them. Each
   wave opens with a **schema pass** (one agent, sequential) that lands every additive model the
   wave's lanes need, so builders start against a schema that already has their tables.
3. **One lane = one worktree = one owner = one disjoint write set.** Lanes inside a wave run in
   parallel; lanes that share a file are the same lane (sequential inside it) or different waves.
   Parallel-session hazards are known here (`never-reset-hard-shared-tree`): builders work in
   `git worktree`s, commit by pathspec, never touch the main checkout.
4. **Barrels and shared surfaces are Director-owned.** `src/lib/db/index.ts`, `context-map.json`,
   `scripts/docs/feature-doc-map.json`, generated artifacts: builders *request* the line they need
   in their handoff; the Director lands it at merge.
5. **Cheap and independent first; special care last.** Waves 1–2 are foundations with no
   cross-lane dependency and low blast radius. Wave 4 holds the five items that rewrite shared
   plumbing or write into customer repos; each runs alone or paired with a provably disjoint lane,
   after everything else has settled.
6. **Every lane ships its doc.** The doc-sync rule (AGENTS.md) binds each lane: the mapped
   `docs/features/<area>/*.md` is part of the lane's write set, and the "Known gap" the lane closes
   is deleted in the same PR.
7. **The gate is the ship-loop gate, in order:** `npm run lint` → `npx vitest run` →
   `npm run build` → `npx tsc --noEmit` (after the build, never concurrently) → LOC checks
   (300 `.tsx` / 200 under `src/features/**`) → e2e when UI touched. Builders run lint/unit/tsc/LOC
   in their worktree and report honestly what they could not run; the Director runs the full
   ordered gate once per merged wave from the main checkout.

## 1. Write-set matrix

Primary write areas per accepted item (from the finding bodies; `+` = new module/table). Items that
share a row-group in §2 share files; the matrix is why.

| # | Item | Primary write set | New models |
|---|---|---|---|
| 1 | Governance evidence ledger | `src/app/api/app/webhook/route.ts`, `src/lib/github/governance-events.ts`+, `src/lib/db/governance-events.ts`+, `src/lib/alerts.ts`, `src/lib/conformance/pack.ts`, `src/lib/db/ai-changes.ts`, `src/lib/db/audit-integrity.ts`, governance tab | `GovernanceEvent` / `ControlObservation` |
| 3 | Agent-neutral work protocol | `src/lib/mcp/{tools,handlers,protocol}.ts`, `src/app/api/mcp/route.ts`, `src/lib/api-token-auth.ts`, `src/lib/org/followups.ts`, `src/lib/local/loop-lane.ts`, cockpit (`src/features/inflight/live/**`), `npx ascent work` in the distributable | `FollowupClaim` (or lease cols on `Recommendation`), `LoopRunLane.executor/claimedBy/leaseUntil` |
| 4 | Forge-neutral ingestion | `src/lib/github/source.ts`, `src/lib/scan-ingest.ts`, `src/lib/forge/**`+, `src/lib/github/host.ts`, org import/onboarding, gate/permalink URL space | `Repository.forge/externalId`, `Installation` |
| 8 | Agent-admission compiler | `src/lib/org/stance.ts`, `src/lib/org/admission.ts`+ (`compileStance`), `src/lib/scoring/gate.ts`, `src/app/api/gate/[owner]/[repo]/route.ts`, `src/lib/mcp/handlers.ts` (`get_ai_stance`), `src/lib/github/rulesets-write.ts`+, Governance Perimeter UI | `RepoAdmission` |
| 9 | Intervention outcome ledger | `src/lib/db/outcomes.ts`+, `src/lib/outcomes/aggregate.ts`+, write hooks in `src/lib/db/improvement.ts`, `src/lib/org/skill-outcomes*.ts`, `src/lib/report/compare.ts` (`reconcileDoneRec`), `src/lib/db/sandbox-scenario.ts`; read side `src/components/report/roadmapPriority.tsx`, `src/lib/report/llm-markdown.ts` | `InterventionOutcome` |
| 10 | Two-speed fleet queue + probe lane | `src/app/api/cron/rescan/route.ts`, `src/app/api/org/scan/route.ts`, `src/lib/db/org-watch.ts`, `src/lib/pool.ts`, `src/lib/db/scan-jobs.ts`+, `src/lib/scan/probe.ts`+, webhook enqueue, Repositories tab freshness | `ScanJob` |
| 11 | Unified LLM meter | `src/lib/db/usage.ts`, `src/lib/db/usage-events.ts`+, `src/lib/entitlement.ts`, LLM seam `meter()` (`src/lib/llm/**`), `src/lib/athena/turn.ts`, `src/lib/memory/consolidation-engine.ts`, `src/lib/org/briefing-narrative.ts`, `/usage` page + CSV, `src/lib/plans.ts` lane allowances | `UsageEvent` |
| 13 | Manifest-as-scan-input | `src/lib/standard/read.ts`+, `src/lib/standard/manifest.ts`, `src/lib/github/source.ts` (fetch list), `src/lib/analyze/index.ts` (aiStandard readout), scan persist `manifestJson`, `src/lib/onboarding/{tracks,skill}.ts`, Passports capability matrix | `Scan.manifestJson` |
| 14 | `.ai/memory` mirror | `src/lib/github/source.ts` (fetch list), `src/lib/standard/memory-read.ts`+, `src/lib/memory/scan-feed.ts` (new source), `src/lib/memory/memory-kinds.ts`, Memory tab, `src/lib/db/skill-history.ts` join | `RepoMemoryMirror` |
| 15 | Guidance arbiter / graph | `src/lib/analyze/guidance-graph.ts`+, `src/lib/analyze/index.ts` (D1), `src/lib/analyze/context-health.ts`, `src/lib/scoring/claims.ts`, rubric bump, `src/lib/standard/{manifest,maintain,doctor}.ts` (guidance block, `project`, drift check), practice starter | `Scan.guidanceGraph` (display-only) |
| 16 | Doctor per-check ledger | `src/lib/standard/{doctor,types,spec,wiring}.ts`, `src/app/api/report/conformance/route.ts`, `src/lib/db/org-watch.ts` (`recordConformance`), control matrix UI, `src/lib/alerts.ts` (control-failed), gate `requireChecks` | `ConformanceReport`, `ConformanceFinding` |
| 17 | Work-time registry over MCP | `src/lib/mcp/{tools,handlers}.ts`, `src/app/api/mcp/route.ts` (plan gate, write scope), `src/lib/memory/recall.ts`, `src/lib/registry/catalog.ts` read, Athena grounding | `OrgMemoryCitation`, `OrgSkillEvent.type += invoke` |
| 18 | Standards conformance ledger | `src/lib/registry/{index-walk,index-registry}.ts`, `src/lib/org/registry-view.ts`, scan reads `.ai/registry-map.json`, Registry tab, signals writer via `openDraftPr` | `OrgKnowledgeSubject`, `RepoConformance`, `RegistrySignal` |
| 19 | Live invoke channel | `src/lib/registry/index-registry.ts` (`aggregateUsage`), `src/lib/db/org-registry-write.ts`, `src/lib/org/skill-usage.ts`, `src/app/api/org/skills/events/route.ts`, `scripts/ascent-skills.mjs` → distributable `hooks`/`report` | `OrgSkillUsageSample`, `OrgSkillEvent.source` enum |
| 25 | Org-brief for every lane | `src/lib/org/lane-brief.ts`+, `src/lib/local/loop-lane.ts` (`runLane`, `openBatch`), lane-report parser+, `src/lib/db/playbooks.ts` stamp, memory candidate writer, cockpit outcome ledger | `LoopRunLane.briefJson` |
| 26 | One improvement ledger | `src/lib/db/improvement-events.ts`+, `src/lib/db/org-impact.ts`, `src/lib/db/org-program.ts`, `src/lib/org/briefing.ts` (proof), `src/app/api/org/loop/[id]/pr/route.ts`+, cockpit button | `ImprovementPr.source/loopLaneId` |
| 27 | Remediation economics | `src/lib/local/agent.ts` (envelope), `src/lib/local/loop-lane.ts` (record cost), `src/lib/db/loop-runs-read.ts`, `src/lib/local/lane-economics.ts`+, `src/lib/local/drive.ts`, cockpit chips | `LoopRunLane.model/costCents/…`, `LoopRun.modelPolicy` |
| 32 | Retention compaction | `src/lib/db/retention.ts`, `src/lib/db/scan-digest.ts`+, `src/lib/db/scans-read.ts` (`includeCompacted`), `src/lib/maturity/forecast.ts` tail, trend charts dashed band | `ScanDigest` |
| 33 | Practice adoption ledger | `src/lib/practices/apply.ts`, `src/lib/db/practice-adoption.ts`+, scan-persist reconcile, `src/lib/org/practice-mining.ts` (versions), `src/lib/org/playbook-apply.ts`, Practices tab strip, findings module | `PracticeAdoption`, `HousePatternVersion` |
| 34 | Exemplar diff | `src/lib/report/compare.ts` (extract set-diff helper), `src/lib/report/exemplar.ts`+, `src/app/report/compare/**`, `src/lib/db/org-insights.ts` read, `src/lib/report/llm-markdown.ts` optional section | — |
| 35 | Fleet foundation rollout | `src/app/api/report/foundation/pr-batch/route.ts`+, `src/lib/standard/pr.ts`, `src/lib/github/actions-secrets.ts`+, `src/lib/db/org-api-tokens.ts`, `src/lib/org/getting-started.ts`, wizard done phase | audit action only |
| 36 | Lessons mirror / Trace / reflect-as-PR | `src/lib/registry/index-registry.ts` (lessons parse), `src/lib/db/org-skill-lessons.ts`+, Skills tab Trace, memory ingest (`source: skill-lessons`), reflect route branch + `proposeMemoryPr` | `OrgSkillLesson` |

**Hot files** (touched by ≥3 items — these decide the grouping):
`src/lib/analyze/index.ts` (13, 14, 15) · `src/lib/github/source.ts` (4, 13, 14) ·
`src/lib/standard/{manifest,doctor}.ts` (13, 15, 16) · `src/lib/mcp/*` (3, 8, 17, 34) ·
`src/lib/local/loop-lane.ts` (3, 25, 27) · `src/lib/registry/index-registry.ts` (18, 19, 36) ·
`src/lib/alerts.ts` (1, 16) · `src/app/api/app/webhook/route.ts` (1, 10) ·
`src/lib/report/compare.ts` (9, 34) · `src/lib/db/improvement.ts` (9, 33) ·
`src/lib/org/briefing.ts` (26, 32) · `prisma/schema.prisma` (all but 34, 35).

## 2. Lanes — conflict-free groups

A lane is one Opus builder in one worktree with one write set. Items listed together in a lane are
built **sequentially by that one builder** (they share files); lanes within a wave run in
**parallel** (write sets are disjoint by construction, checked against §1 before dispatch).

### Wave 0 — Specs and concept docs (parallel, docs-only, no conflicts)

| Lane | Output |
|---|---|
| S1…S22 | One spec per accepted item under `docs/specs/moonshot/<nn>-<slug>.md` (template §5). 22 Opus agents in parallel, each given the finding body + evidence + the write-set row above, reading the code it names. Budget: ~150k tokens each. |
| C2, C5, C7, C22, C23 | The five concept docs (open corpus incl. the D30 re-scan protocol; gate-as-code; trust center; user credential lane; OTLP behaviour ledger) under `docs/resolutions/`. Same shape, ending in a decision list for the owner. They run here because they cost nothing in parallel and unblock later waves (#9/#34 want the corpus floors; #16 wants the gate block). |
| Director | Reads all 22 write sets, re-derives §1, confirms or re-cuts the lanes below, and produces the **wave-1 schema list** (every additive model, column, index, wire-safe-dates entry). |

### Wave 1 — Foundations (7 lanes in parallel, after the wave-1 schema pass)

| Lane | Items | Owner write set | Must not touch |
|---|---|---|---|
| **W1-A Standard** | 13 → 16 | `src/lib/standard/**` (incl. `wiring.ts`, `doctor.ts`, spec bump 0.3.0), `src/lib/onboarding/{tracks,skill}.ts`, `src/app/api/report/conformance/**`, `recordConformance` in `org-watch.ts` (that function only), Passports matrix + control matrix UI, `docs/features/onboarding/ai-manifest-spec.md` | `src/lib/analyze/index.ts` beyond the `aiStandard()` readout hook; `src/lib/alerts.ts` (the control-failed kind is requested from W3-M via handoff); `src/lib/github/source.ts` fetch list (requested from W1-B) |
| **W1-B Fetch + memory mirror** | 14 | `src/lib/github/source.ts` (`pickFilesToFetch` only — also adds `.ai/manifest.yaml`/`guardrails.yaml` for W1-A), `src/lib/standard/memory-read.ts`+, `src/lib/memory/scan-feed.ts`, `memory-kinds.ts`, Memory tab, `docs/features/org-knowledge/memory.md` | `analyze/index.ts` (count stays as is), `standard/manifest.ts` |
| **W1-C Meter** | 11 | `src/lib/db/usage*.ts`, `src/lib/entitlement.ts`, `src/lib/llm/**` (`meter()` chokepoint), `src/lib/athena/turn.ts`, `src/lib/memory/consolidation-engine.ts`, `src/lib/org/briefing-narrative.ts`, `/usage` page, `src/lib/plans.ts` (lane allowances, all `unlimited`), `docs/features/billing/usage.md` | `src/lib/local/agent.ts` (W2-G records lane cost; C's meter is called from there later by G) |
| **W1-D Registry** | 19 → 18 → 36 | `src/lib/registry/**`, `src/lib/db/org-registry-write.ts`, `src/lib/org/{skill-usage,registry-view}.ts`, `src/app/api/org/skills/events/**`, `scripts/ascent-skills.mjs` + distributable `hooks`/`report`, Registry/Skills tab, reflect route branch, `docs/features/org-knowledge/skills.md` | `src/lib/mcp/**` (W2-K), `src/lib/memory/recall.ts` (W2-K), `OrgSkillEvent` invoke *consumer* in MCP (W2-K) |
| **W1-E Outcomes** | 9 | `src/lib/db/outcomes.ts`+, `src/lib/outcomes/**`+, the four write hooks (`improvement.ts`, `skill-outcomes*.ts`, `compare.ts` `reconcileDoneRec` region, `sandbox-scenario.ts`), `roadmapPriority.tsx`, `llm-markdown.ts` (`expectedLift` clause), `/api/recommendations` read, `docs/features/reporting/report.md` | `compare.ts` `diffScans` set-logic (W2-J1 extracts it); `practices/apply.ts` (W2-J2) |
| **W1-F Retention** | 32 | `src/lib/db/retention.ts`, `scan-digest.ts`+, `scans-read.ts` (`includeCompacted`), `maturity/forecast.ts`, trend chart band, `docs/features/data/retention.md` | `src/lib/org/briefing.ts` (W2-G owns; F ships a read helper G calls) |
| **W1-H Foundation rollout** | 35 | `src/app/api/report/foundation/**`, `src/lib/standard/pr.ts` (that file only — W1-A owns the rest of `standard/`), `src/lib/github/actions-secrets.ts`+, `org-api-tokens.ts`, `org/getting-started.ts` + tour tasks, wizard done phase, `docs/features/onboarding/wizard.md`, `github-app.md` permission row | `standard/wiring.ts` (A) |

W1-A and W1-H both live under `src/lib/standard/`; the split is by file (`pr.ts` → H, everything
else → A) and both specs state it. If the Director judges that too fine, H runs in wave 2 instead.

### Wave 2 — Loops and knowledge (5 lanes in parallel, after the wave-2 schema pass)

| Lane | Items | Owner write set | Must not touch |
|---|---|---|---|
| **W2-G Loop lane** | 27 → 25 → 26 | `src/lib/local/**`, `src/lib/org/lane-brief.ts`+, `src/lib/db/{loop-runs-read,org-impact,org-program,improvement-events}.ts`, `src/lib/org/briefing.ts` (proof line + compaction tail read from W1-F), `src/app/api/org/loop/**`, `src/lib/db/playbooks.ts` (stamp), cockpit `src/features/inflight/live/**`, `docs/features/org-planning/*`, `local-mode/README.md` | `src/lib/mcp/**` (W2-K); lease/executor columns are in the schema pass but stay unused until W4-N |
| **W2-I Guidance** | 15 | `src/lib/analyze/{index,context-health,guidance-graph}.ts`, `src/lib/scoring/claims.ts`, rubric r11 bump + hash test, `standard/{manifest,maintain,doctor}.ts` guidance block/`project`/drift check (W1-A has landed, so this is a follow-on edit by a new owner), the 'Consolidate guidance' practice starter, `docs/features/scanning/maturity-model.md` | `practices/apply.ts` (W2-J2) — the starter is data in `practices.ts`, the apply path is J2's |
| **W2-J1 Exemplar** | 34 | `src/lib/report/{compare,exemplar}.ts`, `src/app/report/compare/**`, `ScanComparePicker`, `llm-markdown.ts` optional section, `docs/features/reporting/report.md` compare section | `src/lib/mcp/**` — hands `compare_against_exemplar` to W2-K as a handoff note |
| **W2-J2 Adoption** | 33 | `src/lib/practices/apply.ts`, `src/lib/db/practice-adoption.ts`+, scan-persist reconcile hook, `practice-mining.ts` versions, `playbook-apply.ts`, Practices tab strip, findings module, `docs/features/org-dashboard/practices.md` | `improvement.ts` (W1-E landed its hook; J2 only *reads* merged rows) |
| **W2-K MCP registry** | 17 | `src/lib/mcp/**`, `src/app/api/mcp/route.ts`, `src/lib/memory/recall.ts` (citation term), Athena grounding tool exposure, plus the handoffs from J1 (`compare_against_exemplar`) and D (`invoke` events), `docs/features/org-knowledge/skills.md` MCP section, `companion/README.md` | `followups.ts`, `loop-lane.ts` (W4-N) |

### Wave 3 — Fleet plumbing (2 lanes, sequential inside the wave)

| Lane | Items | Note |
|---|---|---|
| **W3-L Scan queue + probe** | 10 | Rewrites the cron worker, `/api/org/scan`, `org-watch.ts` claims, `pool.ts`; adds the probe runner and the webhook *enqueue* for the five new events. Runs **alone** — it touches the billing cut-over (reserve/refund) and must land in one release. |
| **W3-M Evidence ledger** | 1 (+ the control-failed alert kind W1-A requested) | Starts only after L merged: the webhook route now has the event fan-in, the probe lane writes `ControlObservation`s. Adds normalizers, hash chain, as-of-merge pack rows, `AlertEvent.kind = control`, digest block, governance tab timeline, verify endpoint. Single owner; `src/lib/alerts.ts` and `conformance/pack.ts` are its alone. |

### Wave 4 — Special care (sequential, one owner each, Director reviews every diff)

| Lane | Item | Why last | Precondition |
|---|---|---|---|
| **W4-N Work protocol** | 3 | Adds an authenticated write path and leases to the ledger; the same claim path must serve the local engine and remote agents or races follow. | W2-G (loop lane settled), W2-K (MCP door has write scopes + plan gate). |
| **W4-O Admission compiler** | 8 | Writes rulesets/CODEOWNERS proposals into customer repos and changes gate verdicts per repo. Proposal-not-mutation, dry-run diff first, fail-open rule from the provenance gate. | W3-M (control ledger gives it observed state), W4-N (MCP `get_ai_stance` shape settled). Reads the C5 gate-as-code concept doc so the per-repo override and the manifest bar do not fork. |
| **W4-P Multi-forge** | 4 | The only item that rewrites `github/source.ts` and `scan-ingest.ts` wholesale; the GitHub adapter extraction must be byte-identical against a tree nobody else is editing. Highest effort (9) on the deck. | Everything above merged; a green full gate on `master`; the reference scan (`docs/REFERENCE-SCAN-AUDIT.md` cohort) re-run against the extracted GitHub adapter as the equality proof before any second forge is started. |

Order inside wave 4 is N → O → P. Each is a separate branch, separate review, separate merge.

## 3. Wave protocol (the Director's loop)

For every wave:

1. **Schema pass** (one Opus agent, main-checkout-adjacent worktree, sequential): every additive
   model/column/index the wave's lanes declared in their specs; `init.sql`; PGlite reconcile;
   `wire-safe-dates.test.ts` entries; `db/index.ts` barrel lines. Gate: full ordered gate. Merge to
   the integration branch `moonshot/wave-<n>` before any lane starts.
2. **Dispatch** the wave's lanes in one message, each with `isolation: "worktree"`, its spec, the
   §2 write set + must-not-touch list, the repo law block from `.claude/perfect/config.md`
   (Class B/C, brand, 300/200-LOC, doc-sync), and the builder gate. Builders: Opus 5. Each returns
   a handoff (§6), never a merge.
3. **Review** each handoff in the main checkout: diff against the write set (any file outside it
   is a redo, not a merge), the brand check for UI, the doc-sync delete-the-known-gap check, and
   the fail-before evidence for any test that guards the change.
4. **Merge** lane branches into `moonshot/wave-<n>` one at a time (they are disjoint, so this is
   fast-forward-ish); land the Director-owned surfaces (barrels, `context-map.json` `filePaths`
   updates for new modules, `feature-doc-map.json` globs for any new source directory).
5. **Full gate** on the integration branch in the ordered ship-loop shape; e2e when UI moved;
   the Dana briefing journey (`M1`) re-run whenever `briefing.ts` or the PDF changed (W1-F, W2-G).
6. **Smoke** the live app from the main checkout (`/perfect` smoke rules: probe the dev port for
   an "Ascent" title; PGlite seed if empty). Then merge `moonshot/wave-<n>` → `master`.
7. **Record**: one line per lane in `.claude/ship-loop/journal.md`, the coverage ledger untouched
   (this is a build, not a sweep), and the BACKLOG decision table rows flipped to
   `shipped (<sha>)` — a shipped moonshot item is still `shipped-unverified` until its UAT
   Character journey certifies it.

A lane that grows past its write set mid-build is **demoted, not forced**: the builder stops,
reports the extra file, and the Director either widens the set (if provably still disjoint) or
splits the remainder into the next wave.

## 4. Sequencing at a glance

```
Wave 0  specs ×22 ∥ concept docs ×5                      docs only        ~1 session
Wave 1  schema-1 → A ∥ B ∥ C ∥ D ∥ E ∥ F ∥ H            7 lanes          ~1–2 sessions
Wave 2  schema-2 → G ∥ I ∥ J1 ∥ J2 ∥ K                  5 lanes          ~1–2 sessions
Wave 3  schema-3 → L  then  M                           2 lanes, serial  ~1 session
Wave 4  N  then  O  then  P                             1 lane at a time ~3 sessions
```

Rough budget: specs ~150k tokens each; W1/W2 lanes 400–900k each (D and G are the largest, each
carrying three items); W3–W4 lanes 800k–1.5M each with Director review time dominating.
Items 25/26/27 (loop) and 18/19/36 (registry) are three items per lane by design — sharing a
builder is cheaper than serializing three builders on the same files.

## 5. Spec template — `docs/specs/moonshot/<nn>-<slug>.md`

```markdown
# <nn> — <title>                     size · effort/impact/risk · gate · lane · wave

## Write set (authoritative — the Director diffs the PR against this list)
- files to edit: …            - files to create: …
- Prisma models/columns needed (landed by the schema pass, not by this lane): …
- Director-owned lines requested at merge (barrel exports, context-map filePaths, doc-map globs): …
- MUST NOT TOUCH: …           - handoffs to other lanes: …

## Goal (2 sentences) and the Known gap(s) this deletes from docs/features/**

## Behaviour
- data model (fields, keys, idempotency, honest-null rules)
- routes / modules / pure functions, with signatures
- UI surfaces (which tab, which primitives from @/components/ui, brand tokens)
- self-hosted behaviour · plan gates · privacy floors (CHAMPION_MIN_POP) · audit rows

## Build order (the finding's Flow, refined against the code)

## Tests
- unit (vitest paths); the fail-before each guard must reproduce
- structural guards touched (id-routes-gated, wire-safe-dates, doc-sync)
- e2e / UAT Character journey to re-run

## Gate + done criteria · Out of scope (explicitly, incl. deferred deck items it must not absorb)
```

## 6. Builder handoff (what a lane returns)

Branch name; commit list (pathspec commits, `feat(<context>): <title>`); the write-set diff
(files touched, with any file outside the set flagged in the first line); gates run and their
exit codes, gates *not* run and why; fail-before evidence for guards; the doc updated and the
known gap deleted; Director-owned lines requested; open questions. No merges, no pushes to
`master`, no edits to Class B/C files.

## 7. Risks and the rule that answers each

| Risk | Rule |
|---|---|
| Two lanes edit one file after all | §1 hot-file list is re-derived from the *specs* (not the findings) before dispatch; any overlap re-cuts the lane. |
| Schema drift between lanes | Single schema pass per wave; builders never touch `schema.prisma`; PGlite reconcile self-repairs nullable columns (`pglite-techstack-drift`). |
| A whole-tree gate red for a foreign reason | Builders compare failing paths to their own write set before claiming green or red; the Director's full gate runs on the merged integration branch only. |
| Build passes tsc/tests but fails `next build` | The build is in the ordered gate (`build-not-in-gate` memory); the pure-module + `-load.ts` sibling pattern is the fix. |
| An accepted item silently absorbs a deferred one | Each spec's Out-of-scope names the adjacent deferred items (#6, #12, #20, #21, #24, #28–31, #37). |
| Customer-repo writes (W1-H secrets, W4-O rulesets) | Owner-confirmed, dry-run diff shown first, audited, reversible; proposal-not-mutation. |
| Honesty machinery weakened by a fast build | G1–G9 from BACKLOG.md are pasted into every spec's constraints; a diff that softens the guardband, the "—" over a fabricated zero, or D9 determinism is a redo. |

## 8. Kickoff

1. Director: `git switch -c moonshot/wave-0` from `master`; create `docs/specs/moonshot/`.
2. Dispatch the 22 spec agents + 5 concept-doc agents in one message (worktree isolation not
   needed — docs only, disjoint paths).
3. Director reviews specs → finalizes §1/§2 → writes the wave-1 schema list → runs the wave-1
   schema pass → dispatches W1-A…H.
4. Repeat §3 per wave. Wave 4 items are never dispatched while another lane is open.
