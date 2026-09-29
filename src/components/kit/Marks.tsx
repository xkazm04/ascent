// Small identity marks: SpectralRule (the nine-hue rule, the one decorative use of the spectrum) and
// HonestyTag (`Illustrative` on an invented figure, `Stylised` on drawn art; amber, mono, the one non-spectral
// saturated chip). Rule: any figure the surface did not measure carries a tag.

/** A 2-4px rule. `dimensions` limits it to the hues that name something on this surface. */
export function SpectralRule({ thickness = 2, className = "", dimensions }: { thickness?: 2 | 3 | 4; className?: string; dimensions?: readonly number[] }) {
  const stops = dimensions?.length ? dimensions.map((d) => `var(--spec-${d}, var(--color-accent))`) : null;
  const style = stops ? { background: `linear-gradient(90deg, ${stops.join(", ")})` } : undefined;
  return (
    <span
      aria-hidden
      data-kit="spectral-rule"
      data-role="spectral-rule"
      style={{ height: thickness, ...style }}
      className={`block w-full rounded-full ${className}`}
    />
  );
}

export type HonestyKind = "illustrative" | "stylised";
const LABEL: Record<HonestyKind, string> = { illustrative: "Illustrative", stylised: "Stylised" };

export function HonestyTag({ kind = "illustrative", className = "" }: { kind?: HonestyKind; className?: string }) {
  return (
    <span
      data-kit="honesty-tag"
      data-kind={kind}
      data-role="honesty-tag"
      className={`inline-block rounded-[2px] bg-[#f2c14e] px-[7px] py-[2px] align-middle font-mono text-[12px] uppercase tracking-[0.06em] text-[#07080c] ${className}`}
    >
      {LABEL[kind]}
    </span>
  );
}
