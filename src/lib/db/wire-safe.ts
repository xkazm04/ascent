// MOONSHOT wave-1 integration: this module (NOT the sibling test) is what makes the guard
// COMPILE-TIME. tsconfig excludes **/*.test.ts from `tsc --noEmit`, so the `satisfies`
// assertions were dead for every type while they lived in the test (found by lane W1-E,
// proven by seeding a Date field with tsc staying green). As a compiled src module, a
// violation now fails `npx tsc --noEmit` — the gate AGENTS.md always claimed.
//
// STRUCTURAL GUARD — a db type that crosses to a client must not carry a `Date`.
//
// ── The pattern this protects ────────────────────────────────────────────────────────────────────
//
// Prisma hands back `Date` objects. `NextResponse.json` turns those into ISO STRINGS. So any type
// that describes a row on BOTH sides of the wire and declares a field as `Date` is lying to the
// client: `row.createdAt.getTime()` type-checks, ships, and throws at runtime because `createdAt` is
// a string by then.
//
// This repo does not have that bug class, and not by luck. Every row type consumed by a client
// declares its timestamps as `string`, and the `toRow()` mappers call `.toISOString()` server-side
// before the object ever leaves `@/lib/db` (e.g. src/lib/db/org-memory.ts). An architect scan across
// 116 `DateTime` schema columns found ZERO instances of a client treating a transported date as a
// `Date`. The type never lies, so the mistake is not available to make.
//
// That is a strong pattern worth keeping rather than rediscovering, so it is asserted here.
//
// ── Why a COMPILE-TIME guard and not a text scan ─────────────────────────────────────────────────
//
// `src/lib/db` contains 119 legitimate `: Date` occurrences — Prisma row shapes, query windows,
// server-internal types. A grep for "Date" would be almost all false positives. The invariant is not
// "no Date in the db layer"; it is "no Date on a type that CROSSES to a client". TypeScript already
// knows the difference, so the check is expressed as an assignment that fails `tsc --noEmit` — which
// is already a gate — and names the offending field when it breaks.
//
// ── When this fails ──────────────────────────────────────────────────────────────────────────────
//
// You added or changed a field to `Date` on a type a client imports. Either type it `string` and
// `.toISOString()` it in the mapper (the convention), or — if the type genuinely stopped crossing the
// wire — drop it from the list below and say why in the commit.
//
// LIMIT, stated so nobody trusts this further than it goes: the check is SHALLOW. A `Date` nested
// inside an array or an object-valued field (`ledger: { createdAt: Date }[]`) is not caught. Extend
// with an explicit entry if that shape appears.
//
// Architect ADR 2026-08-28-codify-wire-safe-dates.

