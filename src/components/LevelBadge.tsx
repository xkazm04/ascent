import type { LevelId } from "@/lib/types";
import { LEVEL_CLASSES, LEVEL_GLYPH } from "@/lib/ui";

/**
 * Canonical maturity-level pill — the CVD glyph + level id + name in the level's colour. One
 * implementation for the report headline and the trends header (which previously hand-rolled the
 * recipe and dropped the glyph), so the pill can't drift and always carries the non-color cue.
 */
export function LevelBadge({ id, name, className = "" }: { id: LevelId; name: string; className?: string }) {
  // Clamp drift to L1, mirroring levelIndex's "unrecognized id → L1" contract: callers force-cast a
  // stored history string to LevelId (e.g. trends), so a legacy/hand-edited id outside L1–L5 would
  // otherwise leave lc/glyph undefined and crash on `lc.border` (white-screen the trends header).
  const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1;
  const glyph = LEVEL_GLYPH[id] ?? LEVEL_GLYPH.L1;
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-base font-semibold ${lc.text} ${className}`}
    >
      <span aria-hidden>{glyph}</span>
      {id} — {name}
    </span>
  );
}
