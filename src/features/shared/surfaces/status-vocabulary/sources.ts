// Source excerpts for the mechanism drawer — verbatim from this scene's own files (vocabulary.ts,
// formatters.ts, ticker.ts, primitives.tsx and the panels). String constants so the drawer needs no
// build step; when the code moves, these move with it in the same commit.

export const SRC_CHAIN = `// vocabulary.ts — layer 2 is the authority; 1, 3 and 4 derive from it under a gate
export type ScanStatus = "queued" | "running" | "passed" | "warned" | "failed" | "cancelled";
export const SCAN_STATUS_PRESENTATION: Record<ScanStatus, Presentation> = { /* keyed by the union */ };
type Covers<Labels, Union extends string> = [Exclude<Union, keyof Labels>] extends [never]
  ? true : { MISSING_LABELS_FOR: Exclude<Union, keyof Labels> };
const _coversEn: Covers<typeof EN, LabelKey> = true;   // the build error NAMES the missing keys
// derivations AFTER the gate: the member list from the gated map's keys, the constraint mirrored from it
export const SCAN_STATUS_MEMBERS = Object.keys(SCAN_STATUS_PRESENTATION) as ScanStatus[];
export const STORAGE_CHECK = \`CHECK (status IN (\${SCAN_STATUS_MEMBERS.map((m) => \`'\${m}'\`).join(", ")}))\`;
// ordering as a TOTAL MAP, never an array; the unknown rank is a decision
export const SCAN_STATUS_RANK: Record<ScanStatus, number> = { failed: 0, warned: 1, running: 2, queued: 3, cancelled: 4, passed: 5 };
export const rankOf = (token: string) => (isScanStatus(token) ? SCAN_STATUS_RANK[token] : UNKNOWN_RANK);
// the total resolver — honest degradation, and \`known\` lets the primitive report the miss in production
export function resolveStatus(token: string, locale: Locale): Resolved {
  const p = isScanStatus(token) ? SCAN_STATUS_PRESENTATION[token] : SCAN_STATUS_UNKNOWN;
  return { ...p, label: CATALOG[locale][p.labelKey], known: isScanStatus(token), token };
}
// primitives.tsx — the pill reports the miss from an effect, dev and production alike
useEffect(() => { if (!known) reportMiss(category, token, tickerNow()); }, [known, token, category]);`;

export const SRC_COLOR = `// vocabulary.ts — vocabulary → role → themed slot set; the call site never sees the third link
export const ROLE_SLOTS: Record<Role, { text; border; bg; dot }> = {
  success: { text: "text-success-soft", border: "border-success/40", bg: "bg-success/10", dot: "bg-success" },
  warning: { text: "text-warn", border: "border-warn/40", bg: "bg-warn/10", dot: "bg-warn" },
  …
};
// ONE table per vocabulary: role + glyph + label key in one entry, keyed by the union
export const SCAN_STATUS_PRESENTATION: Record<ScanStatus, Presentation> = {
  passed: { role: "success", glyph: "●", labelKey: "status.passed" },
  failed: { role: "danger",  glyph: "✕", labelKey: "status.failed" }, …
};
// the unknown direction, decided per vocabulary and written beside the fallback
export const SCAN_STATUS_UNKNOWN: Presentation = { role: "neutral", glyph: "?", labelKey: "status.unknown" }; // a STATE set: calm is honest
export const SEVERITY_UNKNOWN:    Presentation = { role: "danger",  glyph: "▲", labelKey: "severity.unknown" }; // a SEVERITY set: most severe
// primitives.tsx — the pill takes the TOKEN and owns the table; the glyph rides beside the label
<span className={\`… \${slots.border} \${slots.bg} \${slots.text}\`} data-token={token} data-known={known}>
  <span aria-hidden>{r.glyph}</span>{r.label}
</span>`;

