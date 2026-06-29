import type { LevelId } from "@/lib/types";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";

/**
 * Canonical maturity-level pill — the CVD glyph + level id + name in the level's colour. One
 * implementation for the report headline and the trends header (which previously hand-rolled the
 * recipe and dropped the glyph), so the pill can't drift and always carries the non-color cue.
 */
export function LevelBadge({ id, name, className = "" }: { id: LevelId; name: string; className?: string }) {
  // `id` is cast from a persisted DB string at the call sites (trends header), so a drifted/empty
  // stored level (e.g. "" — which parseRepositoryHistory can emit) would make LEVEL_CLASSES[id]
  // undefined and crash the whole page on `lc.border`. Fall back to L1 like the hardened sibling
  // visuals (QUAD_TINT[id] ?? …) instead of white-screening trends on one bad row.
  const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1;
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-base font-semibold ${lc.text} ${className}`}
    >
      <span aria-hidden>{LEVEL_GLYPH[id] ?? LEVEL_GLYPH.L1}</span>
      {id} — {name}
    </span>
  );
}