import type { ExemplarOption, ExemplarProfile } from "@/lib/report/exemplar";
import type {
  ApiTokenSummary,
  AuditLogEntry,
  AuditLogPage,
  ComparableScan,
  HistoryPoint,
  MemoryRow,
  OpsState,
  OrgLlmConfigPublic,
  OrgPractice,
  OrphanedTrackedRec,
  PlaybookAdoption,
  PlaybookRow,
  PublicScanGallery,
  RepositoryHistory,
  SegmentSummary,
  SkillAdoption,
  SkillRow,
  TeamRollup,
  UsageDay,
} from "@/lib/db";
// Reached by a client through a DEEP path rather than the barrel — the shape of import the first
// audit missed. See the note on WIRE_TYPES.
import type { OrgBranding } from "@/lib/db/branding";
import type { RepoMemoryEntryRow } from "@/lib/db/repo-memory";
// MOONSHOT #32. Deep-path until the barrel line lands; it reaches a client through `HistoryPoint`.
import type { CompactedPoint } from "@/lib/db/scan-digest";
import type { FoundationRolloutRow } from "@/lib/db/org-foundation";
import type { ConformanceMapRow, ConformanceRow } from "@/lib/db/org-registry-conformance";
import type { KnowledgeSubjectRow } from "@/lib/db/org-registry-subjects";
import type { MemoryCitationRow } from "@/lib/db/org-memory-citations";
import type { RegistrySignalRow, SignalContributionRow } from "@/lib/db/org-registry-signals";
import type { MemoryProposalRow } from "@/lib/db/org-registry-proposals";
import type { SkillLessonRow } from "@/lib/db/org-skill-lessons";
import type { SkillTraceRow } from "@/lib/db/org-skill-trace";
import type { SkillUsageSampleRow } from "@/lib/db/org-skill-usage-samples";
import type { TransitionProgramRow } from "@/lib/db/org-program";
import type { UsageEventRow } from "@/lib/db/usage-events";
import type { InterventionOutcomeRow } from "@/lib/db/outcomes";
// MOONSHOT #25 — the per-item lane ledger and the lesson inbox both render in the cockpit, and both
// carry `DateTime` columns (`deferUntil`, `reviewedAt`, `createdAt`). `LaneBriefProvenance` is not a
// db module's type but it IS a row's parsed payload (`LoopRunLane.briefJson`) and reaches the same
// client, so it belongs here on the same reasoning the ManifestReadout entry gives.
import type { LaneOutcomeRow } from "@/lib/db/lane-outcomes";
import type { LoopLessonRow } from "@/lib/db/loop-lessons";
// MOONSHOT #26 — the union read model reaches the executive surfaces; `at` is a DateTime column on
// both populations and is deliberately a string here, mapped with .toISOString() in the reader.
import type { ImprovementEvent } from "@/lib/db/improvement-events";
import type { LaneBriefProvenance } from "@/lib/org/lane-brief";
// MOONSHOT #3 — the work protocol's two crossing shapes.
//   • `FollowupClaimRow` is what claim/report hand back over MCP and what the Follow-ups ledger
//     renders; its `leaseUntil` comes off a Prisma `DateTime` and is declared `string`, mapped by
//     `toClaimRow`.
//   • `LoopLaneRecord` is RE-ASSERTED here (00-INDEX §5 wave 4). It already crossed to the cockpit
//     and was already string-typed on `startedAt`/`endedAt`, but this lane adds a THIRD timestamp
//     (`leaseUntil`) to it — precisely the moment a long-standing wire type acquires the bug this
//     guard exists for, and the reason the guard enumerates by what crosses rather than by age.
import type { FollowupClaimRow } from "@/lib/db/followup-claims";
import type { LoopLaneRecord } from "@/lib/db/loop-runs-types";
import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";
// Not a db module, but a db ROW TYPE all the same: ManifestReadout is parsed off
// Repository.manifestJson in org-rollup and crosses to the Passports client via OrgRepoRow.manifest.
// It declares two timestamps (`readAt`, `generatedAt`) and both are deliberately `string` — see #13.
import type { CapabilityReadout, ManifestReadout } from "@/lib/standard/readout";
// #16 — the conformance ledger's two row types. Both declare `reportedAt` / `since` as strings and
// are mapped with .toISOString() in org-conformance.ts, and both cross to the Passports client.
import type { ConformanceReportRow, ControlMatrixRow } from "@/lib/db/org-conformance";
// #33 — the adoption ledger's two row types. Both reach the Practices client: PracticeAdoptionRow
// through the rollout route's JSON, HousePatternRow through the drift strip's version reading. Five
// `DateTime` columns between them, every one declared `string` and mapped with .toISOString().
import type { HousePatternRow } from "@/lib/db/house-pattern-versions";
import type { PracticeAdoptionRow } from "@/lib/db/practice-adoption";
// #15 — the guidance graph is parsed off Repository.guidanceGraphJson in org-rollup and crosses to
// the Repositories client via OrgRepoRow.guidanceGraph. BOTH the container and `GuidanceNode` are
// listed: the check is shallow, and the only timestamp in this shape (`lastCommitAt`) lives inside
// the `nodes[]` array — exactly the nesting the header's stated LIMIT says needs its own entry.
import type { GuidanceGraph, GuidanceNode } from "@/lib/types";
// #10 — the two-speed fleet queue's row type. `ScanJobRow` reaches the OrgScanButton through
// GET /api/org/scan/queue and carries eight DateTime columns, every one a string here.
import type { ScanJobRow } from "@/lib/db/scan-jobs";
// #10 — the frozen control-observation contract W3-M's governance ledger reads. Four DateTime
// columns (occurredAt, observedAt, createdAt and the row's own stamps), every one a string here.
import type { ControlObservationRow, ControlSealRow } from "@/lib/db/control-observations";

