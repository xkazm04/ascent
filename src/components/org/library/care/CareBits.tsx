"use client";

// Small shared pieces every Care variant needs. Hoisted here the moment the second variant wanted
// them (prototype rule: shared structure moves out immediately, not at refactor time).

import { chipButtonClass, Kicker } from "@/components/ui";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";
import type { LevelId } from "@/lib/types";
import {
  CARE_CATEGORY_LABEL,
  type CareMoveCategory,
  type CareMoveState,
} from "@/lib/org/care-view";

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
      className="focus-ring rounded text-sm text-accent underline decoration-dotted underline-offset-4 transition-colors hover:text-white"
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
    <span className={`rounded-full border px-2 py-0.5 font-mono text-xs uppercase tracking-widest ${STATE_CLASS[state]}`}>
      {CARE_STATE_LABEL[state]}
    </span>
  );
}

export function CareCategoryChip({ category }: { category: CareMoveCategory }) {
  return (
    <span className="rounded-full border border-divider px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-slate-500">
      {CARE_CATEGORY_LABEL[category]}
    </span>
  );
}

/** Minutes/week rendered as the mentor's own unit — honest em-dash when nothing was quantified. */
export function CareSaving({ minutes, className = "" }: { minutes: number | null | undefined; className?: string }) {
  if (minutes == null) return <span className={`font-mono text-sm text-slate-600 ${className}`}>unquantified</span>;
  const h = minutes / 60;
  return (
    <span className={`font-mono text-sm tabular-nums text-slate-300 ${className}`}>
      {h >= 1 ? `${h.toFixed(1)} h/wk` : `${minutes} min/wk`}
    </span>
  );
}

/** A repo's level as its ramp colour — the one place level colour is allowed (BRAND principle 3). */
export function CareLevelMark({ level, score }: { level: string | null; score: number | null }) {
  const hex = level && level in LEVEL_HEX ? LEVEL_HEX[level as LevelId] : score != null ? scoreHex(score) : undefined;
  return (
    <span className="font-mono text-sm tabular-nums" style={hex ? { color: hex } : undefined}>
      {level ?? "—"}
      {score != null ? <span className="text-slate-500"> · {score}</span> : null}
    </span>
  );
}

/**
 * The standing promise, rendered wherever shared data is shown. Not decoration: the whole UC3 design
 * rests on the developer believing it, so it is stated in the surface rather than in a docs page.
 */
export function CarePrivacyNote({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-sm text-slate-500">
      {children ?? "Only what you chose to share is here. Transcripts, prompts and diffs never leave your machine."}
    </p>
  );
}

/** The fixture stamp — a prototype must never be mistaken for someone's real reflection. */
export function CareFixtureChip({ demo }: { demo?: string }) {
  if (!demo) return null;
  return (
    <span className="rounded-full border border-warn/40 px-2 py-0.5 font-mono text-xs uppercase tracking-widest text-warn">
      fixture · {demo}
    </span>
  );
}

/** A labelled section eyebrow used inside the variants' own chrome. */
export function CareEyebrow({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Kicker>{children}</Kicker>
      {right}
    </div>
  );
}
