// Shared resolution of the org dashboard's URL scope filters (?segment= / ?stack=) — collapses the
// read-param → list → validate → resolve-id boilerplate that was duplicated across every scoped org
// page. Keeps the scope semantics identical everywhere: a bogus/stale id or key falls back to the
// whole fleet (never an error), and the resolved ids thread into the getOrgRollup family.
//
// Two entry points so a page fetches only what it renders:
//   - resolveStackScope: the tech-stack filter only (pages without a segment selector).
//   - resolveOrgScope:   segment + stack together (pages that render both selectors).

import { listSegments, listTechStackGroups, type SegmentRow, type TechGroupSummary } from "@/lib/db";

type SearchParams = { [key: string]: string | string[] | undefined };
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export interface StackScope {
  /** Non-empty tech groups for the TechStackSelector. */
  techGroups: TechGroupSummary[];
  /** The group the `?stack=<key>` selects, or null (whole fleet) — bogus keys fall back to null. */
  activeStack: TechGroupSummary | null;
  /** The resolved group id to thread into getOrgRollup & siblings, or null. */
  techGroupId: string | null;
}

export interface OrgScope extends StackScope {
  /** Segments for the SegmentSelector. */
  segments: SegmentRow[];
  /** The segment the `?segment=<id>` selects, validated against the org's segments, or null. */
  activeSegment: SegmentRow | null;
  /** The resolved segment id, or null. */
  segmentId: string | null;
}

/** Resolve just the tech-stack scope (Feature 3b) from the URL. */
export async function resolveStackScope(slug: string, sp: SearchParams): Promise<StackScope> {
  const techGroups = await listTechStackGroups(slug);
  const activeStack = techGroups.find((g) => g.key === first(sp.stack)) ?? null;
  return { techGroups, activeStack, techGroupId: activeStack?.id ?? null };
}

/** Resolve the full segment + tech-stack scope (the two filters compose). */
export async function resolveOrgScope(slug: string, sp: SearchParams): Promise<OrgScope> {
  const [segments, stack] = await Promise.all([
    listSegments(slug).then((s) => s ?? []),
    resolveStackScope(slug, sp),
  ]);
  const activeSegment = segments.find((s) => s.id === first(sp.segment)) ?? null;
  return { segments, activeSegment, segmentId: activeSegment?.id ?? null, ...stack };
}
