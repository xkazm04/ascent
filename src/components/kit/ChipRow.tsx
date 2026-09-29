// ChipRow — a wrapping row of small status/filter chips. A Chip is a hairline pill; `tone` is meaning
// (status colours), `dimension` (1..9) is the only place the Spectral Nine may colour a chip.
export type ChipTone = "neutral" | "success" | "warn" | "danger" | "accent";
const TONE: Record<ChipTone, string> = {
  neutral: "border-slate-700 text-slate-300",
  success: "border-success/40 bg-success/10 text-success-soft",
  warn: "border-warn/40 bg-warn/10 text-amber-300",
  danger: "border-danger/40 bg-danger/10 text-danger-soft",
  accent: "border-accent/40 bg-accent/5 text-accent",
};

export function ChipRow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-kit="chip-row" data-role="chip-row" className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {children}
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  dimension,
  title,
}: {
  children: React.ReactNode;
  tone?: ChipTone;
  /** 1..9, one per maturity dimension D1..D9: tints the chip with that dimension's spectral hue (Prism only). */
  dimension?: number;
  title?: string;
}) {
  return (
    <span
      data-kit="chip"
      data-role="chip"
      data-dimension={dimension}
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 type-mono-sm ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
