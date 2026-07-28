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

/**
 * Compact "level · score" pill — the onboarding scan row and the connect repo list each hand-rolled
 * this recipe from the same LEVEL_CLASSES/LEVEL_GLYPH source (so the colour ramp and glyph never
 * drifted between them), but at two different paddings (px-2 vs px-1.5). This centralizes the shared
 * glyph+level+score composition; callers still supply their own size/spacing via `className` so each
 * site's exact prior rendering is unchanged — this is NOT the same visual contract as `LevelBadge`
 * above (that one shows the level name in a full rounded-full pill; this one is a compact score
 * readout), so it is kept as a sibling export rather than folded into `LevelBadge`.
 */
export function ScorePill({ level, overall, className = "" }: { level: LevelId; overall: number; className?: string }) {
  const lc = LEVEL_CLASSES[level] ?? LEVEL_CLASSES.L1;
  const glyph = LEVEL_GLYPH[level] ?? LEVEL_GLYPH.L1;
  return (
    <span className={`rounded border ${lc.border} ${lc.bg} ${lc.text} ${className}`}>
      <span aria-hidden>{glyph} </span>
      {level} · {overall}
    </span>
  );
}

/**
 * The "private" repo pill — byte-identical markup was hand-rolled in `connect/RepoRow.tsx` and
 * `onboarding/OnboardingSelectStep.tsx`. One implementation so the two lists can't drift.
 */
export function PrivateRepoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest text-accent ${className}`}
    >
      private
    </span>
  );
}
