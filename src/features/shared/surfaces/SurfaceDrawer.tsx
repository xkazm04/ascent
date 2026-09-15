// The mechanism drawer for the selected technique: Mechanism (prose), Source (the excerpt of the
// scene code, in a <pre>), In Ascent (the real file + note, or the honest absence) and Deviation
// (where Ascent falls short, or "none recorded"). Right of the canvas on ≥lg, a bottom sheet below.
// No hooks — the frame owns the selection; this is a reader.

import { Kicker, Surface } from "@/components/ui";
import type { SurfaceTechnique } from "./surfaceBody";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <Kicker tone="muted">{label}</Kicker>
      {children}
    </section>
  );
}

export function SurfaceDrawer({ technique }: { technique: SurfaceTechnique | null }) {
  if (!technique) {
    return (
      <Surface radius="xl" className="p-5" data-surface-drawer="empty">
        <Kicker tone="muted">Mechanism</Kicker>
        <p className="mt-2 type-body-sm text-slate-500">Pick a technique from the rail to spotlight its region and read how it is built.</p>
      </Surface>
    );
  }
  return (
    <Surface radius="xl" className="space-y-5 p-5" data-surface-drawer={technique.slug} aria-label={`Mechanism: ${technique.title}`}>
      <div>
        <Kicker>Technique</Kicker>
        <h3 className="mt-1 type-title font-semibold text-white">{technique.title}</h3>
        <p className="type-caption text-slate-500">{technique.slug}</p>
      </div>
      <Section label="Mechanism">
        <p className="type-body-sm text-slate-300">{technique.mechanism}</p>
      </Section>
      <Section label="Source">
        <pre className="max-h-72 overflow-auto rounded-lg border border-divider bg-surface-strong/40 p-3 type-caption leading-relaxed text-slate-300">
          <code>{technique.source}</code>
        </pre>
      </Section>
      <Section label="In Ascent">
        {technique.inAscent ? (
          <>
            <p className="type-caption text-accent">{technique.inAscent.file}</p>
            <p className="type-body-sm text-slate-300">{technique.inAscent.note}</p>
          </>
        ) : (
          <p className="type-body-sm text-slate-500">No realization in Ascent yet — this scene is the first.</p>
        )}
      </Section>
      <Section label="Deviation">
        {technique.deviation ? (
          <p className="type-body-sm text-warn">{technique.deviation}</p>
        ) : (
          <p className="type-body-sm text-slate-500">None recorded.</p>
        )}
      </Section>
    </Surface>
  );
}
