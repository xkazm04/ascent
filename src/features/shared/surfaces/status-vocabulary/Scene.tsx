"use client";

// The status-vocabulary showcase: a fleet scan ledger whose every cell crosses the value→presentation
// boundary through one primitive, with six regions beneath it — one per technique of the registry's
// `status-vocabulary` subject, each carrying data-technique="<slug>" for the frame to spotlight —
// holding the controls the ledger reacts to. `reduced` and `volume` come from props (the ticker starts
// paused under `reduced`); the viewer's locale lives in one context the primitives read.

import { useMemo, useState } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { ChainRegion, ColorRegion } from "./ChainPanel";
import { rowsFor, SKEW_ROW, WINDOW, type ScanRow } from "./fixtures";
import { NumberRegion, TimeRegion } from "./FormatPanel";
import { Ledger } from "./Ledger";
import { LocaleContext } from "./locale";
import { EvolutionRegion, LabelRegion } from "./TextPanel";
import { rankOf, type Locale } from "./vocabulary";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const [locale, setLocale] = useState<Locale>("en-US");
  const [renamed, setRenamed] = useState<string | null>(null);
  const [skew, setSkew] = useState(false);
  const [worstFirst, setWorstFirst] = useState(false);
  const [noColor, setNoColor] = useState(false);
  // The one clock read: fixtures are offsets from this instant, so labels are stable at mount.
  const [mountedAt] = useState(() => Date.now());

  // The volume knob sizes the fleet; the ledger shows a window of it (this is not a data-display
  // subject, so the knob only proves the primitives are indifferent to how many rows exist).
  const base = useMemo(() => rowsFor(volume), [volume]);
  const rows = useMemo(() => {
    const window = base.slice(0, WINDOW).map((r, i) => (i === 0 && renamed !== null ? { ...r, repo: renamed } : r));
    if (skew) window.unshift(SKEW_ROW);
    return worstFirst ? [...window].sort((a, b) => rankOf(a.status) - rankOf(b.status)) : window;
  }, [base, renamed, skew, worstFirst]);
  const instantOf = (r: ScanRow) => mountedAt - r.finishedOffsetS * 1000;
  const name = renamed ?? base[0]?.repo ?? "";

  return (
    <LocaleContext.Provider value={locale}>
      <div className="space-y-3" data-scene="status-vocabulary" data-reduced={reduced}>
        <p className="type-caption text-slate-500">
          Fixture data: <span className="text-slate-300">{volume.toLocaleString("en-US")}</span> fictional scan rows, seeded; showing {WINDOW}
          {skew ? " + 1 skewed" : ""}. Nothing here is an Ascent org.
        </p>
        <Ledger rows={rows} instantOf={instantOf} noColor={noColor} reduced={reduced} />
        <div className="grid gap-3 lg:grid-cols-2">
          <ChainRegion skew={skew} onSkew={setSkew} worstFirst={worstFirst} onWorstFirst={setWorstFirst} />
          <ColorRegion noColor={noColor} onNoColor={setNoColor} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <NumberRegion locale={locale} onLocale={setLocale} />
          <TimeRegion reduced={reduced} mountedAt={mountedAt} skewInstant={instantOf(SKEW_ROW)} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <LabelRegion name={name} onRename={setRenamed} />
          <EvolutionRegion />
        </div>
      </div>
    </LocaleContext.Provider>
  );
}
