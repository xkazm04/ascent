// The four things a technique has to say, as separate blocks so a layout can place them where it
// wants: the drawer stacks all four in a column, the Console band puts prose left and source right,
// the Dossier switches between them. No hooks — the frame owns the selection; these are readers.
//
// Extracted from SurfaceDrawer during the 3-row prototype round (2026-09-06) rather than copied
// into each variant: the four blocks are the same content in every layout, and a tweak to the
// source block should not have to be made three times.

import { Kicker } from "@/components/ui";
import type { SurfaceTechnique } from "./surfaceBody";

export function MechanismBlock({ technique }: { technique: SurfaceTechnique }) {
  return (
    <section className="space-y-1.5">
      <Kicker tone="muted">Mechanism</Kicker>
      <p className="type-body-sm text-slate-300">{technique.mechanism}</p>
    </section>
  );
}

export function SourceBlock({ technique, className = "" }: { technique: SurfaceTechnique; className?: string }) {
  return (
    <section className={`space-y-1.5 ${className}`}>
      <Kicker tone="muted">Source</Kicker>
      <pre className="max-h-80 overflow-auto rounded-lg border border-divider bg-surface-strong/40 p-3 type-caption leading-relaxed text-slate-300">
        <code>{technique.source}</code>
      </pre>
    </section>
  );
}

export function InAscentBlock({ technique }: { technique: SurfaceTechnique }) {
  return (
    <section className="space-y-1.5">
      <Kicker tone="muted">In Ascent</Kicker>
      {technique.inAscent ? (
        <>
          <p className="type-caption text-accent">{technique.inAscent.file}</p>
          <p className="type-body-sm text-slate-300">{technique.inAscent.note}</p>
        </>
      ) : (
        <p className="type-body-sm text-slate-500">No realization in Ascent yet — this scene is the first.</p>
      )}
    </section>
  );
}

export function DeviationBlock({ technique }: { technique: SurfaceTechnique }) {
  return (
    <section className="space-y-1.5">
      <Kicker tone="muted">Deviation</Kicker>
      {technique.deviation ? (
        <p className="type-body-sm text-warn">{technique.deviation}</p>
      ) : (
        <p className="type-body-sm text-slate-500">None recorded.</p>
      )}
    </section>
  );
}

/** The technique's identity line — its title and slug, above whichever blocks a layout shows. */
export function TechniqueIdentity({ technique, index }: { technique: SurfaceTechnique; index: number }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="type-caption tabular-nums text-accent">{String(index + 1).padStart(2, "0")}</span>
      <h3 className="type-title font-semibold text-white">{technique.title}</h3>
      <span className="type-caption text-slate-500">{technique.slug}</span>
    </div>
  );
}
