import type { LevelId } from "@/lib/types";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";

/**
 * Canonical maturity-level pill — the CVD glyph + level id + name in the level's colour. One
 * implementation for the report headline and the trends header (which previously hand-rolled the
 * recipe and dropped the glyph), so the pill can't drift and always carries the non-color cue.
 */
export function LevelBadge({ id, name, className = "" }: { id: LevelId; name: string; className?: string }) {
  const lc = LEVEL_CLASSES[id];
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-base font-semibold ${lc.text} ${className}`}
    >
      <span aria-hidden>{LEVEL_GLYPH[id]}</span>
      {id} — {name}
    </span>
  );
}
