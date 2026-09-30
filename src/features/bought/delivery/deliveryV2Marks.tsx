// Shared Prism marks for Delivery: unknown is a void, status is a glyph and a word, the number stays paper.
import type { ReactNode } from "react";
import { VoidMark, type MastheadTone } from "@/components/kit";

const GLYPH: Record<MastheadTone, string> = { good: "✓", watch: "◆", risk: "▲" };
const WORD: Record<MastheadTone, string> = { good: "Healthy", watch: "Watch", risk: "At risk" };

/** Same rounding as `fmtHours` in the org ui constants, without importing that module. */
export function hoursLabel(h: number | null): string | null {
  if (h == null) return null;
  return h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`;
}

export function Unknown({ label = "not measured", subject }: { label?: string; subject?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <VoidMark subject={subject} label={label} />
      <span aria-hidden className="text-slate-400">
        {label}
      </span>
    </span>
  );
}

export function Toned({ tone, children }: { tone?: MastheadTone; children: ReactNode }) {
  if (!tone) return <>{children}</>;
  return (
    <>
      <span className="sr-only">{WORD[tone]}: </span>
      <span aria-hidden className="mr-1 align-middle text-[0.55em]">
        {GLYPH[tone]}
      </span>
      {children}
    </>
  );
}

export function pct(rate: number | null, tone?: MastheadTone) {
  if (rate == null) return <Unknown />;
  return <Toned tone={tone}>{rate}%</Toned>;
}

/** At or above the target is healthy. Below it is watch, not an alarm hue. */
export function coverageTone(rate: number | null, target: number): MastheadTone | undefined {
  if (rate == null) return undefined;
  return rate >= target ? "good" : "watch";
}

/** A guardrail that should cover the fleet. Anything under 100% is a gap. */
export function fullTone(rate: number | null): MastheadTone | undefined {
  if (rate == null) return undefined;
  return rate >= 100 ? "good" : "risk";
}
