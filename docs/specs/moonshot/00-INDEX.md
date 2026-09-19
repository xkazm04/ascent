# 00 — Wave-0 consolidation index

_Director's pass over the 22 moonshot specs + 5 concept docs, 2026-08-29. Companion to
[`docs/MOONSHOT-ORCHESTRATION.md`](../../MOONSHOT-ORCHESTRATION.md). This file re-derives §1's
write-set matrix from the **specs** (not the findings), resolves every in-wave file conflict, fixes
merge order, and lists the schema-pass and Director-owned lines per wave. Where a spec and the plan
disagree, this file is authoritative and says so._

---

## 1. Spec roster

| # | Slug | Lane | Wave | Size | Gate | LOC | False/corrected premises | Design in one line |
|---|---|---|---|---|---|---|---|---|
| 1 | `01-governance-evidence-ledger` | W3-M | 3 | XL | policy | 316 | 0 false · 2 design corrections | One append-only `ControlObservation` table + per-row HMAC + a daily `ControlLedgerSeal`, feeding an as-of-merge conformance pack, a `control` alert kind and a secret-free verify endpoint. |
| 3 | `03-agent-work-protocol` | W4-N | 4 | XL | policy | 300 | 3 (executor cols absent; `curating` never written; review tier not authorizable) | Follow-ups become a pull queue any agent can claim over MCP with `followups:write`, on one compare-and-set claim path with leases; only the rescan can close a row. |
| 4 | `04-forge-neutral-ingestion` | W4-P | 4 | XL | contract | 283 | 0 false · 2 dropped (`[host]` route, write/checks adapters) | Promote `RepoSource` into a `Forge` registry wired by reference (byte-identity proof), then add GitLab with honest "not observable" nulls. |
| 8 | `08-agent-admission-compiler` | W4-O | 4 | XL | policy | 309 | 0 false · 2 refinements (tier is a symbol; `permittedModels` unbuildable) | `RepoAdmission` compiles stance + autonomy tier into a **tighten-only** gate overlay, CODEOWNERS/manifest/ruleset **proposals**, all dry-run + audited + reversible. |
| 9 | `09-intervention-outcome-ledger` | W1-E | 1 | XL | policy | 301 | 1 (`reconcileDoneRec` is pure, not a write hook) | One `InterventionOutcome` fact table written by four already-measuring loops, a k-floored pure aggregator, and an `expectedLift` basis clause or nothing. |
| 10 | `10-two-speed-fleet-queue` | W3-L | 3 | XL | contract | 327 | 0 false · 2 deviations (`scan-probe.ts` flat; second cron route) | Durable `ScanJob` queue with DB-serialized claims replaces the process-local map, plus a free GitHub-API-only probe lane writing `ControlObservation`s. |
| 11 | `11-unified-llm-meter` | W1-C | 1 | XL | policy | 304 | 4 (two seams not one; no `skill-tailor`; no scan mirror; briefing not migratable) | A `meter()` chokepoint beside `trackLlmCall` at both seams writes `UsageEvent`; `/usage` gains lane × team showback with honest nulls and no repricing. |
| 13 | `13-manifest-as-scan-input` | W1-A | 1 | L | contract | 356 | 1 false (`resolveStack` in `stack.ts`) · 2 corrections | `.ai/manifest.yaml` becomes a scan input (`ManifestReadout` → `Scan.manifestJson`), feeds generation back, and shows declared/proven/wired fleet-wide. |
| 14 | `14-ai-memory-mirror` | W1-B | 1 | XL | policy | 345 | 1 (naive fetch is unsafe → quarantine) | `.ai/memory` entries are fetched into a **quarantined** `memoryFiles` slot, mirrored to `RepoMemoryMirror`, and ingested into Org Memory at confidence 0.6. |
| 15 | `15-guidance-arbiter` | W2-I | 2 | L | contract | 346 | 4 (D4-global facets; 4-file fetch cap; one-practice-per-dim; markdown vs `operational`) | One guidance graph arbitrates every vendor format, D1 scores **coherence not count** under r11, and the doctor enforces projection drift in-repo. |
| 16 | `16-doctor-control-ledger` | W1-A | 1 | L | contract | 317 | 2 (route is 225 lines; `unchecked` already on the wire) | Doctor findings get stable check ids and persist as `ConformanceReport`/`ConformanceFinding`; a repo × control matrix replaces the audit-log trend walk. |
| 17 | `17-mcp-registry-tools` | W2-K | 2 | XL | policy | 281 | 3 (`applicability` has no producer; `invoke` was retired; subjects not mirrored) | MCP grows to 13 tools with plan gates and a `WRITE_TOOL_POLICY` write door; citations and invokes come back and raise recall without raising its ceiling. |
| 18 | `18-standards-conformance-ledger` | W1-D | 1 | XL | contract | 304 | 4 (no `title`; `openDraftPr` 409s; scan can't read the map; no manifest `stack`) | Each repo's `.ai/registry-map.json` becomes a fourth fleet instrument, read out-of-band, plus a scrubbed counts-only `signals/` contribution PR. |
| 19 | `19-skills-invoke-channel` | W1-D | 1 | L | contract | 223 | 2 (usage lane is repo-free by constitution; no `npx ascent` bin) | One event contract, two sinks: a hook-emitted `invoke` to the tenant API (may carry `repo`) and counts-only aggregates to the registry `usage/` lane. |
| 25 | `25-lane-org-brief` | W2-G | 2 | XL | contract | 320 | 2 false + 1 correction (`recallOrgMemory` absent; no category→dim map; no `declined` status) | Every lane gets the org's own standard as a provenance-stamped brief and returns `.ascent/lane-report.json` verdicts, deferrals and reviewable lesson candidates. |
| 26 | `26-one-improvement-ledger` | W2-G | 2 | L | contract | 306 | 0 false · 3 corrections (`openDraftPr` can't push; `ImprovementPr` keys; `refreshOps` is agnostic) | One union read model over practice PRs and loop lanes with two explicit bases (merged = bought, branch = in review) + an owner-gated PR-from-lane. |
| 27 | `27-remediation-economics` | W2-G | 2 | L | contract | 302 | 1 (model is already a param, not a global) | Parse the whole `claude -p` envelope, stamp one declared `costSource` per lane, and fold cost-per-verified-point per model/dimension with `n` on every cell. |
| 32 | `32-retention-compaction` | W1-F | 1 | L | contract | 314 | 0 | A purged page of scans folds into a `ScanDigest` in the same transaction that deletes it; readers serve a labelled, permalink-free compacted tail. |
| 33 | `33-practice-adoption-ledger` | W2-J2 | 2 | L | contract | 307 | 3 corrections (playbooks do mark; rollout strip exists; persist has no tree) | Adoption becomes a stateful per-repo projection (adopted/drifted/removed) against versioned house patterns, with a capped re-converge rollout. |
| 34 | `34-exemplar-diff` | W2-J1 | 2 | L | contract | 321 | 0 | Compare a repo against a named peer, the org's best, or a floored public cohort at the **evidence** level, and join the gap to a practice. |
| 35 | `35-fleet-foundation-rollout` | W1-H | 1 | L | policy | 320 | 3 corrections (`wiring.ts` shorter; six steps not five; conformance column exists) | Batch the foundation PR across just-scanned repos and provision the two report-back Actions secrets, owner-confirmed and reversible. |
| 36 | `36-lessons-trace-channel` | W1-D | 1 | L | contract | 276 | 3 (`openDraftPr` has 4 callers; `SkillGeneration` is not ambiguous; `lesson` kind is dead) | `LESSONS.md` becomes rows + an on-demand git Trace, and a reflection over registry-origin memory becomes a reviewable PR with `supersedes:` paths. |

**Concept docs** (`docs/resolutions/`, wave 0, no lane): `open-benchmark-corpus` (286) · `gate-as-code`
(314) · `ai-trust-center` (258) · `developer-credential-lane` (279) · `agent-behaviour-ledger` (263).

---

## 2. Re-derived write sets (authoritative, from each spec's own Write set)

Paths verbatim. `E` = files to edit, `C` = files to create (tests omitted where the spec lists them
under §Tests only). **W** = write-set widening requested beyond §2 of the plan.

### W1-A — #13 then #16

**#13 E:** `src/lib/standard/manifest.ts` · `src/lib/standard/index.ts` · `src/lib/onboarding/stack.ts` ·
`src/lib/onboarding/tracks.ts` · `src/lib/onboarding/skill.ts` · `src/lib/analyze/index.ts` (`aiStandard()` body only) ·
`src/lib/scan-compose.ts` · `src/lib/db/scans-persist.ts` · `src/lib/db/org-rollup.ts` ·
`src/features/standing/passports/PassportsTab.tsx` · `.../PassportsSwitcher.tsx` ·
`.../autonomy/autonomyGateBuilders.ts` · `docs/features/onboarding/ai-manifest-spec.md` ·
`docs/features/org-dashboard/org-intelligence.md`
**#13 C:** `src/lib/standard/read.ts` · `src/lib/standard/readout.ts` · `src/lib/standard/read.test.ts` ·
`src/features/standing/passports/capabilityMatrix.ts` · `.../capabilityMatrix.test.ts` ·
`.../CapabilityMatrix.tsx` · `.../CapabilityMatrixLegend.tsx`
**#13 W:** `src/lib/onboarding/stack.ts` (§2 grants only `{tracks,skill}.ts`) · `src/lib/db/scans-persist.ts`
(4 `manifestJson` lines) · `src/lib/db/org-rollup.ts` (1 row field).

**#16 E:** `src/lib/standard/doctor.ts` · `src/lib/standard/types.ts` · `src/lib/standard/spec.ts` ·
`src/lib/standard/wiring.ts` (comment only) · `src/lib/db/org-watch.ts` (`recordConformance` only) ·
`src/app/api/report/conformance/route.ts` · `src/features/standing/passports/PassportsSwitcher.tsx` ·
`.../PassportsTab.tsx` · `src/lib/scoring/gate.ts` · `src/app/api/gate/[owner]/[repo]/route.ts` ·
`docs/features/onboarding/ai-manifest-spec.md` · `docs/features/onboarding/README.md`
**#16 C:** `src/lib/standard/check-ids.ts` · `src/lib/db/org-conformance.ts` ·
`src/lib/standard/control-matrix.ts` · `src/app/api/report/conformance/matrix/route.ts` ·
`src/features/standing/passports/controls/{ControlMatrixPanel,ControlMatrixGrid,ControlCell}.tsx` ·
`.../controls/controlMatrixView.ts` · `.../controls/useControlMatrix.ts` (+ four test files)
**#16 W:** `src/lib/scoring/gate.ts` + `src/app/api/gate/[owner]/[repo]/route.ts` — **not in §2's W1-A set**;
step 8 only. See conflict W1-#5.

### W1-B — #14

**E:** `src/lib/github/source.ts` · `src/lib/local/source.ts` · `src/lib/types.ts` · `src/lib/scan.ts` ·
`src/lib/memory/scan-feed.ts` · `src/lib/org/memory-kinds.ts` · `src/lib/db/org-memory.ts` ·
`src/app/api/org/memory/route.ts` · `src/lib/db/skill-history.ts` · `src/app/org/[slug]/memory/page.tsx` ·
`src/features/shared/memory/{MemoryPanel,MemoryFilterBar,MemoryCard,MemoryTab}.tsx` · `.../MemoryTypes.ts` ·
`docs/features/org-knowledge/memory.md`
**C:** `src/lib/standard/memory-read.ts` (+ test) · `src/lib/db/repo-memory.ts` ·
`src/lib/memory/repo-memory-mirror.ts` (+ test) · `src/lib/memory/repo-memory-untrusted.test.ts` ·
`src/features/shared/memory/RepoMemoryDeadEnds.tsx` (+ test) · `src/lib/github/source-memory-pick.test.ts`
**W:** the `fetchSnapshot` **quarantine block** + 2 module constants in `source.ts` (§2 grants
`pickFilesToFetch` only) · `src/lib/types.ts` (`RepoSnapshot.memoryFiles`) · `src/lib/scan.ts` (the
`mirrorRepoMemory` hook) · `src/lib/standard/memory-read.ts` (carved out of W1-A's `standard/**`).

### W1-C — #11

**E:** `src/lib/llm/leg.ts` · `src/lib/llm/text-meter.ts` · `src/lib/llm/tool-loop.ts` ·
`src/lib/llm/text-org.ts` · `src/lib/llm/config.ts` · `src/lib/db/usage.ts` ·
`src/lib/memory/consolidation-engine.ts` · `src/app/api/org/memory/check/route.ts` ·
`src/app/api/org/memory/reflect/route.ts` · `src/lib/org/briefing-narrative.ts` · `src/lib/plans.ts` ·
`src/lib/entitlement.ts` · `src/app/api/usage/route.ts` · `src/app/usage/page.tsx` ·
`src/app/usage/usageDashboard.tsx` · `src/lib/db/kpi-metrics.ts` · `docs/features/billing/usage.md`
**C:** `src/lib/llm/meter.ts` · `src/lib/db/usage-events.ts` · `src/app/usage/usageLanePanels.tsx` (+ 2 tests)
**W:** `src/lib/llm/{schema,provider}.ts` are **NOT** in C's set (they are W2-I's follow-on) ·
`src/app/api/org/memory/{check,reflect}/route.ts` — one argument each; **reflect collides with #36**
(conflict W1-#1).

### W1-D — #19 → #18 → #36

**#19 E:** `src/lib/registry/index-registry.ts` · `src/lib/db/org-registry-write.ts` ·
`src/lib/org/skill-usage.ts` · `src/lib/org/skill-usage-load.ts` · `src/lib/db/org-skills.ts` ·
`src/app/api/org/skills/events/route.ts` · `src/lib/org/registry-view.ts` ·
`src/lib/org/skill-outcomes.ts` · `src/lib/org/skill-outcomes-load.ts` ·
`src/features/shared/skills/{SkillCard,SkillDormancyBadge}.tsx` ·
`src/features/shared/registry/{RegistryInstrumentPanel,RegistryFleetSync}.tsx` ·
`scripts/ascent-skills.mjs` · `docs/features/org-knowledge/skills.md`
**#19 C:** `src/lib/org/skill-event-source.ts` · `src/lib/registry/usage-samples.ts` ·
`src/lib/db/org-skill-usage-samples.ts` · `src/features/shared/skills/SkillInvokeChip.tsx` (+ 4 tests)
**#19 W:** `src/lib/org/skill-outcomes*.ts` — **collides with W1-E** (conflict W1-#2) ·
`docs/GOLDEN-USE-CASES.md` Phase A line (Director-owned doc line).

**#18 E:** `src/lib/registry/index-walk.ts` · `src/lib/registry/index-registry.ts` ·
`src/lib/registry/layout.ts` · `src/lib/db/org-registry-write.ts` · `src/lib/org/registry-view.ts` ·
`src/features/shared/registry/RegistryPanel.tsx` · `docs/features/org-registry/README.md`
**#18 C:** `src/lib/registry/{subjects,signals,conformance-map,conformance-read,conformance-sweep,signals-contribution,signals-pr}.ts` ·
`src/lib/db/{org-registry-subjects,org-registry-conformance,org-registry-signals}.ts` ·
`src/app/api/org/[slug]/registry/conformance/route.ts` · `.../registry/signals/route.ts` ·
`src/features/shared/registry/{RegistryConformanceMap,RegistryWeakGovernance,RegistrySignalsReadout}.tsx` ·
`.../conformanceModel.ts` (+ tests)
**#18 W:** none beyond §2 (`src/lib/registry/**` is already D's).

**#36 E:** `src/lib/registry/index-registry.ts` · `src/lib/registry/index-walk.ts` ·
`src/lib/registry/parse.ts` · `src/lib/registry/read.ts` · `src/lib/db/org-registry-mirror.ts` ·
`src/lib/db/org-registry-write.ts` · `src/lib/org/registry-view.ts` ·
`src/app/api/org/memory/reflect/route.ts` ·
`src/features/shared/skills/{SkillsTab,SkillsTabChunks,SkillCard}.tsx` ·
`docs/features/org-registry/README.md` · `docs/features/org-knowledge/skills.md`
**#36 C:** `src/lib/registry/{lessons,trace,lesson-memory,memory-pr}.ts` ·
`src/lib/db/{org-skill-lessons,org-skill-trace,org-registry-proposals}.ts` ·
`src/app/api/org/[slug]/registry/trace/route.ts` ·
`src/features/shared/skills/{SkillTracePanel,SkillTraceTimeline,SkillLessonList}.tsx` · `.../skillTrace.ts` (+ 6 tests)
**#36 W:** `src/app/api/org/memory/{check,reflect}/route.ts` — §2 gives D "reflect route branch";
**collides with W1-C** (conflict W1-#1).

### W1-E — #9

**E:** `src/lib/db/improvement.ts` (`verifyMergedPrs` only) · `src/lib/org/skill-outcomes-load.ts`
(`getOrgSkillOutcomes` only) · `src/lib/db/sandbox-scenario.ts` (`getSandboxScenario` only) ·
`src/components/report/roadmapPriority.tsx` · `src/components/report/roadmapPieces.tsx` ·
`src/components/report/RecommendationTracker.tsx` · `src/lib/report/llm-markdown.ts` ·
`src/app/api/recommendations/route.ts` · `docs/features/reporting/report.md`
**C:** `src/lib/db/outcomes.ts` · `src/lib/outcomes/index.ts` · `src/lib/outcomes/aggregate.ts` (+ test) ·
`src/lib/outcomes/expected-lift.ts` (+ test) · `src/lib/outcomes/reconcile-recs.ts` ·
`src/lib/outcomes/expected-lift-load.ts` · `src/components/report/ExpectedLiftBasis.tsx` ·
`src/components/report/roadmapPriority.measured.test.ts`
**W:** none; **narrower** than §2 — `src/lib/report/compare.ts` is explicitly **not one line** (the
`reconcileDoneRec` "write hook" premise was false), which removes E's only overlap with W2-J1.

### W1-F — #32

**E:** `src/lib/db/retention.ts` · `src/lib/db/scans-read.ts` · `src/lib/maturity/forecast.ts` ·
`src/app/api/history/route.ts` · `src/app/trends/page.tsx` ·
`src/components/report/TrendChart.tsx` · `src/components/report/DimensionTrends.tsx` ·
`docs/features/data/retention.md` (+ 5 test files)
**C:** `src/lib/db/scan-digest.ts` (+ `scan-digest.test.ts`, `scan-digest-read.test.ts`)
**W:** none. **Explicitly declined:** `src/lib/org/briefing.ts` (W2-G's), `src/lib/db/org-rollup.ts`,
`skill-outcomes.ts` — the dossier's "readable by `getOrgRollup` trend" clause is dropped.

### W1-H — #35

**E:** `src/lib/standard/pr.ts` (that file only) · `src/lib/db/org-api-tokens.ts` ·
`src/lib/org/getting-started.ts` · `src/lib/db/org-onboarding.ts` ·
`src/components/onboarding/tour/tasks.ts` · `src/components/onboarding/OnboardingScanStep.tsx` ·
`src/components/onboarding/OnboardingFlow.tsx` ·
`src/features/standing/repositories/RepositoriesTab.tsx` ·
`src/features/admin/audit/AuditLogCells.tsx` · `docs/features/onboarding/wizard.md` ·
`docs/features/github/github-app.md` · `docs/features/github/setup.md`
**C:** `src/app/api/report/foundation/pr-batch/route.ts` · `src/app/api/report/foundation/secrets/route.ts` ·
`src/lib/github/actions-secrets.ts` · `src/lib/db/org-foundation.ts` ·
`src/features/standing/repositories/FoundationRolloutPanel.tsx` ·
`src/components/onboarding/OnboardingFoundationPanel.tsx` (+ 5 tests)
**W:** `src/features/admin/audit/AuditLogCells.tsx` (3 action rows) · `docs/features/github/setup.md`
(Secrets permission row) · `src/features/standing/repositories/RepositoriesTab.tsx` (one mount line) ·
`src/lib/db/org-onboarding.ts` · `package.json` (`libsodium-wrappers` + types — **Director line**).
**Schema: none** (this lane is schema-free; hold the wave-1 pass to that).

### W2-G — #27 → #25 → #26

**#27 E:** `src/lib/local/agent.ts` · `src/lib/local/agent.test.ts` · `src/lib/local/loop-lane.ts` ·
`src/lib/local/loop-engine.ts` · `src/lib/local/drive.ts` · `src/lib/local/{drive,loop-engine}.test.ts` ·
`src/lib/local/loop-lane.release.test.ts` · `src/lib/db/loop-runs-types.ts` ·
`src/lib/db/loop-runs-write.ts` · `src/lib/db/loop-runs-read.ts` · `src/lib/db/loop-runs.ts` ·
`src/app/api/org/loop/route.ts` ·
`src/features/inflight/live/cockpit/{loopTypes.ts,LaneRail.tsx,CockpitOutcomeLedger.tsx,CockpitSetup.tsx,LiveCockpit.tsx,index.ts}` ·
`docs/features/org-planning/live.md` · `docs/features/local-mode/README.md`
**#27 C:** `src/lib/local/lane-economics.ts` (+ test) · `src/lib/local/agent-envelope.ts` ·
`src/features/inflight/live/cockpit/PriceListPanel.tsx` (+ dom test)

**#25 E:** `src/lib/local/loop-lane.ts` · `src/app/api/org/loop/propose/route.ts` ·
`src/lib/db/playbooks.ts` ·
`src/features/inflight/live/cockpit/{CockpitOutcome.tsx,CockpitInspector.tsx,LiveCockpit.tsx,loopTypes.ts,loopClient.ts,index.ts}` ·
`docs/features/org-planning/live.md` · `docs/features/local-mode/README.md` ·
`docs/features/org-followups/README.md`
**#25 C:** `src/lib/org/lane-brief.ts` · `src/lib/db/lane-brief-read.ts` · `src/lib/local/lane-report.ts` ·
`src/lib/db/lane-outcomes.ts` · `src/lib/db/loop-lessons.ts` · `src/app/api/org/loop/lessons/route.ts` ·
`src/features/inflight/live/cockpit/{CockpitLessons,CockpitVerdicts}.tsx` (+ 6 tests)

**#26 E:** `src/lib/db/org-impact.ts` · `src/lib/db/org-program.ts` · `src/lib/org/briefing.ts` ·
`src/lib/db/loop-runs-read.ts` · `src/lib/local/loop-lane.ts` · `src/lib/pdf/briefing-document.tsx` ·
`src/app/share/briefing/[token]/page.tsx` ·
`src/features/bought/executive/{BriefingProofBanner,ImpactLedger,ExecutiveTab}.tsx` ·
`src/features/inflight/live/cockpit/{CockpitInspector.tsx,loopClient.ts,loopTypes.ts}` ·
`docs/features/org-planning/plan.md` · `docs/features/org-planning/live.md`
**#26 C:** `src/lib/db/improvement-events.ts` (+ test) · `src/lib/local/loop-pr.ts` (+ test) ·
`src/app/api/org/loop/[id]/pr/route.ts` (+ test)
**#26 W (beyond §2's "cockpit + org-planning docs"):** `src/lib/pdf/briefing-document.tsx` ·
`src/app/share/briefing/[token]/page.tsx` · `src/features/bought/executive/**` (three files). **M1
(Dana's briefing journey) becomes mandatory for W2-G** because the PDF changes.

### W2-I — #15

**E:** `src/lib/analyze/index.ts` · `src/lib/analyze/context-health.ts` (export only) ·
`src/lib/scoring/claims.ts` · `src/lib/scoring/prompt.ts` · `src/lib/scoring/engine.ts` ·
`src/lib/llm/schema.ts` · `src/lib/llm/provider.ts` · `src/lib/maturity/model.ts` ·
`src/lib/maturity/model.test.ts` · `src/lib/types.ts` · `src/lib/scan-compose.ts` ·
`src/lib/db/scans-persist.ts` · `src/lib/db/org-rollup.ts` · `src/lib/practices.ts` ·
`src/lib/db/improvement.ts` (one line) ·
`src/lib/standard/{types,manifest,maintain,doctor,spec}.ts` ·
`src/features/standing/repositories/context-health/ContextHealthPanel.tsx` ·
`src/features/standing/repositories/RepositoriesTab.tsx` ·
`docs/features/scanning/maturity-model.md` · `docs/features/onboarding/ai-manifest-spec.md` ·
`docs/features/org-dashboard/practices.md`
**C:** `src/lib/analyze/guidance-graph.ts` (+ test) · `src/lib/analyze/guidance-projection.ts` (+ test) ·
`src/features/standing/repositories/context-health/GuidanceCoherenceCard.tsx` ·
`.../guidanceCoherenceModel.ts` (+ test) · `src/lib/scoring/claims.d1.test.ts`
**W:** `src/lib/llm/{schema,provider}.ts` (W1-C owned `src/lib/llm/**` in wave 1 — follow-on, see
conflict X-#3) · `src/lib/db/scans-persist.ts` (**collides with W2-J2**, conflict W2-#1) ·
`src/lib/db/improvement.ts` (one line) · `src/lib/db/org-rollup.ts` · `src/lib/types.ts`.

### W2-J1 — #34

**E:** `src/lib/report/compare.ts` (extraction only) · `src/lib/report/compare.test.ts` ·
`src/lib/report/llm-markdown.ts` · `src/app/report/compare/page.tsx` ·
`src/components/report/ScanComparePicker.tsx` (+ test) · `docs/features/reporting/report.md`
**C:** `src/lib/report/exemplar.ts` · `src/lib/report/exemplar-load.ts` ·
`src/app/report/compare/{ExemplarPanel,ExemplarPanelParts,ExemplarCopyButton}.tsx` (+ 4 tests)
**W:** `src/lib/db/org-insights.ts` — four `export` keywords. **Director decision (below): J1 instead
performs the extraction into `src/lib/corpus/eligibility.ts`, re-exported from `org-insights.ts`.**
**Schema: none.**

### W2-J2 — #33

**E:** `src/lib/practices/apply.ts` · `src/lib/org/practice-mining.ts` · `src/lib/org/playbook-apply.ts` ·
`src/lib/analyze/practice-shape.ts` · `src/lib/db/scans-persist.ts` ·
`src/lib/db/org-practice-shapes.ts` · `src/lib/org/findings.ts` ·
`src/features/shared/practices/{PracticesTab.tsx,practiceRows.ts,RegistryPractices.tsx}` ·
`docs/features/org-dashboard/practices.md`
**C:** `src/lib/db/practice-adoption.ts` · `src/lib/db/house-pattern-versions.ts` ·
`src/lib/practices/reconcile.ts` · `src/lib/practices/registry-artifact.ts` ·
`src/app/api/practices/rollout/route.ts` ·
`src/features/shared/practices/PracticeDriftStrip.tsx` · `.../practiceAdoptionRows.ts` (+ 5 tests)
**W:** `src/lib/analyze/practice-shape.ts` (§2 does not list it; W2-I must-not-touch covers
`analyze/{index,context-health,guidance-graph}.ts` only — disjoint) · `src/lib/db/scans-persist.ts`
(conflict W2-#1) · `src/lib/org/findings.ts`.

### W2-K — #17

**E:** `src/lib/mcp/tools.ts` · `src/lib/mcp/handlers.ts` · `src/app/api/mcp/route.ts` ·
`src/lib/memory/recall.ts` · `src/lib/athena/grounding.ts` ·
`src/lib/mcp/tools.test.ts` · `src/app/api/mcp/route.test.ts` · `src/lib/memory/recall.test.ts` ·
`src/lib/athena/grounding.test.ts` · `docs/features/org-knowledge/skills.md` ·
`docs/features/companion/README.md`
**C:** `src/lib/mcp/skill-match.ts` · `src/lib/mcp/write-gate.ts` · `src/lib/mcp/registry-reads.ts` ·
`src/app/api/mcp/gates.ts` · `src/lib/db/org-memory-citations.ts` (+ 4 tests)
**W:** `src/lib/athena/grounding.ts` (§2 says "Athena grounding tool exposure" — confirmed in set) ·
`docs/features/companion/README.md`.

### W3-L — #10

**E:** `src/app/api/cron/rescan/route.ts` · `src/app/api/org/scan/route.ts` ·
`src/app/api/org/import/route.ts` · `src/lib/db/org-watch.ts` · `src/lib/pool.ts` ·
`src/app/api/app/webhook/route.ts` · `src/lib/db/org-rollup.ts` · `src/lib/db/retention.ts` ·
`src/features/standing/repositories/{RepoLeaderboardRow,RepoLeaderboardParts}.tsx` ·
`src/components/org/shared/{useOrgScanButton.ts,OrgScanButton.tsx}` · `vercel.json` ·
`docs/features/fleet/rescan.md`
**C:** `src/lib/db/scan-jobs.ts` · `src/lib/db/control-observations.ts` · `src/lib/scan-probe.ts` ·
`src/lib/scan-probe-controls.ts` · `src/lib/scan-queue-worker.ts` ·
`src/app/api/cron/probe/route.ts` · `src/app/api/org/scan/queue/route.ts` (+ tests)
**W:** `src/lib/db/retention.ts` (§2 gives it to W1-F; L edits it post-merge) · `vercel.json` ·
`src/lib/db/org-rollup.ts` · `src/components/org/shared/**` · **path deviation:**
`src/lib/scan-probe.ts`, not `src/lib/scan/probe.ts` (there is no `src/lib/scan/` dir).

### W3-M — #1

**E:** `src/app/api/app/webhook/route.ts` · `src/lib/scan/probe.ts` *(read as
`src/lib/scan-probe.ts` — L's path wins)* · `src/lib/db/scans-persist.ts` · `src/lib/alerts.ts` ·
`src/lib/scan-alerts.ts` · `src/lib/db/alert-events.ts` · `src/lib/db/ai-changes.ts` ·
`src/lib/conformance/pack.ts` (+ `csv.ts`, `src/app/api/org/conformance-pack/route.ts`) ·
`src/lib/db/retention.ts` · `src/features/standing/governance/GovernancePanel.tsx` ·
`docs/features/github/github-app.md` · `docs/features/fleet/alerts.md` ·
`docs/features/org-dashboard/org-intelligence.md`
**C:** `src/lib/controls/{catalog,transitions,seal}.ts` · `src/lib/github/governance-events.ts` ·
`src/lib/db/control-observations.ts` *(L creates it — M extends)* ·
`src/app/api/org/controls/route.ts` · `src/app/api/audit/verify/route.ts` ·
`src/features/standing/governance/ControlTimelineCard.tsx` · `.../controlTimeline.ts` (+ tests)
**W:** `src/app/api/app/webhook/route.ts` + the probe file (both W3-L's; sequential post-merge) ·
`src/lib/db/scans-persist.ts` · `src/lib/db/retention.ts` · `src/lib/scan-alerts.ts` ·
`src/lib/db/ai-changes.ts` · `src/app/api/org/conformance-pack/**`.

### W4-N — #3

**E:** `src/lib/db/org-api-tokens.ts` · `src/lib/api-token-auth.ts` · `src/lib/org/followups.ts` ·
`src/lib/mcp/tools.ts` · `src/lib/mcp/handlers.ts` · `src/app/api/mcp/route.ts` ·
`src/lib/local/loop-lane.ts` · `src/app/api/org/loop/route.ts` · `src/lib/local/loop-engine.ts` ·
`src/lib/db/{loop-runs-types,loop-runs-write,loop-runs-read}.ts` ·
`src/features/inflight/live/cockpit/{loopTypes.ts,LaneRail.tsx,CockpitRunPanel.tsx}` ·
`src/components/org/followups/{FollowupChips.tsx,followupsModel.ts}` ·
`docs/features/org-followups/README.md` · `docs/features/org-knowledge/skills.md` ·
`docs/features/org-planning/live.md`
**C:** `src/lib/db/followup-claims.ts` (+ test) · `src/lib/org/followups-lease.test.ts` ·
`src/lib/mcp/handlers-write.test.ts` · `src/app/api/mcp/write-scope.test.ts` ·
`scripts/ascent-work.mjs` · `examples/ascent-work.action.yml`
**W:** `src/components/org/followups/**` · `examples/` (new top-level dir) · `scripts/ascent-work.mjs`.

### W4-O — #8

**E:** `src/lib/org/stance.ts` · `src/lib/scoring/gate.ts` ·
`src/app/api/gate/[owner]/[repo]/route.ts` · `src/lib/github/pr-gate.ts` ·
`src/lib/mcp/handlers.ts` · `src/lib/mcp/tools.ts` · `src/lib/standard/manifest.ts` ·
`src/lib/standard/types.ts` ·
`src/features/standing/governance/stance/{StancePerimeter.tsx,perimeterParts.tsx}` ·
`src/features/standing/passports/autonomy/autonomyModel.ts` ·
`docs/features/org-dashboard/org-intelligence.md` · `docs/features/scanning/gate.md`
**C:** `src/lib/org/admission.ts` · `src/lib/org/admission-artifacts.ts` ·
`src/lib/db/org-admission.ts` · `src/lib/github/admission-write.ts` ·
`src/app/api/org/admission/{route,propose/route,ruleset/route}.ts` ·
`src/features/standing/governance/stance/admission/{AdmissionColumn,AdmissionOverrideControl,ProposalDryRunModal}.tsx` ·
`.../admission/admissionRows.ts` (+ tests)
**W:** `src/lib/standard/{manifest,types}.ts` (W1-A/W2-I's file, wave 4 follow-on) ·
`src/lib/github/pr-gate.ts` · `src/features/standing/passports/autonomy/autonomyModel.ts`.

### W4-P — #4

**E:** `src/lib/github/source.ts` · `src/lib/github/host.ts` · `src/lib/scan-ingest.ts` ·
`src/lib/scan.ts` · `src/lib/local/source.ts` · `src/app/api/scan/route.ts` ·
`src/app/api/org/import/route.ts` · `src/app/api/gate/[owner]/[repo]/route.ts` ·
`src/lib/db/org-watch.ts` · `src/lib/db/scans-persist.ts` · `src/lib/integrations/otlp.ts` ·
`docs/features/github/github-app.md` · `docs/features/github/README.md` ·
`docs/features/scanning/scan.md` · `docs/features/org-dashboard/org-intelligence.md`
**C:** `src/lib/forge/types.ts` · `src/lib/forge/registry.ts` · `src/lib/forge/github.ts` ·
`src/lib/forge/gitlab/{source,merge-requests,governance,pipelines,deployments,http}.ts` ·
`src/lib/db/forge-installations.ts` · `scripts/forge/equality.mts` ·
`docs/features/github/forges.md` (+ tests) · `src/features/admin/integrations/ForgeInstallationCard.tsx`
**W:** `src/lib/integrations/otlp.ts` · `src/features/admin/integrations/**` ·
`src/features/standing/repositories/**` (forge badge) · `scripts/forge/**`.
**Precondition added by W1-B:** the `fetchSnapshot` memory quarantine must be carried into the
extracted GitHub adapter — added to P's preconditions.

---

## 3. Conflict matrix per wave

Resolutions: **(a)** reassign the edit to one lane · **(b)** serialize merge order · **(c)** move to
the next wave.

### Wave 1

| # | File | Lanes | Resolution |
|---|---|---|---|
| W1-#1 | `src/app/api/org/memory/reflect/route.ts` | **W1-C** (#11: one arg on `resolveMemoryRunner`) vs **W1-D** (#36: origin refusal + `proposePr` branch + audit) | **(a) reassign to W1-D.** D rewrites the route body; C's change is a single call-site argument that D absorbs. C requests it as a handoff line ("pass `orgSlug` into `resolveMemoryRunner`") and does **not** open the file. C keeps `.../memory/check/route.ts` outright (D never touches it). |
| W1-#2 | `src/lib/org/skill-outcomes-load.ts` (+ `skill-outcomes.ts`) | **W1-E** (#9: mirror `status:"measured"` into the ledger, in `getOrgSkillOutcomes`) vs **W1-D** (#19: `firstInvokeAt` pairing anchor; pass sample rows through) | **(b) serialize: W1-D merges before W1-E.** D's edit changes the pairing anchor's *inputs*; E's is a fire-and-forget mirror at the end of the same function. E rebases onto D. Both edits are additive and in different regions; the Director diffs the combined hunk. |
| W1-#3 | `src/lib/types.ts` | **W1-B** (`RepoSnapshot.memoryFiles`) vs **W1-A** (`ScanReport.manifest`, requested as a Director line) | **(a) reassign both to the Director.** `types.ts` is promoted to a Class-C shared surface for this programme: every lane *requests* its additive line and none opens the file. Wave-1 lines listed in §6. |
| W1-#4 | `src/lib/memory/scan-feed.ts` (the ingest door) | **W1-B** owns and generalizes (`ingestObservedMemory`); **W1-D** (#36 step 9) consumes `writeMemoryCandidate` | **(b) serialize: W1-B's step 3 lands before W1-D's last commit.** Producer/consumer, not a collision. If B slips, D holds step 9 for the wave-1 integration branch and says so in its handoff. **Name mismatch:** B calls it `ingestObservedMemory`, #36 specifies `writeMemoryCandidate` with a different signature — **Director picks `writeMemoryCandidate(input)` (the #36 shape, superset)**; B implements it and keeps `ingestObservedMemory` as an alias for its own three callers. |
| W1-#5 | `src/lib/scoring/gate.ts` + `src/app/api/gate/[owner]/[repo]/route.ts` | **W1-A** (#16 step 8 `requireChecks`) — outside §2's W1-A set; **W4-O** (#8) re-cuts `GatePolicy` in wave 4 | **(c) move #16 step 8 out of wave 1 → fold into W4-O.** Rationale: the gate-as-code concept doc says `requireChecks` must be *one field satisfying the four-place contract* in the same policy merge as #8's admission fragment. #16 still ships `detectControlRegressions()` and `loadControlMatrix()`; steps 1–7 are unaffected. W4-O's spec must read `requireChecks` before re-cutting `GatePolicy` (already noted in #16 handoff 5). |
| W1-#6 | `src/lib/github/source.ts` `pickFilesToFetch` | **W1-B** owns; **W1-A** (#13) needs manifest+guardrails; **W2-I** (#15) needs `.slice(0,4)` → `.slice(0,6)` | **(a) all in W1-B.** B lands manifest/guardrails (already in its build order step 1) **and** the `slice(0,6)` bump for #15 in the same commit, so W2-I never opens the file. Director adds the slice bump to B's dispatch brief. |
| W1-#7 | `src/features/standing/repositories/RepositoriesTab.tsx` | **W1-H** (one mount line) — no other wave-1 lane | No conflict in wave 1. Cross-wave: W2-I and W3-L also mount here; see X-#1. |
| W1-#8 | `src/lib/db/scans-persist.ts` | **W1-A** only in wave 1 (#13 `manifestJson`) | **Confirmed no wave-1 conflict.** #33 (W2-J2) is wave 2 — see W2-#1. |
| W1-#9 | `src/lib/db/retention.ts` | **W1-F** owns; #9, #11, #14, #16, #36 all request cascade lines | **(a) reassign every cascade line to the wave's schema pass** (Director decision, §5). W1-F ships only #32's own digest branches. |
| W1-#10 | `src/lib/db/org-registry-write.ts`, `index-registry.ts`, `index-walk.ts`, `registry-view.ts`, `SkillCard.tsx` | #19 / #18 / #36 — **all W1-D** | Not a conflict: one builder, sequential (#19 → #18 → #36). Each item confines itself to its own guarded block in `index-registry.ts`. |

### Wave 2

| # | File | Lanes | Resolution |
|---|---|---|---|
| W2-#1 | `src/lib/db/scans-persist.ts` | **W2-I** (#15: `guidanceGraphJson` on the `Scan.create` data block + `Repository` cache) vs **W2-J2** (#33: `reconcilePracticeAdoption` call after the create) | **(a) reassign J2's hook to `src/lib/scan-finalize.ts`** — #33 itself offers this fallback ("If the Director judges the regions too close, this hook moves to `scan-finalize.ts`"). Taken. W2-I is the sole wave-2 editor of `scans-persist.ts`. |
| W2-#2 | `src/lib/db/org-rollup.ts` | **W2-I** (#15 `parseGuidanceGraphJson`) — sole wave-2 editor | No conflict. Cross-wave with W1-A (#13 `manifest` field, wave 1) and W3-L (#10 `freshness`, wave 3): three additive row fields, three waves. Serialized by wave. |
| W2-#3 | `src/lib/report/llm-markdown.ts` | **W2-J1** (#34 optional second arg) — W1-E landed the roadmap clause in wave 1 | **(b) J1 rebases onto W1-E.** #9's handoff 4 already states it. Different regions (roadmap loop vs a new appended section). |
| W2-#4 | `src/lib/report/compare.ts` | **W2-J1** only (extraction). W1-E does **not** touch it (premise corrected) | **Confirmed clean.** J1's must-not-touch list still excludes the `reconcileDoneRec` region that W1-E imports read-only. |
| W2-#5 | `src/lib/local/loop-lane.ts`, `LiveCockpit.tsx`, `loopTypes.ts`, `loopClient.ts` | #27 / #25 / #26 — **all W2-G** | Not a conflict; sequential by one builder. **LOC hazard:** `LiveCockpit.tsx` is 195/200 and all three items add to it — the rail-switch extraction must be G's **first** commit, before #27's PriceListPanel mount. |
| W2-#6 | `src/lib/db/improvement.ts` | **W2-I** (#15: one line, `PRACTICE_BY_DIM` first-wins) vs **W2-J2** (reads only, must-not-touch) | No conflict; W2-I is the sole editor. W1-E's hook landed in wave 1 — I rebases. |
| W2-#7 | `src/lib/analyze/**` | **W2-I** owns `{index,context-health,guidance-graph}.ts`; **W2-J2** edits `practice-shape.ts` | Disjoint files — **confirmed no conflict**, but both are under a shared must-not-touch phrasing. Director's dispatch brief states the file-level split explicitly. |
| W2-#8 | `src/lib/standard/{types,manifest,maintain,doctor,spec}.ts` | **W2-I** only in wave 2 (follow-on after W1-A) | No conflict. **Spec-version rule:** W1-A bumps `MANIFEST_SCHEMA_VERSION` to `0.3.0` once (#13 or #16, whichever first); W2-I adds the `guidance` block to the **same 0.3.0** and must not bump again. |
| W2-#9 | `src/lib/db/org-insights.ts` | **W2-J1** requests four `export` keywords | **(a) Director decision (see §6):** W2-J1 performs the extraction into `src/lib/corpus/eligibility.ts` (`BENCHMARK_ELIGIBLE`, `COHORT_MIN`, `CORPUS_MIN`, `CORPUS_BASIS`) re-exported from `org-insights.ts`, per the open-corpus concept doc's handoff. J1 owns the new file; the re-export line in `org-insights.ts` is Director-landed. |
| W2-#10 | `src/lib/llm/{schema,provider}.ts` | **W2-I** (#15) — W1-C owned `src/lib/llm/**` in **wave 1** | **Confirmed: different waves, no conflict.** W1-C's set does not include `schema.ts`/`provider.ts` at all; W2-I is a clean follow-on. |
| W2-#11 | `LoopRunLane` lease/executor columns | Land in the **wave-2** schema pass (plan §2) but #3's spec says wave-4 pass | **(a) wave-2 pass lands them, unused** (plan §2 wins). W4-N consumes them; no wave-4 column is needed for `LoopRunLane`. Recorded in §5. |

### Wave 3 (L then M, serial)

| # | File / artifact | Lanes | Resolution |
|---|---|---|---|
| W3-#1 | **`model ControlObservation` — two incompatible definitions** | #10 (`control`, `state: on\|off\|unknown`, `prevState`, `transition`, `jobId`, `repoId` required) vs #1 (`controlId`, `state: pass\|fail\|unmeasurable`, `prevValue`, `actorLogin`, `occurredAt`, `scanId`, `sig`, `@@unique([deliveryId, controlId, repoFullName])`, `repoId` nullable) | **(a) the wave-3 schema pass lands ONE reconciled model** (§5). Union of both: `controlId` (#1's name), `state` ∈ `pass\|fail\|unmeasurable` (#1's vocabulary — `unknown`→`unmeasurable`), `repoId String?` + `repoFullName String` (denormalized, #1), plus #10's `transition Boolean` and `jobId String?`, plus #1's `actorLogin`, `occurredAt`, `scanId`, `sig`, `prevValue`. Control **ids** use #1's kebab-case catalogue (`branch-protection`, …); #10's snake_case vocabulary is mapped in `scan-probe-controls.ts`. Both `@@index` sets are landed. |
| W3-#2 | `src/lib/db/control-observations.ts` | #10 creates it (`recordObservations`, `latestObservations`, `listObservationsSince`); #1 also lists it as a create with a different API (`appendControlObservations`, `controlStateAt`, `listControlTimeline`, `controlCoverage`, `sealDay`, `verifySeals`) | **(b) L creates, M extends.** L ships the writer trio; M adds the reader/seal quartet in the same file after L merges. Director diffs M's PR for the absence of edits to L's three functions. |
| W3-#3 | `src/app/api/app/webhook/route.ts` | L (five branches → `enqueueProbeJob`) then M (normalizer + `GovernanceEvent` dispatch on the same branches) | **(b) serialize L → M.** Already the wave's shape; confirmed. M's spec correctly assumes L landed subscription + enqueue. |
| W3-#4 | `src/lib/scan-probe.ts` | L creates; M adds one observation-append call | **(b) serialize L → M**, and **rename**: M's spec says `src/lib/scan/probe.ts`; the tree has no `src/lib/scan/`. **`src/lib/scan-probe.ts` is the path.** |
| W3-#5 | `src/lib/db/retention.ts` | L (settled `ScanJob` 30d + `ControlObservation`) and M (both new tables under `auditDays`) | **(a) reassign to the wave-3 schema pass** (§5). Neither lane opens the file; the pass lands `ScanJob`, `ControlObservation` and `ControlLedgerSeal` purge/erase branches with M's `auditDays` floor and L's newest-row-per-(repo,control) rule. |
| W3-#6 | `src/features/standing/repositories/**` | L (freshness cell) — W1-H's mount landed in wave 1, W2-I's card in wave 2 | **(b) natural serialization by wave.** L rebases; three separate regions of `RepositoriesTab.tsx`. |

### Wave 4 (N → O → P, serial)

| # | File | Lanes | Resolution |
|---|---|---|---|
| W4-#1 | `src/lib/mcp/{tools,handlers}.ts`, `src/app/api/mcp/route.ts` | N (3 write tools + `runTool(principal)`) and O (`get_ai_stance(repo?)`) | **(b) serialize N → O.** O's edit is one tool's input schema + result; N's `WRITE_TOOL_POLICY` seam (from W2-K) is the extension point and O adds no row to it. |
| W4-#2 | `src/lib/scoring/gate.ts` + `src/app/api/gate/[owner]/[repo]/route.ts` | O (admission overlay + `forbidAiAuthorship` + `policyFromParams` fix + the deferred #16 `requireChecks`) and P (`?forge=` on the route) | **(b) serialize O → P.** P touches only the route's coordinate parsing; O owns the evaluator. P's must-not-touch already names `gate.ts`. |
| W4-#3 | `src/lib/db/org-api-tokens.ts` | N (`followups:write` scope) — W1-H added `ensureOrgApiToken` in wave 1 | **(b)** N rebases; additive, different regions. |
| W4-#4 | `src/lib/standard/{manifest,types}.ts` | O (`controls.oversight` block) — W1-A/W2-I landed 0.3.0 | **(b) serialize.** O adds `controls.oversight` as **oversight metadata, never a threshold** and does **not** bump the spec version. |
| W4-#5 | `src/lib/local/loop-lane.ts` | N (claim path cut-over) — W2-G landed #27/#25/#26 there | **(b) serialize; N rebases onto G's merged file.** N's must-not-touch already carves out `agent.ts`. |
| W4-#6 | `src/lib/github/source.ts` | P (wholesale extraction) — W1-B landed the quarantine in wave 1 | **(b)** P carries the quarantine into the extracted adapter; added to P's preconditions and its `github-parity.test.ts`. |

### Cross-wave constraints worth naming

| # | Surface | Note |
|---|---|---|
| X-#1 | `src/features/standing/repositories/RepositoriesTab.tsx` | Touched in waves 1 (H), 2 (I), 3 (L). Three additive mounts, three waves — no re-cut needed, but the Director re-reads its LOC after each wave. |
| X-#2 | `src/lib/db/org-rollup.ts` | Waves 1 (A: `manifest`), 2 (I: `guidanceGraph`), 3 (L: `freshness`). Three additive `OrgRepoRow` fields. |
| X-#3 | `src/lib/llm/**` | W1-C (wave 1) then W2-I (`schema.ts`/`provider.ts`, wave 2). Disjoint files even so. |
| X-#4 | `MANIFEST_SCHEMA_VERSION` | Bumped **once**, to `0.3.0`, by W1-A. #16, #15 and (later) gate-as-code all ride that one bump. `types.test.ts` pins it to `.ai/SPEC.md`, so a second bump is a guaranteed conflict. |
| X-#5 | `SCORING_RUBRIC_VERSION` | Bumped **once**, `r10 → r11`, by **W2-I** only. The open-corpus doc's D30 protocol must run **before** W2-I merges or the whole re-scan is void (P1 step 2). W1-A/W1-B make the dead +4 D1 manifest award *reachable* in wave 1 with **no rubric change** — W2-I records that in the r11 note. |

---

## 4. Merge-order constraints (directed)

Read "A before B (reason)". Within-lane sequences are by construction (one builder).

**Wave 1**
1. `schema-1` before **every** wave-1 lane (all seven declare models/columns).
2. **W1-B before W1-A's step 4** — `aiStandard()` cannot be re-sourced through `readManifestYaml`
   until `.ai/manifest.yaml` is in the fetch list. (A is gateable with null readouts before that.)
3. **W1-B before W1-D's last commit (#36 step 9)** — the `writeMemoryCandidate` door.
4. **W1-B before W2-I** — the `pickFilesToFetch` `slice(0,6)` bump the guidance graph needs.
5. **W1-D before W1-E** — both edit `src/lib/org/skill-outcomes-load.ts` (conflict W1-#2).
6. **W1-D before W1-C's reflect-route line** — C's line is absorbed by D's rewrite (conflict W1-#1).
7. **#19 before #18 before #36** inside W1-D — #18 rebases on #19's `aggregateUsage`; #36 adds a
   third guarded block to the same `index-registry.ts` shape.
8. **#13 before #16** inside W1-A — #13 lands the 0.3.0 spec bump #16 writes its section under.
9. **W1-F before W2-G's step 5** — G calls `forecastBasis()` and `getCompactionCoverage()` from
   `briefing.ts`; F ships both, F never edits `briefing.ts`.
10. **W1-E before W2-J1** — `llm-markdown.ts` (roadmap clause first, exemplar section second).

**Wave 2**
11. `schema-2` before every wave-2 lane.
12. **#27 before #25 before #26** inside W2-G — #25's `runLane` edits sit on #27's diff; #26 reads
    the `LaneItemOutcome` rows #25 writes.
13. **W2-J1 before W2-K step 8** — `compare_against_exemplar` is a thin wrapper over J1's
    `exemplarDiff`. If J1 slips, K stops at step 7 and the tool follows in wave 3.
14. **W1-D (#18) before W2-K step 7** — `get_governing_subject` reads `OrgKnowledgeSubject`.
    Cross-wave, already satisfied.
15. **W1-D (#19) before W2-K step 3** — `"mcp"` must be in the validated `OrgSkillEvent.source` set.
16. **W1-D (#36) before W2-K step 6** — `listSkillLessons` for `get_skill_lessons`.
17. **W1-A before W2-I's step 6/7** — the `standard/**` guidance block is a follow-on edit.
18. **W2-I before W2-J2's rollout UI** — `consolidate-guidance` must exist in `practices.ts` for J2's
    strip; J2's apply path is catalog-driven so no code change is needed, only ordering.

**Wave 3**
19. `schema-3` (the reconciled `ControlObservation`) before W3-L.
20. **W3-L before W3-M** — the whole wave's premise: webhook fan-in, `scan-probe.ts`, and
    `control-observations.ts`'s writer half.

**Wave 4**
21. **W2-G and W2-K before W4-N** (plan §2 preconditions: settled loop lane, MCP write door).
22. **W3-M and W4-N before W4-O** — O reads `controlStateAt` and inherits N's `get_ai_stance` shape.
23. **W4-O before W4-P** — P's inbound precondition is a final `gate.ts` verdict shape.
24. **W4-N before W4-O before W4-P**, each a separate branch, review and merge; a green full gate on
    `master` before P starts.

**Programme-level**
25. **The D30 re-scan protocol (open-corpus P1) before W2-I** — it requires a frozen r10.
26. **W3-M before any AI-Trust-Center work** (concept doc, not in this programme).

---

## 5. Schema pass, per wave

**Director decision, applied throughout:** every `retention.ts` erase/purge cascade line a spec
handed to W1-F is instead a **schema-pass responsibility of the wave in which that table lands**.
W1-F ships only #32's own `ScanDigest` branches. Rationale: a cascade line written a wave after its
table exists is a wave of un-erasable rows, and `retention.ts` cannot be a shared lane file.

### Wave 1

**New models**

| Model | Item | Keys / indexes |
|---|---|---|
| `InterventionOutcome` | #9 | `@@unique([orgId, kind, identityKey, beforeScanId, afterScanId])` · `@@index([orgId, kind, dimId])` · `@@index([identityKey, dimId])` · `@@index([orgId, recordedAt])`. Fields: `orgId`, `repoFullName`, `kind`, `identityKey`, `dimId String?`, `beforeScanId`, `afterScanId`, `interventionAt`, `overallDelta Int`, `dimDelta Int?`, `rubricVersion`, `engineProvider`, `gapDays Int`, `withinBound Boolean`, `isPrivateRepo Boolean`, `sourceRowId String?`, `recordedAt`, `updatedAt`. |
| `UsageEvent` | #11 | standalone (no `Organization` relation). `idemKey String? @unique` · `@@index([orgId, createdAt])` · `@@index([orgId, lane, createdAt])` · `@@index([orgId, teamKey, createdAt])`. All token/cost columns nullable Int — **never 0**. |
| `RepoMemoryMirror` | #14 | `@@unique([orgId, repoFullName, path, contentHash])` · `@@index([orgId, repoFullName])` · `@@index([orgId, mappedKind])` · `org Organization @relation(onDelete: Cascade)`. |
| `ConformanceReport` | #16 | `@@unique([orgId, repoFullName, headSha, runShape])` · `@@index([orgId, repoFullName, reportedAt])`. |
| `ConformanceFinding` | #16 | `report … onDelete: Cascade` · `@@index([reportId])` · `@@index([check])`. |
| `OrgSkillUsageSample` | #19 | `@@unique([registryId, contributor, skillName])` · `@@index([orgId, skillName])`. |
| `OrgKnowledgeSubject` | #18 | `@@unique([registryId, bundle, slug])` · `@@index([orgId, bundle])`. |
| `RepoConformanceMap` | #18 | `repositoryId @unique`. |
| `RepoConformance` | #18 | `@@unique([repositoryId, contextName, subjectSlug])` · `@@index([orgId, subjectSlug, state])`. |
| `RegistrySignal` | #18 | `@@unique([registryId, contributor, bundle, subjectSlug])`. Every count `Int?` — a missing key is `null`, not `0`. |
| `RegistrySignalContribution` | #18 | audit-shaped; no unique beyond `id`. |
| `OrgSkillLesson` | #36 | `@@unique([registryId, registryPath, entryHash])` · `@@index([orgId, skillName])` · `@@index([registryId, registryPath])`. |
| `OrgSkillTrace` | #36 | `@@unique([registryId, registryPath])` · `@@index([orgId, skillName])`. |
| `OrgMemoryProposal` | #36 | `@@unique([orgId, slug])` · `@@index([orgId, status])`. |
| `ScanDigest` | #32 | `@@unique([repoId, period, rubricVersion, engineProvider])` · `@@index([repoId, lastScannedAt])` · `repo Repository @relation`. `rubricVersion` **non-null**, `"unknown"` sentinel for legacy rows. |

**Columns added to existing models**

| Model | Columns | Item |
|---|---|---|
| `Scan` | `manifestJson String?` | #13 |
| `Repository` | `manifestJson String?` · `digests ScanDigest[]` (back-relation) | #13, #32 |
| `Organization` | `repoMemoryMirror Boolean?` (null = on) · `retentionCompact Boolean?` · `retentionDigestMonths Int?` · `repoMemoryMirror RepoMemoryMirror[]` (back-relation) | #14, #32 |
| `OrgSkillEvent` | `source String?` (now enum-valued `cli\|hook\|ci\|web\|registry\|mcp`) · `detail String?` · `sessionId String?` · `dedupeKey String?` with `@@unique([skillId, dedupeKey])` · `type` comment → `download \| sync \| invoke` (un-retire) | #19 |
| `OrgRegistry` | `subjectCount Int @default(0)` · `signalContributors Int @default(0)` · `signalsContributor String?` | #18 |

**`init.sql` / PGlite reconcile notes**
- Every new model in the `CREATE` block **and** as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for the
  additive columns (`Scan.manifestJson`, `Repository.manifestJson`, the three `Organization`
  columns, the five `OrgSkillEvent` columns, the three `OrgRegistry` columns) — nullable, so the
  boot-time reconcile self-repairs (`pglite-techstack-drift`).
- Every JSON payload is **TEXT**, never `jsonb` (DSQL/PGlite): `refsJson`, `useWhenJson`, `lawsJson`,
  `domainsJson`, `bundleDigestsJson`, `warningsJson`, `bundlesJson`, `entriesJson`,
  `memberIdsJson`, `memberPathsJson`, `enginesJson`, `dimensionsJson`.
- `dedupeKey` and `idemKey` are nullable-unique — NULLs are distinct, which is the intended
  at-least-once fallback (`Scan.dedupKey` precedent).

**`wire-safe-dates.test.ts` entries (wave 1)**
`InterventionOutcomeRow` · `UsageEventRow` · `RepoMemoryEntryRow` · `ConformanceReportRow` ·
`ControlMatrixRow` · `SkillUsageSampleRow` · `SkillLessonRow` · `SkillTraceRow` ·
`MemoryProposalRow` · `CompactedPoint` · `FoundationRolloutRow` (#35, client-imported) ·
the five #18 row types (`KnowledgeSubjectRow`, `RepoConformanceMapRow`, `RepoConformanceRow`,
`RegistrySignalRow`, `RegistrySignalContributionRow`).
**Not needed:** `ManifestReadout` (#13 — no `Date`; but add it to the guard's *reviewed* list since
it is client-imported via `OrgRepoRow`).

**`retention.ts` lines owned by the wave-1 schema pass** (not W1-F, not the lanes)
- `InterventionOutcome`: `deleteMany` where `beforeScanId`/`afterScanId` is a purged scan; org-erase by `orgId`.
- `UsageEvent`: purge aged on `Organization.retentionAuditDays` (audit-shaped, not scan-shaped); org-erase cascade.
- `RepoMemoryMirror`: org cascade is declarative; add the **explicit per-repo delete** for a repo removed from the org.
- `ConformanceReport` (+ `ConformanceFinding` by cascade): purge horizon `retentionAuditDays`.
- `OrgSkillLesson`, `OrgSkillTrace`: die with their `OrgRegistry` row — assert it, add erase-by-`orgId`.
- `OrgMemoryProposal`: org-erase by `orgId`.
- `RepoConformance`, `RepoConformanceMap`, `RegistrySignal`, `RegistrySignalContribution`,
  `OrgKnowledgeSubject`, `OrgSkillUsageSample`: org-erase by `orgId`.
- `ScanDigest`: **W1-F's own** (`pruneDigests`, `eraseRepo`, `eraseOrgData` with `compact: false`).

**Wave-1 Director lines that are not schema**
- `package.json`: `libsodium-wrappers` (dependency) + `@types/libsodium-wrappers` (dev) — **#35**.
  No stdlib path exists (`node:crypto` has X25519 but no XSalsa20/Poly1305); the module keeps
  `await sodium.ready` inside `encryptSecret` so nothing loads at import time (`build-not-in-gate`).

### Wave 2

**New models**

| Model | Item | Keys / indexes |
|---|---|---|
| `LaneItemOutcome` | #25 | `@@unique([laneId, recommendationId])` · `@@index([orgId, recommendationId])` · `@@index([runId])`. `verdict` ∈ `resolved\|skipped\|needs_human\|attempted\|absent`. Standalone (denormalized `orgId`, no FK). |
| `OrgMemoryCandidate` | #25 | `@@index([orgId, status])`. `status` ∈ `pending\|kept\|discarded`. Deliberately generic so #36's channel can reuse it. |
| `PracticeAdoption` | #33 | `@@unique([orgId, repoFullName, practiceId, artifactPath])` · `@@index([orgId, state])` · `@@index([orgId, practiceId, patternVersion])`. |
| `HousePatternVersion` | #33 | `@@unique([orgId, practiceId, version])` · `@@unique([orgId, practiceId, patternHash])` · `@@index([orgId, practiceId])`. |
| `OrgMemoryCitation` | #17 | `@@unique([memoryId, sessionId])` · `@@index([orgId, createdAt])` · `@@index([memoryId, used])`. |

**Columns added to existing models**

| Model | Columns | Item |
|---|---|---|
| `LoopRunLane` | `model String?` · `costSource String?` · `costMicros Int?` · `inputTokens Int?` · `outputTokens Int?` · `cacheReadTokens Int?` · `turns Int?` · `agentDurationMs Int?` · `agentSessionId String?` · `abPairKey String?` | #27 |
| `LoopRunLane` | `briefJson String @default("{}")` · `reportJson String @default("{}")` | #25 |
| `LoopRunLane` | `dimId String?` · `prNumber Int?` · `prUrl String?` | #26 |
| `LoopRunLane` | `executor String @default("local")` · `claimedBy String?` · `leaseUntil DateTime?` — **landed here, unused until W4-N** (plan §2; overrides #3's "wave-4 pass") | #3 |
| `LoopRun` | `modelPolicy String @default("single")` · `modelsJson String @default("[]")` (TEXT) | #27 |
| `ImprovementPr` | `source String @default("practice")` · `loopLaneId String?` + `@@index([orgId, loopLaneId])`. **`@@unique([orgId, repoFullName, practiceId])` unchanged** — loop rows use the synthetic `practiceId = "loop:<laneId>"`. | #26 |
| `Scan` | `guidanceGraphJson String?` | #15 |
| `Repository` | `guidanceGraphJson String?` | #15 |
| `OrgMemory` | `citedCount Int @default(0)` · `notUsefulCount Int @default(0)` | #17 |
| `OrgSkillEvent` | `type` comment amended (`download \| sync \| invoke`) — already landed in wave 1; no-op here | #17 |

**`init.sql` / PGlite notes:** all `LoopRunLane`/`LoopRun`/`ImprovementPr`/`Scan`/`Repository`/
`OrgMemory` additions as nullable (or defaulted) `ADD COLUMN IF NOT EXISTS`. `costMicros` is
**micro-cents** (`round(total_cost_usd * 1e8)`) so a 0.4¢ session is not rounded to zero.
`modelsJson`, `linesJson`, `exemplarsJson`, `filesJson`, `memberIdsJson` are TEXT.

**`wire-safe-dates.test.ts` (wave 2)**
`LaneOutcomeRow` · `LoopLessonRow` · `LaneBriefProvenance` · `ImprovementEvent` (`at` is `string`) ·
`PracticeAdoptionRow` · `HousePatternRow` · `MemoryCitationRow` · `GuidanceGraph`
(`GuidanceNode.lastCommitAt` is `string`) · `ExemplarProfile` · `ExemplarOption` (both
`scannedAt: string | null`).
**Not needed:** #27's lane columns (all number/string; `LoopLaneRecord` already string-typed).

**`retention.ts` lines owned by the wave-2 schema pass**
- `LaneItemOutcome`: `deleteMany` on the org-erase path (denormalized `orgId`).
- `OrgMemoryCandidate`: same.
- `OrgMemoryCitation`: **deleted BEFORE `OrgMemory`** in the erase order; included in the counted purge preview.
- `PracticeAdoption`, `HousePatternVersion`: org erase + purge cascade.

### Wave 3

**New models**

| Model | Item | Reconciled definition |
|---|---|---|
| `ScanJob` | #10 | `idempotencyKey String @unique` · `@@index([lane, state, notBefore, priority])` · `@@index([orgId, lane, state])` · `@@index([runId])` · `@@index([state, leaseUntil])` · `org Organization @relation`. `resultJson` TEXT. |
| `ControlObservation` | **#10 + #1, merged (conflict W3-#1)** | `id` · `orgId` · `repoId String?` · `repoFullName String` · `controlId String` · `state String` (`pass\|fail\|unmeasurable`) · `value String?` · `prevValue String?` · `prevState String?` · `evidenceJson String @default("{}")` (TEXT) · `source String` (`scan\|probe\|webhook\|baseline`) · `actorLogin String?` · `transition Boolean @default(false)` · `occurredAt DateTime` · `observedAt DateTime @default(now())` · `scanId String?` · `jobId String?` · `deliveryId String?` · `sig String?` · `createdAt DateTime @default(now())` · `@@unique([deliveryId, controlId, repoFullName])` · `@@index([orgId, repoFullName, controlId, occurredAt])` · `@@index([orgId, occurredAt])` · `@@index([repoId, controlId, observedAt])` · `@@index([orgId, transition, observedAt])` · `org Organization @relation`. |
| `ControlLedgerSeal` | #1 | `@@unique([orgId, day])` · `@@index([orgId, day])`. |

**Columns added:** `AiChange` += `source String @default("scan")` · `approvalObservedAt DateTime?` (#1).

**`init.sql` / PGlite:** all three models in the CREATE block; `AiChange`'s two columns as nullable
`ADD COLUMN IF NOT EXISTS` (`source` defaulted). `evidenceJson`/`resultJson` TEXT.

**`wire-safe-dates.test.ts` (wave 3):** `ScanJobRow` · `ControlObservationRow` · `ControlSealRow`.

**`retention.ts` lines owned by the wave-3 schema pass**
- `ScanJob`: purge settled rows after **30 days**; `eraseOrgData` deletes via the `withRetry` batcher.
- `ControlObservation`: purge under the org's **`auditDays`** policy (`RETENTION_MIN_AUDIT_DAYS = 7`
  floor), **always keeping the newest row per `(repoFullName, controlId)`** so current posture is
  never erased into "unmeasurable"; org erase deletes all.
- `ControlLedgerSeal`: **never purged with its rows** — a purged day keeps its seal, so a deleted
  window stays *detectable*. Deleted only on org erase.

### Wave 4

**New models**

| Model | Item | Keys |
|---|---|---|
| `RepoAdmission` | #8 | `@@unique([orgId, repoFullName])` · `@@index([orgId, mode])`. |
| `Installation` | #4 | `@@unique([orgId, forge, externalId])` · `@@index([orgId])` · `installations Installation[]` on `Organization`. `credentialRef` = `encryptSecret()` ciphertext; `capabilitiesJson` TEXT. |

**Columns added**

| Model | Columns | Item |
|---|---|---|
| `Recommendation` | `claimActor String?` · `claimExecutor String?` · `leaseUntil DateTime?` · `needsHuman Boolean @default(false)` · `@@index([status, leaseUntil])` | #3 |
| `Repository` | `forge String @default("github")` · `externalId String?` · `@@index([orgId, forge])`. **`@@unique([orgId, fullName])` is NOT changed** — a non-GitHub repo is namespaced in the value (`gitlab:group/sub/project`). | #4 |

**`wire-safe-dates.test.ts` (wave 4):** `FollowupClaimRow` · `LoopLaneRecord` (re-assert) ·
`RepoAdmissionRow` · `ForgeInstallationRow`.

**`retention.ts` lines owned by the wave-4 schema pass**
- `RepoAdmission`: org-erase cascade **and** the repo-removal purge (#8 handoff 3).
- `Installation`: org-erase; `credentialRef` ciphertext destroyed with the row.
- `Recommendation` claim columns: **no new rule** — they are columns on an existing purged model (#3).

---

## 6. Director-owned lines, per wave

Class B/C: builders **request**, the Director lands at merge. `src/lib/types.ts` is promoted to this
list for the duration of the programme (conflict W1-#3).

### Wave 1

**`src/lib/db/index.ts` (and `src/lib/db/org.ts` where noted)**
- `export { recordOutcome, listOrgOutcomes, backfillOutcomes } from "./outcomes";` (#9)
- `export { recordUsageEvent, laneTotals, teamTotals, type UsageEventRow, type LaneUsage, type TeamUsage } from "@/lib/db/usage-events";` (#11)
- re-export `./repo-memory` (`upsertMirrorEntries`, `listRepoDeadEnds`, `countMirrored`, `type RepoMemoryEntryRow`) (#14)
- via `src/lib/db/org.ts`: `listConformanceReports`, `loadControlMatrix`, `type ConformanceReportRow`, `type ControlMatrixRow` from `@/lib/db/org-conformance` (#16)
- `listOrgSkillUsageSamples`, `recordUsageSamples`, `purgeUsageSamples`, `type SkillUsageSampleRow` (#19)
- `listSkillLessons`, `replaceSkillLessons`, `purgeSkillLessons`, `getSkillTrace`, `putSkillTrace`, `createMemoryProposal`, `setMemoryProposalPr`, `type SkillLessonRow`, `type SkillTraceRow`, `type MemoryProposalRow` (#36)
- `export { getCompactionCoverage, digestPeriod, digestScans, type CompactedPoint, type ScanDigestRow } from "@/lib/db/scan-digest";` (#32)
- `getFoundationRollout` from `./org-foundation`; `ensureOrgApiToken` from `./org-api-tokens` (#35)
- **#18: deliberately NO barrel line** — the `org-registry*` modules are not barrel-exported by
  standing convention (`org-registry.ts` header). The new ones follow it.

**`src/lib/types.ts` (Director-landed, additive)**
- `manifest?: ManifestReadout | null;` on `ScanReport`, importing from `@/lib/standard/readout` (#13)
- `memoryFiles?: FetchedFile[];` on `RepoSnapshot` (#14) — *#14 lists this as a lane edit; reassigned.*

**`context-map.json` `filePaths`**
- *AI-Native Standard & Onboarding Skill*: `src/lib/standard/read.ts`, `src/lib/standard/readout.ts`, `src/lib/standard/check-ids.ts`, `src/lib/standard/control-matrix.ts`, `src/lib/db/org-conformance.ts`, `src/app/api/report/conformance/matrix/route.ts`, `src/lib/standard/memory-read.ts`
- *Roadmap & Recommendation Tracking*: `src/lib/outcomes/**`
- *Usage Metering*: `src/lib/db/usage-events.ts`, `src/lib/llm/meter.ts`, `src/app/usage/usageLanePanels.tsx`
- *Org Memory*: `src/lib/memory/repo-memory-mirror.ts`, `src/lib/db/repo-memory.ts`, `src/features/shared/memory/RepoMemoryDeadEnds.tsx`, `src/lib/db/org-registry-proposals.ts`
- *Skills Registry & API Tokens*: `src/lib/registry/usage-samples.ts`, `src/lib/db/org-skill-usage-samples.ts`, `src/lib/org/skill-event-source.ts`
- *AI Registry Repo (Onboarding & Index)*: the new `src/lib/registry/*` (`subjects`, `signals`, `conformance-map`, `conformance-read`, `conformance-sweep`, `signals-contribution`, `signals-pr`, `lessons`, `trace`, `lesson-memory`, `memory-pr`), `src/lib/db/org-registry-{subjects,conformance,signals}.ts`, `src/lib/db/org-skill-{lessons,trace}.ts`, `src/app/api/org/[slug]/registry/{conformance,signals,trace}/**`, the six new panels
- *Data Retention & Purge*: `src/lib/db/scan-digest.ts` (+ its two tests)
- *GitHub App / Onboarding*: `src/lib/github/actions-secrets.ts`, `src/lib/db/org-foundation.ts`

**`scripts/docs/feature-doc-map.json`**
- widen `billing/usage.md`: `src/lib/db/usage.ts` → `src/lib/db/usage*.ts`; add `src/lib/llm/meter.ts` (#11) — **doc-map GAP: `src/lib/db/usage*.ts` matched only the one file.**
- add `src/lib/outcomes/**` + `src/lib/db/outcomes.ts` → `reporting/report.md` (#9)
- add `src/lib/db/repo-memory.ts` → `org-knowledge/memory.md` (#14)
- **add `src/app/api/report/conformance/**` → `onboarding/ai-manifest-spec.md` (#16) — doc-map GAP:
  today only `skill/**` and `foundation/**` are mapped, so a conformance-route edit trips no nag.**
- add `src/app/api/report/foundation/**` → `onboarding/wizard.md` (#35)
- add `src/lib/db/org-skill-usage-samples.ts` → `org-knowledge/skills.md` (#19)
- add `src/lib/db/scan-digest*.ts` → `data/retention.md` (#32)
- **#18/#36: no change needed** — `src/lib/registry/**`, `src/lib/db/org-registry*.ts`,
  `src/app/api/org/[slug]/registry/**`, `src/features/shared/registry|skills/**` already map.

**Other wave-1 Director lines**
- `package.json`: `libsodium-wrappers` + `@types/libsodium-wrappers` (#35).
- `docs/GOLDEN-USE-CASES.md` Phase A: amend the `telemetry/<repo>/<yyyy-mm>.jsonl` line to #19's
  pinned two-sink contract (a doc line, not a builder edit).
- Dispatch-brief additions: W1-B also lands `pickFilesToFetch` `slice(0,4) → slice(0,6)` for W2-I.

### Wave 2

**`src/lib/db/index.ts`**
- re-export `lane-brief-read.ts`, `lane-outcomes.ts`, `loop-lessons.ts` (#25)
- `foldImprovementEvents`, `getImprovementEvents`, `recordLoopPr` from `@/lib/db/improvement-events` (#26)
- re-export `./practice-adoption` and `./house-pattern-versions` (#33)
- `recordMemoryCitation`, `citationCountsFor`, `type MemoryCitationRow` from `@/lib/db/org-memory-citations` (#17)
- **#27: no new export** — everything ships through the `@/lib/db/loop-runs` barrel the lane owns.

**`src/lib/db/org-insights.ts` — the corpus-eligibility extraction (Director decision)**
> **W2-J1 performs the extraction.** `BENCHMARK_ELIGIBLE`, `COHORT_MIN`, `CORPUS_MIN` and
> `CORPUS_BASIS` move to a new `src/lib/corpus/eligibility.ts` (pure, no Prisma) and are
> **re-exported from `org-insights.ts`** so every existing caller is unchanged. Rationale: the
> open-corpus concept doc names this as "the one line of A that J1 should be told about before it
> starts", and #34 explicitly records the drift risk of a local copy. J1 owns the new file; the
> Director lands the re-export line and the `context-map.json` entry for `src/lib/corpus/**`.

**`src/lib/types.ts`**
- `GuidanceGraph`, `GuidanceNode`, `GuidanceEdge`, `GuidanceContradiction`,
  `ScanReport.guidanceGraph`, `LlmClaim.path2/quote2` (#15) — *#15 lists these as lane edits;
  reassigned to the Director under W1-#3's rule.*

**`context-map.json`**
- *Playbooks / Local Autopilot & Loop Engine*: `src/lib/org/lane-brief.ts`, `src/lib/db/lane-brief-read.ts`, `src/lib/db/lane-outcomes.ts`, `src/lib/db/loop-lessons.ts`, `src/lib/local/lane-report.ts`, `src/lib/local/agent-envelope.ts`, `src/lib/local/lane-economics.ts`, `src/lib/local/loop-pr.ts` (+ tests)
- *Executive Briefing*: `src/lib/db/improvement-events.ts`
- *Maturity Model & Scoring Engine*: `src/lib/analyze/guidance-graph.ts`, `src/lib/analyze/guidance-projection.ts`
- *Fleet Rollups & Insights*: the new `context-health/` components; `src/lib/corpus/**`
- *Reporting & Visualization › Trends & Comparison*: `src/lib/report/exemplar.ts`, `exemplar-load.ts`, `src/app/report/compare/ExemplarPanel.tsx`
- *Practices, Governance & Adoption*: `src/lib/practices/{reconcile,registry-artifact}.ts`, `src/lib/db/{practice-adoption,house-pattern-versions}.ts`, `src/features/shared/practices/PracticeDriftStrip.tsx`
- *MCP Server*: `src/lib/mcp/{skill-match,write-gate,registry-reads}.ts`, `src/app/api/mcp/gates.ts` (+ tests); *Entry Points* gains `src/lib/mcp/write-gate.ts`

**`scripts/docs/feature-doc-map.json`**
- **add `src/lib/local/{agent,agent-envelope,lane-economics,drive}.ts` → `org-planning/live.md`
  (#27) — doc-map GAP: none of the four is matched today, so the nag is off for the whole agent seam.**
- add `src/lib/org/lane-brief.ts` + `src/lib/db/lane-*.ts` → `org-planning/live.md` (#25)
- add `src/lib/db/improvement-events.ts`, `src/lib/db/org-impact.ts`, `src/lib/db/org-program.ts` → `org-planning/plan.md`; `src/lib/local/loop-pr.ts` → `live.md` (#26)
- extend `maturity-model.md` globs with `src/lib/analyze/guidance-*.ts` (#15)
- extend the practices globs with `src/lib/practices/**` and `src/lib/db/practice-adoption.ts` (#33)
- add `src/lib/corpus/**` (Director; corpus doc's handoff)
- **#17/#34: no change** — `src/lib/mcp/**`, `src/app/api/mcp/**`, `src/lib/report/**`,
  `src/app/report/**`, `src/components/report/**` already map.

### Wave 3

**`src/lib/db/index.ts`**
- `export * from "@/lib/db/scan-jobs";` (#10)
- `export * from "@/lib/db/control-observations";` — **one line covering both L's writers and M's
  readers** (`recordObservations`, `latestObservations`, `listObservationsSince`,
  `appendControlObservations`, `controlStateAt`, `listControlTimeline`, `controlCoverage`,
  `type ControlObservationRow`, `type ControlSealRow`).

**`context-map.json`**
- *Org Import, Scan & Watchlist*: `src/lib/db/scan-jobs.ts`, `src/lib/scan-probe.ts`, `src/lib/scan-probe-controls.ts`, `src/lib/scan-queue-worker.ts`, `src/app/api/cron/probe/**`, `src/app/api/org/scan/queue/**`
- *Security Posture & Audit Log*: `src/lib/controls/**`, `src/lib/github/governance-events.ts`, `src/lib/db/control-observations.ts`, `src/app/api/org/controls/**`, `src/app/api/audit/verify/**`

**`scripts/docs/feature-doc-map.json`**
- `fleet`/`rescan.md`: add `src/lib/scan-probe*.ts`, `src/lib/scan-queue-worker.ts`, `src/lib/db/scan-jobs.ts`, `src/app/api/cron/probe/**` (#10)
- **`org-dashboard` entry: add `src/lib/controls/**`, `src/lib/conformance/**`,
  `src/app/api/org/conformance-pack/**`, `src/app/api/org/controls/**`,
  `src/features/standing/governance/**` (#1) — doc-map GAP: today only
  `governance/stance/**` + `GovernancePanel.tsx` are mapped and `src/lib/conformance/**` is mapped
  NOWHERE, so a whole evidence surface switches the doc nag off.**

**Other:** `vercel.json` `/api/cron/probe` entry — **#10 lists it as a lane edit; the Director should
confirm** whether deploy config is Class B here (it is not in the plan's Class-B list; leave with L,
review the diff).

### Wave 4

**`src/lib/db/index.ts` / `src/lib/db/org.ts`**
- `export { claimFollowups, releaseFollowups, reportAttempt, sweepExpiredLeases, type FollowupClaimRow } from "./followup-claims";` (#3)
- `src/lib/db/org.ts`: `export * from "@/lib/db/org-admission";` (#8 — `db/index.ts` already does `export * from "@/lib/db/org"`, so no `index.ts` edit)
- re-export `getForgeInstallation`, `upsertForgeInstallation`, `deleteForgeInstallation` from `./forge-installations` (#4)

**`context-map.json`**
- *Follow-ups Ledger*: `src/lib/db/followup-claims.ts`, `scripts/ascent-work.mjs`; three MCP write tools noted on *MCP Server*
- *Practices, Governance & Adoption*: `src/lib/org/admission*.ts`, `src/lib/github/admission-write.ts`, `src/features/standing/governance/stance/admission/**`
- *GitHub Repo Data Access*: `src/lib/forge/**` (optionally relabel the context "Repo Data Access (forges)")

**`scripts/docs/feature-doc-map.json`**
- add `src/lib/db/followup-claims.ts` → `org-followups` (#3)
- add `src/lib/org/admission*.ts` + `src/app/api/org/admission/**` → `org-intelligence.md`;
  `src/lib/github/admission-write.ts` → `github-app.md` (#8)
- **new entry** `{ area: "github", doc: "docs/features/github/forges.md", sourceGlobs: ["src/lib/forge/**"] }` (#4) — must land in the **same merge** as `forges.md`, because
  `check-doc-sync.test.mjs` asserts every `sourceGlob` matches a tracked file.

### Doc-map gaps found by the specs (consolidated)

| Missing glob | Doc it should nag | Found by |
|---|---|---|
| `src/lib/conformance/**` | `org-dashboard/org-intelligence.md` | #1 |
| `src/features/standing/governance/**` (beyond `stance/**` + `GovernancePanel.tsx`) | same | #1 |
| `src/app/api/org/conformance-pack/**`, `src/app/api/org/controls/**`, `src/lib/controls/**` | same | #1 |
| `src/app/api/report/conformance/**` | `onboarding/ai-manifest-spec.md` | #16 |
| `src/lib/local/{agent,agent-envelope,lane-economics,drive}.ts` | `org-planning/live.md` | #27 |
| `src/lib/db/usage*.ts` (only `usage.ts` matched) | `billing/usage.md` | #11 |
| `src/lib/forge/**` (no entry at all) | new `github/forges.md` | #4 |
| `src/app/api/report/foundation/**` | `onboarding/wizard.md` | #35 |
| `src/lib/corpus/**`, `src/app/api/cron/corpus/**` | new `fleet/benchmark.md` | corpus doc |
| `src/lib/integrations/**` | `org-dashboard/developer.md` | #23 doc |
| `src/lib/trust/**`, `src/app/trust/**`, `src/app/api/org/trust/**` | new `trust/trust-center.md` | #7 doc |
| `src/lib/github/user-token.ts`, `src/app/api/me/github/**` | `github/auth.md` | #22 doc |

---

## 7. Cross-lane handoff graph

| From | To | What exactly | Blocking? |
|---|---|---|---|
| W1-B (#14) | W1-A (#13) | `.ai/manifest.yaml` + `.ai/guardrails.yaml` in `pickFilesToFetch` `exactNames`, step 0, outside the `MAX_FILES` budget | **Blocking** (A's readout is null without it) |
| W1-B (#14) | W2-I (#15) | `pickFilesToFetch` step 0 `.slice(0, 4)` → `.slice(0, 6)` | Optional (graph degrades: unfetched nodes are `contentSampled: false`) |
| W1-B (#14) | W1-D (#36) | `writeMemoryCandidate({orgId, namespace, content, kind, source, confidence, tags})` — the generalized one-door ingest | **Blocking** for #36 step 9 only |
| W1-B (#14) | W4-P (#4) | the `fetchSnapshot` memory quarantine must survive the GitHub-adapter extraction | **Blocking** (added to P's preconditions) |
| W1-A (#13) | W2-I (#15) | r11 bump note: the +4 D1 manifest award became *reachable* in wave 1 with no rubric change | Optional (a doc line) |
| W1-A (#16) | W3-M (#1) | `detectControlRegressions(prev, next)` (pure, exported, unused in A) and `loadControlMatrix()` for the pack appendix | Optional (M can ship without the appendix) |
| W3-M (#1) | W1-A (#16) | `detectControlTransitions()`, `buildControlAlertMessage()`, `AlertEventKind = "control"`, reason codes | **Non-blocking, reverse-wave** — A ships the detector, M ships the alert. A must **not** add an alert kind. |
| W1-E (#9) | W1-D (#19) | Skills tab should read `listOrgOutcomes({kind:"skill"})` and delete `skills.md:265`; also delete the **stale** `skills.md:239` gap (`HistoryPoint` *does* carry `rubricVersion`) | Optional |
| W1-E (#9) | wave-1 schema pass | `InterventionOutcome` purge/erase cascade | **Blocking** (§5 decision) |
| W1-C (#11) | W2-G (#27) | `meter({lane:"local", orgSlug, refId: laneId, provider:"claude-cli", model, tokens:null})` + idempotency key `loop-lane:<laneId>` | Optional (G's step 8; lane is green without it) |
| W2-G (#27) | W1-C (#11) | requirements on the contract: caller-supplied idem key, caller-supplied cost (envelope is authoritative), a `local` lane discriminator | **Blocking on the signature**, resolved: #11 ships all three |
| W1-F (#32) | W2-G (#26) | `forecastBasis(forecast)` and `getCompactionCoverage(orgSlug)`; F never edits `briefing.ts` | **Blocking** for #26 step 5 |
| W1-D (#18) | W2-K (#17) | `listOrgKnowledgeSubjects(orgSlug)`, `registryBlobUrl(orgSlug, path)`, `listSubjectsForContext`, `listConformance` | **Blocking** for K step 7 (else absence-only form) |
| W1-D (#19) | W2-K (#17) | `"mcp"` in the validated `OrgSkillEvent.source` set; `SkillEventInput` with `session` + `ts` | **Blocking** for K step 3 |
| W1-D (#36) | W2-K (#17) | `listSkillLessons(orgSlug, skillName)` for `get_skill_lessons` | **Blocking** for K step 6 |
| W2-J1 (#34) | W2-K (#17) | `exemplarDiff(org, repo, opts)` + stable type exports for `compare_against_exemplar` | **Blocking** for K step 8 only; K stops at 7 if J1 slips |
| W2-J1 (#34) | W2-J2 (#33) | `transferJoin()` returns a `practiceId`; the apply link is a plain href — J1 calls nothing in `practices/apply.ts` | Optional |
| W2-I (#15) | W2-J2 (#33) | `consolidate-guidance` starter must have a single deterministic `artifact.path` (the ledger keys on it) | **Blocking on the constraint**, not on order |
| W2-G (#25) | W2-J2 (#33) | reserve `briefJson.housePattern.version` for `HousePatternVersion`; left null by G | Optional |
| W2-G (#25) | W4-N (#3) | `.ascent/lane-report.json` schema is versioned `"v": 1` — the same shape a remote agent POSTs | **Blocking on the contract** |
| W2-K (#17) | W4-N (#3) | `WRITE_TOOL_POLICY` + `assertWriteAllowed` is the extension seam; N adds three rows and a handler each | **Blocking** (plan §2 precondition) |
| W2-G | W4-N (#3) | settled `loop-lane.ts` for the claim-path cut-over | **Blocking** |
| W3-L (#10) | W3-M (#1) | `ControlObservation` row contract frozen: one row per state **transition** + a 24h heartbeat; `transition = true` marks alertables; `unmeasurable` is first-class; `evidenceJson` is the citable slice. Plus the five webhook branches as enqueue-only. | **Blocking** (whole wave) |
| W3-M (#1) | W4-O (#8) | `controlStateAt()` for `observedRequiredApprovals` / `protectedBranch` observed state | **Blocking** (plan §2) |
| W4-O (#8) | W3-M (#1) | pack rows stamped with `stanceVersion` + `admission.mode`; an `AlertEvent.kind = "control"` when an applied ruleset is observed removed | **Reverse-wave, deferred** — record as a wave-5 follow-on; M has merged. |
| W4-N (#3) | W4-O (#8) | `claimability()` is a pure function with one input struct so O can swap the derived tier for a compiled `RepoAdmission` | Optional |
| W4-O (#8) | W4-P (#4) | final `gate.ts` verdict shape | **Blocking** |
| corpus doc | W2-J1 (#34) | `src/lib/corpus/eligibility.ts` (the Director decision above) — J1 performs the extraction | **Blocking on ownership**, resolved |
| gate-as-code doc | W1-A (#16) + W4-O (#8) | one `GatePolicy` fold; `requireChecks` and `admissionPolicy()` are **fields**, never new resolution paths | **Blocking on design**, resolved by conflict W1-#5 |
| #7 trust doc | W3-M (#1) | actor-free `controlCountsAsOf(orgId, day)` / `controlTransitionCounts(orgId, range)` + the seal-root getter | Not in this programme; recorded |
| #23 doc | W1-D (#19) | `skillInvokes30d` producer — request the read, do not build a second counter | Not in this programme; recorded |

---

## 8. Defects surfaced in passing (S/M, in no spec's scope)

Each is a standalone finding the specs turned up while premise-checking. None is claimed by a lane.

| # | Defect | Evidence | Size |
|---|---|---|---|
| D1 | **`AgentSession.userKey` stores a developer's raw work email in plaintext.** The schema comment calls it "an opaque per-user key"; it is not. | `#23` doc §Ground truth; `prisma/schema.prisma` `AgentSession`; `src/lib/db/agent-sessions.ts` selects it only to size a `Set` | M |
| D2 | **Nothing purges `AgentSession`.** `retention.ts` deletes `Scan` (+children) and `AuditLog` only; grep for `agentSession` across `src/lib` returns one module. **Org erase misses it too**, so a DSR erase leaves plaintext-email telemetry behind. | `#23` doc, same section | M |
| D3 | **`buildGettingStartedModel`'s header comment says five steps; the union has six.** | `#35` premise check, `src/lib/org/getting-started.ts:6` and the union at `:24` | S |
| D4 | **`src/lib/register/data.ts`'s header still names the deleted badge route as a caller.** `src/app/api/badge/**`, `src/app/api/scorecard/[owner]/badge/**` and `src/lib/badge.ts` were removed on this branch. | `#7` doc §Premises FALSE #1 | S |
| D5 | **The conformance route drops `unchecked` on the wire.** The doctor already sends it (and prints `scored`), but the POST body type discards both and `recordConformance` never sees them. | `#16` premise "FALSE, worth exploiting" | S |
| D6 | **`RegistryActivityKind` has a `"lesson"` member that `activityOf` never emits.** The union, the label map and the fixture all carry it; there is no producer. | `#36` premise table, `src/lib/org/registry-view.ts`, `RegistryActivity.tsx` | S |
| D7 | **`CatalogSkillEntry.applicability` / `adopters` / `invokes30d` are a type with no producer and no store**, and `org-registry-write.ts` drops `aggregateUsage`'s `bySkill` entirely. | `#17` premise FALSE #1; `#19` premise row 1 | M |
| D8 | **`LoopRun.phase = "curating"` is the schema default and is read by `getActiveLoopRun`, but no code path ever writes a row in it.** | `#3` premise "half false" | S |
| D9 | **`StanceFinding.advisory` is never emitted `true`, so `compliant` is degenerate.** | `#8`, BACKLOG group-05 | S |
| D10 | **Gate `policyFromParams` drops `minAiGovernedRate` on the no-org-policy path**, making a query overlay meaningless there. | `#8`, BACKLOG group-05 | S |
| D11 | **`reconcileListedRepos` never runs for App-installed orgs**, so `Repository.missingSince` is never written — a renamed or archived private repo burns a rescan slot forever. | `#10` premise check, BACKLOG group 04 | M |
| D12 | **`claimRepoScan` / `releaseRepoScan` is a module-global `Map`** self-documented as "NOT a cross-instance distributed lock" — the double-billing exposure. | `#10` premise check, `src/lib/db/org-watch.ts` | M (closed by #10) |
| D13 | **The +4 D1 "manifest declares capabilities + control placement" award is unreachable dead code** — `aiStandard()` reads `idx.content(".ai/manifest.yaml")` but `pickFilesToFetch` never requests the file. | `#13` premise 3, `#14` "new fact" | M (closed by W1-A/B) |
| D14 | **`loadConformanceTrend` walks up to 10 pages × 100 audit rows per GET request**, and its `regressed` result is dispatched nowhere. | `#16` premise "PARTLY FALSE" | M (closed by #16) |
| D15 | **`docs/features/onboarding/README.md`'s freshness table says `ai-manifest-spec.md` covers spec v0.1.0**; it is 0.2.0. | `#16` §Known gaps | S |
| D16 | **`openDraftPr` throws 409 when the path already exists on base**, so any repeat contribution to the same file always fails (bit the signals writer). No create-only safety check exists either. | `#18` premise 3; `#33` out-of-scope note | M |
| D17 | **`OrgSkillEvent.source` is free text, never validated**, and the shipped CLI smuggles state into it (`cli:diverged`), so a naive enum would invalidate every event the fleet emits. | `#19` premise rows 4 and 6 | S |
| D18 | **`getRegistryView`'s fleet block returns literal zeros** (`reposPointing: 0, reposSynced30d: 0, adoption: {…0}`) — fabricated numbers on a live surface. | `#19` premise row 5 | M |
| D19 | **`MemoryRunner.usage` is live-mutated and never persisted** (its own comment says so), and `briefing-narrative.ts` discards the Anthropic response's whole `usage` block. | `#11` premise check | S |
| D20 | **`textRunnerFrom`'s `ownsTimeout` branch (claude-cli) reports no usage at all**, so that path is structurally unmeterable. | `#11` premise "FALSE — a single chokepoint" | S |
| D21 | **`AiChange` is `@@unique([repoId, prNumber])` and upserted per scan**, so approval state has no history; and `RepoControlEnvironment` in the conformance pack is built from the **latest scan** while `buildConformancePack`'s `limitations` does not disclose it. | `#1` premise check | M |
| D22 | **`getOrgMovers` partitions on strict sign with no noise band** — a `+1` is recorded as a gainer. | corpus doc P2; `src/lib/maturity/noise.ts` exists | S |
| D23 | **The `/onboarding` render gate on `SessionControls` is missing**, so "revoke other sessions" is unreachable under the live auth wall even though the route works. | `#22` doc C4 | S |
| D24 | **The `github_app_authorization` webhook event is neither subscribed nor handled**, so GitHub's own "user revoked the App" signal is unreceived. | `#22` doc §Ground truth | S |
| D25 | **`memory.md` carries two stale component paths** (the memory components live under `src/features/shared/memory/`, not `src/app/org/[slug]/memory/`). | `#14` §Known gaps | S |
| D26 | **`docs/features/org-planning/README.md`'s entry points are stale.** | `#25`, BACKLOG group-06 | S |
| D27 | **`PRACTICE_BY_DIM` silently shadows on a duplicate `dimId`** — a second `D1` row would shadow `agent-guidance` with no error. | `#15` premise 4 | S |
| D28 | **No feature doc states the GitHub-only ingestion limitation at all**, so #4 must *add* the disclosure rather than delete a gap. | `#4` §Known gaps | S |
| D29 | **LOC ceilings to watch before any wave merges:** `RecommendationTracker.tsx` 296/300 · `LiveCockpit.tsx` 195/200 · `registryModel.ts` 198/200 · `ImpactLedger.tsx` 177/200 · `AuditLogCells.tsx` 174/200 · `OnboardingScanStep.tsx` 235/300 · `TrendChart.tsx` 288/300 · `index-registry.ts` 373 (must not pass ~400) · `RegistryPanel.tsx` 161/200. | across specs | — |

---

## 9. Open questions for the owner

Deduplicated across the 22 specs and 5 concept docs, each with the recommended answer.

| # | Question | Recommended answer |
|---|---|---|
| 1 | **`ControlObservation` is defined twice, incompatibly (#10 vs #1).** Which vocabulary wins? | **#1's**: `controlId` kebab-case ids and `pass\|fail\|unmeasurable`. #10's probe mappers translate. The wave-3 schema pass lands the merged model in §5; `unknown` must never mean `off` and `unmeasurable` must never alert as failed. |
| 2 | **Does #16's `requireChecks` ship in wave 1 or fold into W4-O?** | **Fold into W4-O.** The gate-as-code doc's whole point is one `GatePolicy` fold; two lanes adding gate criteria in different waves is the fork it exists to prevent. #16 steps 1–7 are unaffected. |
| 3 | **Where do the `LoopRunLane` lease/executor columns land — wave 2 or wave 4?** | **Wave 2, unused** (plan §2 already says so; #3's spec says wave 4). One schema pass touching `LoopRunLane` is cheaper than two. |
| 4 | **Is W1-H too fine a split from W1-A inside `src/lib/standard/`?** (plan §2 asks explicitly) | **Keep the split.** H touches `pr.ts` only and is otherwise schema-free; the specs' must-not-touch lists are file-precise and non-overlapping. |
| 5 | **Are the two W3-L files (`webhook/route.ts`, `scan-probe.ts`) M's to edit post-merge, or does L land M's two call sites?** (#1 asks the Director directly) | **M edits them post-merge.** Serial wave, and L would otherwise ship a normalizer it does not own. |
| 6 | **Does W2-J1 get the `org-insights.ts` exports, or perform the `src/lib/corpus/eligibility.ts` extraction?** | **Perform the extraction** (Director decision, §6). Four exported module-privates would drift; the corpus doc names the extraction as A's one J1-facing line. |
| 7 | **Does #33's scan reconcile hook live in `scans-persist.ts` or `scan-finalize.ts`?** | **`scan-finalize.ts`** — #33 offers the fallback and it removes the only wave-2 conflict (W2-#1). |
| 8 | **Is the ingest door named `ingestObservedMemory` (#14) or `writeMemoryCandidate` (#36)?** | **`writeMemoryCandidate(input)`** — #36's parameterized shape is a superset. W1-B implements it and keeps `ingestObservedMemory` as a thin alias so `scan-feed.test.ts` passes untouched. |
| 9 | **Is `vercel.json` Class B?** (#10 edits it for the probe cron) | **No, but review the diff.** It is not in the plan's Class-B list; leave it with W3-L and diff it at merge. |
| 10 | **Does the D30 re-scan protocol run before W2-I's r11 bump?** | **Yes, and it is the gate on publishing anything.** The corpus doc's P1 step 2 requires a frozen r10 for the duration; a bump mid-protocol voids ~11h of wall-clock scanning. If the schedule cannot hold it, ship corpus Option A only and defer B. |
| 11 | **Corpus: ship A → B → C one round apart, aggregate quantiles only, `CONTRIB_MIN_DEPLOYMENTS = 5`, `benchmarkSharing` default `off`?** | **Yes to all four.** Kill 08#4's per-repo JSONL export; the register already renders per-repo public scores in HTML. |
| 12 | **Gate-as-code: is the manifest bar tighten-only, read from the base ref, with `ratchet` opt-in?** | **Yes, yes, opt-in.** Tighten-only makes "a PR edits its own bar" harmless; base-ref reading stops a PR lowering the bar it is judged against; `ratchet.dimensions` especially starts off. |
| 13 | **Trust Center: snapshot-of-record with a drift line, after #1, `TRUST_MIN_REPOS = 5`, no per-repo rows in v1?** | **Yes to all four**, plus a separate opaque `trustSlug` (an org slug can be a customer codename and a public URL is forever). Blocked on a legal/ToS line — the one non-engineering precondition. |
| 14 | **Credential lane: ship provenance-only (C) then explicit connect (A), never the Supabase provider switch (B)?** | **Yes.** B bundles credential consent into login, re-consents the entire existing user base, and makes the blast radius everyone who ever signed in. Read-only by construction; personal-workspace writes only. |
| 15 | **Behaviour ledger: claim-code link, hash `userKey` regardless, floor quartile bands?** | **Yes to all three**, and land the hash migration (decision 3 of that doc) **whether or not #23 proceeds** — it repairs D1/D2 above, which are live defects today. |

---

_Read this file before dispatching any wave. A lane whose diff touches a file outside its §2 write
set as re-derived here is a redo, not a merge; a lane whose spec disagrees with a resolution in §3
follows §3._
