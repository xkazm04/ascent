// Single source of truth for Shared Org Memory taxonomy (Memory-as-a-Service MVP, design doc §3).
// Two small, curated, indexed enums — the same "indexed column beats a tags table for the primary
// filter" call that src/lib/org/skill-categories.ts makes; `tags` (JSON) stays the open-ended
// secondary refinement. Validated on write (createOrgMemory/updateOrgMemory) and used to drive the
// filter dropdowns + the badges. Keep both lists short and stable.
//
// `kind` separates what happened (episodic) from facts (semantic) from what worked (procedural) from
// rollups (summary) — it's the retrieval-filter dimension AND what a future consolidation job groups on.
// `visibility` lets one table hold both org-shared knowledge and author-private scratch (§4.5).

export const MEMORY_KINDS = ["episodic", "semantic", "procedural", "summary"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Human label for a kind id (the badge / dropdown text). */
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = {
  episodic: "Episodic",
  semantic: "Semantic",
  procedural: "Procedural",
  summary: "Summary",
};

/** One-line "when do I pick this?" help, shown beside the author form's kind picker. */
export const MEMORY_KIND_HINT: Record<MemoryKind, string> = {
  episodic: "What happened — an event, an incident, a decision made on a date.",
  semantic: "A durable fact about the org, its systems or its conventions.",
  procedural: "What worked — a workflow, a tool sequence, a runbook step.",
  summary: "A rollup that consolidates several other memories.",
};

export function isMemoryKind(v: string | null | undefined): v is MemoryKind {
  return typeof v === "string" && (MEMORY_KINDS as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid kind, defaulting unknown/blank to "semantic" (the schema default). */
export function normalizeMemoryKind(v: string | null | undefined): MemoryKind {
  return isMemoryKind(v) ? v : "semantic";
}

/** Label lookup with a safe humanized fallback for an unknown/legacy id (never a blank badge). */
export function memoryKindLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return (
    MEMORY_KIND_LABEL[v as MemoryKind] ??
    v.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ── Visibility ────────────────────────────────────────────────────────────────────────────────

/** `shared` = readable by every org member. `private` = readable only by its author (agent scratch). */
export const MEMORY_VISIBILITIES = ["shared", "private"] as const;

export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

export const MEMORY_VISIBILITY_LABEL: Record<MemoryVisibility, string> = {
  shared: "Shared",
  private: "Private",
};

export function isMemoryVisibility(v: string | null | undefined): v is MemoryVisibility {
  return typeof v === "string" && (MEMORY_VISIBILITIES as readonly string[]).includes(v);
}

/** Coerce arbitrary input to a valid visibility, defaulting unknown/blank to "shared" (schema default). */
export function normalizeMemoryVisibility(v: string | null | undefined): MemoryVisibility {
  return isMemoryVisibility(v) ? v : "shared";
}

// ── Confidence ────────────────────────────────────────────────────────────────────────────────

/**
 * The trust score (design doc §3) is a 0..1 float so ranking/pruning stay continuous, but a free-text
 * number is a terrible control — the UI offers these three coarse bands and stores their float. The
 * clamp below is the write-path guard for any other value (an API caller, a future agent).
 */
export const CONFIDENCE_BANDS = [
  { id: "high", value: 1.0, label: "High — verified / decided" },
  { id: "medium", value: 0.6, label: "Medium — probable, unverified" },
  { id: "low", value: 0.3, label: "Low — a hunch, needs checking" },
] as const;

/** Clamp any input to the valid 0..1 trust range, defaulting a non-finite value to 1.0 (the schema default). */
export function normalizeConfidence(v: number | null | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 1.0;
  return Math.min(1, Math.max(0, v));
}

/** The band label for a stored float — nearest band, so an API-written 0.55 still reads as "Medium". */
export function confidenceLabel(v: number): string {
  const nearest = [...CONFIDENCE_BANDS].sort(
    (a, b) => Math.abs(a.value - v) - Math.abs(b.value - v),
  )[0]!;
  return nearest.id;
}
