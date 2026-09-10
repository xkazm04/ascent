// Persisted Context Health is untrusted JSON. Keep its read boundary browser-safe:
// the same parser feeds server aggregates and client-side context projections.
import type { ContextHealth } from "@/lib/types";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function score(value: unknown): value is number {
  return nonNegative(value) && value <= 100;
}
function count(value: unknown): value is number {
  return nonNegative(value) && Number.isInteger(value);
}
function optionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
function contextFile(value: unknown): boolean {
  return record(value) && typeof value.path === "string" && score(value.sectionsScore)
    && optionalText(value.lastModifiedAt) && optionalText(value.lastCommitSha)
    && (value.bytes === undefined || nonNegative(value.bytes));
}
function contextHealth(value: unknown): value is ContextHealth {
  if (!record(value) || typeof value.version !== "string" || typeof value.present !== "boolean"
    || !score(value.score) || !Array.isArray(value.files) || !value.files.every(contextFile)) return false;
  const { freshness: f, quality: q, drift: d } = value;
  if (!record(f) || !record(q) || !record(d)) return false;
  return (f.score === null || score(f.score))
    && (f.ageDays === null || nonNegative(f.ageDays))
    && (f.commitsSinceEdit === null || nonNegative(f.commitsSinceEdit))
    && typeof f.approximate === "boolean"
    && (f.windowCapped === undefined || typeof f.windowCapped === "boolean")
    && score(q.score) && Array.isArray(q.signals) && q.signals.every(s => typeof s === "string")
    && score(d.score) && count(d.refsTotal) && Array.isArray(d.deadRefs)
    && d.deadRefs.every(r => typeof r === "string") && d.deadRefs.length <= d.refsTotal
    && (d.deadRefsTotal === undefined || (count(d.deadRefsTotal)
      && d.deadRefsTotal >= d.deadRefs.length && d.deadRefsTotal <= d.refsTotal));
}

/** Null means unassessed, including malformed nested rows. Legacy absent totals remain readable. */
export function parseContextHealthJson(raw: string | null | undefined): ContextHealth | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return contextHealth(value) ? value : null;
  } catch {
    return null;
  }
}