export const SRC_NUMBER = `// locale.ts — the primitive binds the locale from context; no call site passes one
export function useSceneLocale(override?: Locale): Locale { return override ?? useContext(LocaleContext); }
// formatters.ts — one renderer; the ladder, the unit and the three facts live here, once; formatters cached
const NUMBER_OPTIONS: Record<Unit, Intl.NumberFormatOptions> = {
  usd: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
  percent: { style: "percent", maximumFractionDigits: 1 },
  compact: { notation: "compact", maximumFractionDigits: 1 },   // a numbering system, not a suffix
  count: { maximumFractionDigits: 0 },
};
export function fmtNumber(value: number | null | undefined, unit: Unit, locale: Locale): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;                       // absent → placeholder
  const f = numberFormatter(unit, locale);                                            // module-scope cache
  if (unit === "usd" && value !== 0 && Math.abs(value) < MONEY_FLOOR)                // zero stays zero
    return \`<\${f.format(Math.sign(value) * MONEY_FLOOR)}\`;                           // sub-unit → guard
  return f.format(value);
}
// primitives.tsx
export function Num({ value, unit }) { const locale = useSceneLocale(); return <span …>{fmtNumber(value, unit, locale)}</span>; }`;

export const SRC_TIME = `// ticker.ts — one timer for every cell, cadence keyed on the youngest label, stops at zero subscribers
export function cadenceForAge(ageMs) { return ageMs < 60_000 ? 1_000 : ageMs < 3_600_000 ? 30_000 : 300_000; }
function schedule() {
  if (paused || subs.size === 0) return stop();
  const want = cadenceForAge(youngestAge());
  if (timer && want === cadence) return;          // restart only when the target cadence changes
  stop(); cadence = want; timer = setInterval(tick, cadence);
}
// formatters.ts — the platform's vocabulary; small skew clamps to now, large skew abandons relative
export function fmtElapsed(instant, now, locale): string | null {
  let diff = instant - now;
  if (diff > FUTURE_SKEW_TOLERANCE_MS) return null;
  if (diff > 0) diff = 0;
  for (const [unit, ms] of RUNGS) if (Math.abs(diff) >= ms) return relativeFormatter(locale).format(Math.round(diff / ms), unit);
  return relativeFormatter(locale).format(0, "second");
}
// primitives.tsx — relative by default, absolute in the title; a null label shows the moment and reports once
useEffect(() => subscribe({ instant, notify: rerender }), [instant]);
const label = fmtElapsed(instant, tickerNow(), locale); const skewed = label === null;
useEffect(() => { if (skewed) reportSkew(instant); }, [skewed, instant]);
<time title={absolute} data-skewed={skewed}>{skewed ? absolute : label}</time>`;

export const SRC_LABEL = `// primitives.tsx — a text node (React escapes it); there is no markup door in this scene at all.
// Geometry is the primitive's: truncation with the full value in title, dir="auto" + bidi isolation.
export function Label({ text }: { text: string }) {
  const long = text.length > LABEL_MAX;
  return (
    <span dir="auto" title={long ? text : undefined}
          className="inline-block max-w-[14rem] truncate … [unicode-bidi:isolate]" data-truncated={long}>
      {text}
    </span>
  );
}
// Ledger.tsx — content and vocabulary in different columns; the pill keys on the token, never the name
<td><Label text={r.repo} /></td>
<td><StatusPill token={r.status} /></td>`;

export const SRC_EVOLUTION = `// TextPanel.tsx — what a user sees when a competent person did three of the four
export function previewFor(done: readonly boolean[]) {
  if (!done[1] || !done[3]) return { text: "retrying", …neutral, verdict: "a bare string crossed the wire: the unknown path renders it" };
  if (!done[2])             return { text: "—", …danger,   verdict: "the type allows what storage rejects: the write fails" };
  if (!done[4])             return { text: "retrying", …info, verdict: "no catalog entry: the raw token ships, in every language at once" };
  if (!done[5])             return { text: "Retrying", className: "", verdict: "no presentation entry: a colourless pill (Record<Union,…> refuses to compile)" };
  return { text: "◔ Retrying", …info, verdict: done[6] ? "all four layers in one change" : "renders — but the fallback direction was not re-checked" };
}
// rename = a label change: edit CATALOG["en-US"]["status.warned"]; the token never moves
// retire = top-down: consumers first, authority last — deleting the label first ships the unknown path`;
