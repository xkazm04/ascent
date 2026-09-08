"use client";

// The scene's display primitives — the ONLY way a status, a quantity, a moment or an outside-authored
// string becomes pixels in the ledger. Each binds what a call site would otherwise forget: the pill
// takes the TOKEN and owns the table; `Num` and `Elapsed` read the locale from context; `Label`
// renders text, never markup, and owns truncation and bidi isolation. The unknown-token path and the
// future-skew path report themselves from an effect, not from render.

import { useEffect, useReducer } from "react";
import { fmtElapsed, fmtMoment, fmtNumber, reportSkew, type MomentVariant, type Unit } from "./formatters";
import { useSceneLocale } from "./locale";
import { subscribe, tickerNow } from "./ticker";
import { ROLE_SLOTS, reportMiss, resolveSeverity, resolveStatus, type Locale, type Resolved } from "./vocabulary";

/** A dot that is also a glyph: never color alone. The glyph is decorative reinforcement of the label. */
function Pill({ r, category }: { r: Resolved; category: "scan-status" | "severity" }) {
  const slots = ROLE_SLOTS[r.role];
  const { known, token } = r;
  useEffect(() => {
    if (!known) reportMiss(category, token, tickerNow()); // reported in production, dev alike
  }, [known, token, category]);
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 type-caption ${slots.border} ${slots.bg} ${slots.text}`}
      data-token={token}
      data-known={known}
      data-role={r.role}
    >
      <span aria-hidden className="tabular-nums">{r.glyph}</span>
      {r.label}
    </span>
  );
}

export function StatusPill({ token, locale: override }: { token: string; locale?: Locale }) {
  return <Pill r={resolveStatus(token, useSceneLocale(override))} category="scan-status" />;
}

export function SeverityPill({ token, locale: override }: { token: string; locale?: Locale }) {
  return <Pill r={resolveSeverity(token, useSceneLocale(override))} category="severity" />;
}

/** value + unit in, one string out; the locale is bound inside. Tabular figures so digits never jitter. */
export function Num({ value, unit, locale: override }: { value: number | null | undefined; unit: Unit; locale?: Locale }) {
  const locale = useSceneLocale(override);
  return (
    <span className="type-mono-sm tabular-nums text-slate-200" data-unit={unit}>
      {fmtNumber(value, unit, locale)}
    </span>
  );
}

/**
 * Relative by default, absolute one hover away. Subscribes to the shared ticker (one timer for every
 * cell); a future instant beyond tolerance abandons relative rendering, shows the absolute moment and
 * reports the skew once.
 */
export function Elapsed({ instant, locale: override }: { instant: number; locale?: Locale }) {
  const locale = useSceneLocale(override);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe({ instant, notify: rerender }), [instant]);
  const label = fmtElapsed(instant, tickerNow(), locale);
  const skewed = label === null;
  useEffect(() => {
    if (skewed) reportSkew(instant);
  }, [skewed, instant]);
  const absolute = fmtMoment(instant, "full", locale);
  return (
    <time dateTime={new Date(instant).toISOString()} title={absolute} className={`type-caption ${skewed ? "text-warn" : "text-slate-400"}`} data-skewed={skewed}>
      {skewed ? absolute : label}
    </time>
  );
}

/** The fixed-moment primitive: one of the closed variants, locale bound inside, relative in the tooltip. */
export function Moment({ instant, variant, locale: override }: { instant: number; variant: MomentVariant; locale?: Locale }) {
  const locale = useSceneLocale(override);
  return (
    <time dateTime={new Date(instant).toISOString()} title={fmtElapsed(instant, tickerNow(), locale) ?? undefined} className="type-caption text-slate-300">
      {fmtMoment(instant, variant, locale)}
    </time>
  );
}

export const LABEL_MAX = 28;

/**
 * Outside-authored text as a text node — React escapes it; there is no markup door here at all.
 * Geometry is part of the contract: truncation with the full value in `title`, `dir="auto"` plus
 * bidi isolation so a right-to-left run cannot reorder its neighbours, no wrapping.
 */
export function Label({ text }: { text: string }) {
  const long = text.length > LABEL_MAX;
  return (
    <span
      dir="auto"
      title={long ? text : undefined}
      className="inline-block max-w-[14rem] truncate align-bottom type-mono-sm text-slate-200 [unicode-bidi:isolate]"
      data-truncated={long}
    >
      {text}
    </span>
  );
}
