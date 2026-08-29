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

import { describe, expect, it } from "vitest";
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
import type { ConformanceMapRow, ConformanceRow } from "@/lib/db/org-registry-conformance";
import type { KnowledgeSubjectRow } from "@/lib/db/org-registry-subjects";
import type { RegistrySignalRow, SignalContributionRow } from "@/lib/db/org-registry-signals";
import type { SkillUsageSampleRow } from "@/lib/db/org-skill-usage-samples";
import type { TransitionProgramRow } from "@/lib/db/org-program";
import type { SandboxScenarioRecord } from "@/lib/db/sandbox-scenario";

/** The keys of `T` whose (non-null) type is a `Date`. `never` when there are none. */
type DateBearingKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Date ? K : never;
}[keyof T];

/**
 * `true` when no field of `T` is a `Date`; otherwise a tuple type that cannot be assigned from
 * `true`, so `tsc` fails and the error message names the offending key(s).
 */
type WireSafe<T> = [DateBearingKeys<T>] extends [never]
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
const WIRE_TYPES = {
  ApiTokenSummary: true satisfies WireSafe<ApiTokenSummary>,
  AuditLogEntry: true satisfies WireSafe<AuditLogEntry>,
  AuditLogPage: true satisfies WireSafe<AuditLogPage>,
  ComparableScan: true satisfies WireSafe<ComparableScan>,
  // The five #18 row types. All reach a client through RegistryView, which RegistryPanel renders.
  ConformanceMapRow: true satisfies WireSafe<ConformanceMapRow>,
  ConformanceRow: true satisfies WireSafe<ConformanceRow>,
  HistoryPoint: true satisfies WireSafe<HistoryPoint>,
  KnowledgeSubjectRow: true satisfies WireSafe<KnowledgeSubjectRow>,
  MemoryRow: true satisfies WireSafe<MemoryRow>,
  OpsState: true satisfies WireSafe<OpsState>,
  OrgBranding: true satisfies WireSafe<OrgBranding>,
  OrgLlmConfigPublic: true satisfies WireSafe<OrgLlmConfigPublic>,
  OrgPractice: true satisfies WireSafe<OrgPractice>,
  OrphanedTrackedRec: true satisfies WireSafe<OrphanedTrackedRec>,
  PlaybookAdoption: true satisfies WireSafe<PlaybookAdoption>,
  PlaybookRow: true satisfies WireSafe<PlaybookRow>,
  PublicScanGallery: true satisfies WireSafe<PublicScanGallery>,
  RegistrySignalRow: true satisfies WireSafe<RegistrySignalRow>,
  RepositoryHistory: true satisfies WireSafe<RepositoryHistory>,
  SandboxScenarioRecord: true satisfies WireSafe<SandboxScenarioRecord>,
  SegmentSummary: true satisfies WireSafe<SegmentSummary>,
  SignalContributionRow: true satisfies WireSafe<SignalContributionRow>,
  SkillAdoption: true satisfies WireSafe<SkillAdoption>,
  SkillRow: true satisfies WireSafe<SkillRow>,
  // Reaches a client inside SkillUsageRows, which skill-usage.ts (imported by SkillsPanel) types against.
  SkillUsageSampleRow: true satisfies WireSafe<SkillUsageSampleRow>,
  TeamRollup: true satisfies WireSafe<TeamRollup>,
  TransitionProgramRow: true satisfies WireSafe<TransitionProgramRow>,
  UsageDay: true satisfies WireSafe<UsageDay>,
} as const;

describe("wire-safe dates (structural guard)", () => {
  // The real assertion is the `satisfies` above, checked by `tsc --noEmit`. This test exists so the
  // guard also appears in the suite — a reader scanning test names should find out the invariant
  // exists, and a runner that never fails is easy to delete by accident.
  it("holds for every db type a client imports", () => {
    expect(Object.values(WIRE_TYPES).every(Boolean)).toBe(true);
  });

  it("covers the audited set, so a silently-shrinking list is visible in a diff", () => {
    expect(Object.keys(WIRE_TYPES)).toHaveLength(28);
  });
});
