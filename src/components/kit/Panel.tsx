// Panel — the kit's boxed region. One radius, one hairline, one translucent fill (the Surface look),
// plus the padding steps every dashboard card reaches for. `tone="accent"` is the highlighted band
// (Fix first, callouts). Composes the brand Surface so the two can never drift; adds the data-kit hook
// the Prism stylesheet (src/app/kit.css) styles.
import { Surface } from "@/components/ui/Surface";

export type PanelPad = "none" | "sm" | "md";
const PAD: Record<PanelPad, string> = { none: "", sm: "p-5", md: "p-6" };

export function Panel({
  children,
  pad = "md",
  tone = "base",
  radius = "2xl",
  className = "",
  id,
  role,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
}: {
  children: React.ReactNode;
  /** `md` p-6 (default card), `sm` p-5 (tile-sized), `none` (table shell / custom). */
  pad?: PanelPad;
  /** `base` panel, `strong` deeper fill behind a chart, `accent` the highlighted band. */
  tone?: "base" | "strong" | "accent";
  /** `2xl` (default) or `xl` for the tighter in-band panels. */
  radius?: "xl" | "2xl";
  className?: string;
  id?: string;
  role?: React.AriaRole;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  if (tone === "accent") {
    return (
      <div
        id={id}
        role={role}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        data-kit="panel"
        data-tone="accent"
        data-role="panel"
        className={`${radius === "xl" ? "rounded-xl" : "rounded-2xl"} border border-accent/25 bg-accent/[0.04] ${PAD[pad]} ${className}`}
      >
        {children}
      </div>
    );
  }
  return (
    <Surface
      id={id}
      tone={tone}
      radius={radius}
      role={role}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      data-kit="panel"
      data-tone={tone}
      data-role="panel"
      className={`${PAD[pad]} ${className}`}
    >
      {children}
    </Surface>
  );
}
