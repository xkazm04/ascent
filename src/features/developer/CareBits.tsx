"use client";

// The small pieces the Developer page's sections share: the unwired action buttons, the move chips,
// the saving/level readouts and the preview stamp.
//
// `CarePrivacyNote` used to live here — one sentence ("Transcripts, prompts and diffs never leave
// your machine") rendered wherever shared data was shown. It is gone because the guarantee is now
// DRAWN: `CarePrivacyLedger` gives those rows a void in both columns, and a test fails if any of
// them ever acquires a mark. A promise a reader has to take on trust was the weaker artifact.

import { chipButtonClass } from "@/components/ui";
import { StateSwatch } from "@/components/org/viz";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import {
  CARE_CATEGORY_LABEL,
  type CareMoveCategory,
  type CareMoveState,
} from "@/lib/org/developer-view";

// Extracted to keep this file inside the 200-LOC `src/features/**` cap (AGENTS.md); re-exported here
// so `./CareBits` stays the one import site for the small shared Care pieces.
export { CareCommand, CareCopyAction } from "./CareCopyAction";

/**
 * The one action button for the prototype. Every Care action (Share, Promote, Mark kept/dropped,
 * Install mentor) is a real affordance with no server behind it yet, so it logs its intent — that is
 * deliberately visible rather than a dead `<button>` the user cannot tell is unwired.
 */
export function CareAction({
  label,
  intent,
  payload,
  tone = "idle",
  className = "",
}: {
  label: React.ReactNode;
  intent: string;
  payload?: Record<string, unknown>;
  tone?: "idle" | "success" | "danger";
  className?: string;
}) {
  return (
    <button
      type="button"
      className={chipButtonClass(tone, className)}
      onClick={() => console.info(`[care] ${intent}`, payload ?? {})}
    >
      {label}
    </button>
  );
}

/** A bare text action for dense rows where a bordered chip would be too loud. */
export function CareLinkAction({ label, intent, payload }: { label: string; intent: string; payload?: Record<string, unknown> }) {
  return (
    <button
      type="button"
      className="focus-ring rounded type-body-sm text-accent underline decoration-dotted underline-offset-4 transition-colors hover:text-white"
      onClick={() => console.info(`[care] ${intent}`, payload ?? {})}
    >
      {label}
    </button>
  );
}

/** The move-state chip. Accent for what is live, muted for what is settled. */
const STATE_CLASS: Record<CareMoveState, string> = {
  proposed: "border-slate-700 text-slate-400",
  trying: "border-accent/60 text-accent",
  kept: "border-success/50 text-success-soft",
  dropped: "border-slate-800 text-slate-600",
};

export const CARE_STATE_LABEL: Record<CareMoveState, string> = {
  proposed: "Proposed",
  trying: "Trying",
  kept: "Kept",
  dropped: "Dropped",
};

export function CareStateChip({ state }: { state: CareMoveState }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 type-label tracking-widest ${STATE_CLASS[state]}`}>
      {CARE_STATE_LABEL[state]}
    </span>
  );
}

export function CareCategoryChip({ category }: { category: CareMoveCategory }) {
  return (
    <span className="rounded-full border border-divider px-2 py-0.5 type-label tracking-widest text-slate-500">
      {CARE_CATEGORY_LABEL[category]}
    </span>
  );
}

/** Minutes/week rendered as the mentor's own unit — honest em-dash when nothing was quantified. */
export function CareSaving({ minutes, className = "" }: { minutes: number | null | undefined; className?: string }) {
  if (minutes == null) return <span className={`type-mono-sm text-slate-600 ${className}`}>unquantified</span>;
  const h = minutes / 60;
  return (
    <span className={`type-mono-sm tabular-nums text-slate-300 ${className}`}>
      {h >= 1 ? `${h.toFixed(1)} h/wk` : `${minutes} min/wk`}
    </span>
  );
}

/**
 * A repo's level as its ramp colour — the one place level colour is allowed (BRAND principle 3).
 *
 * A repo with no scan has no standing to print, and a bare "—" was indistinguishable from a score we
 * had simply not rendered. It now draws the `missing` void, whose title says which absence it is.
 */
export function CareLevelMark({ level, score }: { level: string | null; score: number | null }) {
  if (level == null && score == null) {
    return (
      <span className="flex shrink-0 items-center gap-1.5" title="Never scanned — no level and no score exist for this repo yet. Not a zero.">
        <StateSwatch state="missing" size={12} />
        <span className="type-label tracking-widest text-slate-600">no scan</span>
      </span>
    );
  }
  const hex = level && level in LEVEL_HEX ? LEVEL_HEX[level as LevelId] : score != null ? scoreHex(score) : undefined;
  return (
    <span className="type-mono-sm tabular-nums" style={hex ? { color: hex } : undefined}>
      {level ?? "—"}
      {score != null ? <span className="text-slate-500"> · {score}</span> : null}
    </span>
  );
}

/** The preview stamp — a fixture must never be mistaken for someone's real reflection. */
export function CareFixtureChip({ demo }: { demo?: string }) {
  if (!demo) return null;
  return (
    <span className="rounded-full border border-warn/40 px-2 py-0.5 type-label tracking-widest text-warn">
      preview · {demo}
    </span>
  );
}
