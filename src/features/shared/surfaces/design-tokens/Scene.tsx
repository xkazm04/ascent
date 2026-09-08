"use client";

// The design-tokens showcase: an appearance panel for a FICTIONAL org's theme. The scene root is the
// scope root: `scopeVars()` generates every `--sx-*` custom property from tokens.ts and
// motionLadder.ts, the preview card at the top consumes role names only, and each technique's
// region rebinds part of the root (theme, density, text scale) or gates it (parity, enforcement,
// admission). `reduced` and `volume` come from props; the ladder is rebound at the root, never
// checked per component, and nothing here runs its own media query.

import { useState, type CSSProperties } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { AxesRegion } from "./AxesPanel";
import { EnforcementRegion } from "./EnforcementPanel";
import { MotionRegion } from "./MotionPanel";
import { ParityRegion } from "./ParityPanel";
import { Preview } from "./Preview";
import { TaxonomyRegion } from "./TaxonomyPanel";
import { ThemeRegion } from "./ThemePanel";
import { motionVars } from "./motionLadder";
import { resolveTheme, scopeVars, type ColorRole, type Density, type Preference, type TextScale, type ThemeId } from "./tokens";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const [pref, setPref] = useState<Preference>("system");
  const [platform, setPlatform] = useState<ThemeId>("dark");
  const [density, setDensity] = useState<Density>("comfortable");
  const [scale, setScale] = useState<TextScale>(1);
  const [dropped, setDropped] = useState<ColorRole | null>(null);
  const theme = resolveTheme(pref, platform);
  const vars = scopeVars({ theme, density, scale, dropped: dropped ? { theme: "light", role: dropped } : null }, motionVars(reduced));

  return (
    <div className="space-y-3" data-scene="design-tokens" data-reduced={reduced} data-theme={theme} data-density={density} data-scale={scale} style={vars as CSSProperties}>
      <p className="type-caption text-slate-500">
        Fixture data: one fictional theme, <span className="text-slate-300">{volume.toLocaleString()}</span> fictional source files for the gate, seeded. Nothing here is an Ascent org or an Ascent file.
      </p>
      <Preview theme={theme} density={density} />
      <TaxonomyRegion />
      <div className="grid gap-3 lg:grid-cols-2">
        <ThemeRegion pref={pref} platform={platform} dropped={dropped} onPref={setPref} onPlatform={setPlatform} onDrop={setDropped} />
        <AxesRegion density={density} scale={scale} onDensity={setDensity} onScale={setScale} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ParityRegion />
        <MotionRegion reduced={reduced} />
      </div>
      <EnforcementRegion volume={volume} />
    </div>
  );
}
