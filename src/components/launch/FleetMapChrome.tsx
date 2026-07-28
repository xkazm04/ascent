import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { Kicker } from "@/components/ui";
import { PublicConstellation } from "./PublicConstellation";

/** The launch map's "mono metric chip" shell — ONE source for the pill geometry the header stats,
 *  the live-status pill (FleetMap), and the per-org avg badge (ConstellationField) all share. They
 *  previously hand-rolled the same border/bg class string three ways with drifting padding/color
 *  handling; a border/theme tweak now lands here once. `size` covers the two densities in use. */
export function Pill({
  size = "md",
  className = "",
  ...rest
}: ComponentPropsWithoutRef<"span"> & { size?: "sm" | "md" }) {
  return (
    <span
      className={`rounded-full border border-slate-700 bg-slate-900/60 ${size === "sm" ? "px-2 py-0.5" : "px-3 py-1"} ${className}`}
      {...rest}
    />
  );
}

/** The launch map's metric chip. Deliberately NOT the brand `ui/Stat`: this is a horizontal pill where
 *  the value and its label share ONE line inside the Pill chrome, so a dozen of them wrap as a chip
 *  row. `ui/Stat` is a two-line block in both of its variants (label-over-value, or value-over-caption);
 *  there is no version of it that is this shape, and adding an inline mode would be a third layout
 *  bolted onto a primitive whose whole job is the stacked one. Keep this local. */
export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Pill className="text-slate-400">
      {/* text-white keeps the fallback in token-land (was a hardcoded #fff literal). */}
      <span
        className={`font-mono text-base font-bold tabular-nums${color ? "" : " text-white"}`}
        style={color ? { color } : undefined}
      >
        {value}
      </span>{" "}
      <span className="font-mono uppercase tracking-widest text-sm">{label}</span>
    </Pill>
  );
}

export function EmptyFleet() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      {/* Was a 4xl 🛰️ — the one off-tone element in an instrument-grade product, and the only emoji
          on the page. Replaced with a small, static rendering of the very thing the empty state is
          promising: the constellation itself, drawn by the same pure helpers the live map uses. It
          shows what connecting GitHub buys you instead of decorating the absence of it. */}
      <div aria-hidden className="mx-auto h-20 w-20 opacity-60">
        <PublicConstellation count={12} />
      </div>
      <Kicker className="mt-4" tone="muted">
        Fleet map
      </Kicker>
      <h2 className="mt-1 text-lg font-semibold text-white">No constellations yet</h2>
      <p className="mx-auto mt-1 max-w-md text-base text-slate-400">
        Install the Ascent GitHub App on an organization or account and your repositories will appear here as a
        star-map of maturity.
      </p>
      <Link
        href="/connect"
        className="focus-ring mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 text-base font-semibold text-on-accent transition hover:bg-accent-soft"
      >
        Connect GitHub →
      </Link>
    </div>
  );
}