/** The keys of `T` whose (non-null) type is a `Date`. `never` when there are none. */
export type DateBearingKeys<T> = {
  // The [X] extends [never] pre-check matters: a field typed exactly `null` (CompactedPoint.headSha)
  // has NonNullable<...> = never, and bare `never extends Date` is true — a false positive found the
  // moment this guard first actually compiled (wave-1 integration).
  [K in keyof T]-?: [NonNullable<T[K]>] extends [never] ? never : NonNullable<T[K]> extends Date ? K : never;
}[keyof T];

/**
 * `true` when no field of `T` is a `Date`; otherwise a tuple type that cannot be assigned from
 * `true`, so `tsc` fails and the error message names the offending key(s).
 */
export type WireSafe<T> = [DateBearingKeys<T>] extends [never]
  ? true
  : ["A Date-typed field crosses the wire on this type:", DateBearingKeys<T>];

// Every db type a `"use client"` module imports (re-audited 2026-08-29). A new one belongs here the
// moment a client imports it.
//
// SCOPE, and why it widened: the first audit (2026-08-28) enumerated the client imports from the
// `@/lib/db` BARREL. But a client may also import from a deep path, and eight types did — most of the
// report surface among them (`HistoryPoint` in DimensionTrendsRange/ScanComparePicker/ReportPanels/
// ScoringTab, `ComparableScan` in WhatChanged, `RepositoryHistory` in ReportView/DimensionTrends, all
// via `@/lib/db/scans`). Those are precisely the timestamp-heavy trend/diff types, and the invariant
// AGENTS.md states as law was unenforced for every one of them. They are all correct today — the
// mappers already `.toISOString()` — so this closes a guard gap, not a live bug. Enumerate by what a
// client IMPORTS, never by which module path it came through.
//
// Union-typed aliases a client also imports (MemorySort, SkillSort, SkillTokenScope, OrgRole,
// ProgramCadence, AuditVerdict) are deliberately absent: `keyof` a string union is not a row's field
// set, so WireSafe says nothing useful about them.
export const WIRE_TYPES = {
  // MOONSHOT #34. These two are the exception the scope note above anticipates: they are declared in
  // `@/lib/report/exemplar` rather than `@/lib/db`, but both are built by a `-load.ts` mapper out of
  // Prisma rows and both cross to a client — `ExemplarOption` is a prop of the "use client"
  // ScanComparePicker, and `ExemplarProfile` carries the exemplar side into the compare panel. Each
  // declares `scannedAt: string | null`, `.toISOString()`-mapped server-side, which is precisely the
  // invariant this guard holds. Enumerate by what CROSSES, never by which directory it lives in.
  ExemplarOption: true satisfies WireSafe<ExemplarOption>,
  ExemplarProfile: true satisfies WireSafe<ExemplarProfile>,
  ApiTokenSummary: true satisfies WireSafe<ApiTokenSummary>,
  AuditLogEntry: true satisfies WireSafe<AuditLogEntry>,
  AuditLogPage: true satisfies WireSafe<AuditLogPage>,
  // MOONSHOT #32: a compacted history point reaches the trend charts through `HistoryPoint`, and
  // its three timestamps come off Prisma `DateTime` columns — so it is exactly the shape this guard
  // exists for. `toDigestRow` does the `.toISOString()`.
  CompactedPoint: true satisfies WireSafe<CompactedPoint>,
  ComparableScan: true satisfies WireSafe<ComparableScan>,
  // MOONSHOT #35: the rollout rows render in the Repositories tab; timestamps are ISO strings.
  FoundationRolloutRow: true satisfies WireSafe<FoundationRolloutRow>,
  CapabilityReadout: true satisfies WireSafe<CapabilityReadout>,
  ConformanceReportRow: true satisfies WireSafe<ConformanceReportRow>,
  ControlMatrixRow: true satisfies WireSafe<ControlMatrixRow>,
  GuidanceGraph: true satisfies WireSafe<GuidanceGraph>,
  GuidanceNode: true satisfies WireSafe<GuidanceNode>,
  HistoryPoint: true satisfies WireSafe<HistoryPoint>,
  // #33 — the adoption ledger.
  HousePatternRow: true satisfies WireSafe<HousePatternRow>,
  PracticeAdoptionRow: true satisfies WireSafe<PracticeAdoptionRow>,
  ManifestReadout: true satisfies WireSafe<ManifestReadout>,
  // The five #18 row types. All reach a client through RegistryView, which RegistryPanel renders.
  ConformanceMapRow: true satisfies WireSafe<ConformanceMapRow>,
  ConformanceRow: true satisfies WireSafe<ConformanceRow>,
  KnowledgeSubjectRow: true satisfies WireSafe<KnowledgeSubjectRow>,
  MemoryProposalRow: true satisfies WireSafe<MemoryProposalRow>,
  InterventionOutcomeRow: true satisfies WireSafe<InterventionOutcomeRow>,
  // MOONSHOT #17: a citation is evidence a memory was used; its `createdAt` comes straight off a
  // Prisma `DateTime` and `listMemoryCitations` does the `.toISOString()`.
  MemoryCitationRow: true satisfies WireSafe<MemoryCitationRow>,
  LaneBriefProvenance: true satisfies WireSafe<LaneBriefProvenance>,
  FollowupClaimRow: true satisfies WireSafe<FollowupClaimRow>,
  LoopLaneRecord: true satisfies WireSafe<LoopLaneRecord>,
  ImprovementEvent: true satisfies WireSafe<ImprovementEvent>,
  LaneOutcomeRow: true satisfies WireSafe<LaneOutcomeRow>,
  LoopLessonRow: true satisfies WireSafe<LoopLessonRow>,
  MemoryRow: true satisfies WireSafe<MemoryRow>,
  OpsState: true satisfies WireSafe<OpsState>,
  OrgBranding: true satisfies WireSafe<OrgBranding>,
  OrgLlmConfigPublic: true satisfies WireSafe<OrgLlmConfigPublic>,
  OrgPractice: true satisfies WireSafe<OrgPractice>,
  OrphanedTrackedRec: true satisfies WireSafe<OrphanedTrackedRec>,
  PlaybookAdoption: true satisfies WireSafe<PlaybookAdoption>,
  PlaybookRow: true satisfies WireSafe<PlaybookRow>,
  PublicScanGallery: true satisfies WireSafe<PublicScanGallery>,
  RepoMemoryEntryRow: true satisfies WireSafe<RepoMemoryEntryRow>,
  RegistrySignalRow: true satisfies WireSafe<RegistrySignalRow>,
  RepositoryHistory: true satisfies WireSafe<RepositoryHistory>,
  SandboxScenarioRecord: true satisfies WireSafe<SandboxScenarioRecord>,
  ScanJobRow: true satisfies WireSafe<ScanJobRow>,
  ControlObservationRow: true satisfies WireSafe<ControlObservationRow>,
  // MOONSHOT #1: one daily ledger seal. `sealedAt` is a Prisma `DateTime` that toSealRow()
  // .toISOString()s; `day` is already a YYYY-MM-DD string in the column, not a date.
  ControlSealRow: true satisfies WireSafe<ControlSealRow>,
  SegmentSummary: true satisfies WireSafe<SegmentSummary>,
  SignalContributionRow: true satisfies WireSafe<SignalContributionRow>,
  SkillAdoption: true satisfies WireSafe<SkillAdoption>,
  SkillLessonRow: true satisfies WireSafe<SkillLessonRow>,
  SkillRow: true satisfies WireSafe<SkillRow>,
  SkillTraceRow: true satisfies WireSafe<SkillTraceRow>,
  // Reaches a client inside SkillUsageRows, which skill-usage.ts (imported by SkillsPanel) types against.
  SkillUsageSampleRow: true satisfies WireSafe<SkillUsageSampleRow>,
  TeamRollup: true satisfies WireSafe<TeamRollup>,
  TransitionProgramRow: true satisfies WireSafe<TransitionProgramRow>,
  UsageDay: true satisfies WireSafe<UsageDay>,
  // #11 — one metered model call. `createdAt` is the ISO string `listUsageEvents` maps it to.
  UsageEventRow: true satisfies WireSafe<UsageEventRow>,
} as const;

