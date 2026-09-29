// Dev-only kit specimen: every composition part in its states, plus the foundations, in whichever theme
// the header switch has active. Synthetic data throughout (nothing here is a measurement). Not linked
// from anywhere; a production build serves 404.
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/Brand";
import { KitParts } from "./KitParts";
import { KitV2 } from "./KitV2";

export const dynamic = "force-dynamic";

const TYPE_SCALE = [
  ["type-display-lg", "Masthead 37"],
  ["type-display", "Editorial display 31"],
  ["type-heading", "Page heading 25"],
  ["type-title", "Card title 21"],
  ["type-lede", "Intro line 19"],
  ["type-body", "Paragraph copy 17"],
  ["type-body-sm", "Secondary copy 15"],
  ["type-note", "Footnote 13"],
  ["type-label", "MONO EYEBROW 13"],
  ["type-micro", "Smallest permitted 12"],
] as const;

const MUTING = [
  ["text-white", "Primary"],
  ["text-slate-300", "Strong secondary"],
  ["text-slate-400", "Secondary"],
  ["text-slate-500", "Muted (the workhorse)"],
  ["text-slate-600", "Floor (non-essential)"],
] as const;

const STATUS = [
  ["bg-success", "success"],
  ["bg-warn", "warn"],
  ["bg-danger", "danger"],
  ["bg-tone-rising", "rising"],
  ["bg-tone-flat", "flat"],
] as const;

export default function KitSpecimen() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl space-y-12 px-5 py-10">
        <header>
          <p className="type-label tracking-[0.22em] text-slate-500">Dev only · synthetic data</p>
          <h1 className="mt-2 type-display font-semibold text-white">The composition kit</h1>
          <p className="mt-2 max-w-2xl type-body text-slate-400">
            Switch Altimeter / Prism in the header. Parts live in src/components/kit; the Prism expression is src/app/kit.css.
          </p>
        </header>

        <section className="space-y-3" data-specimen="type">
          <h2 className="type-label tracking-[0.22em] text-slate-500">Type scale</h2>
          <div className="space-y-1">
            {TYPE_SCALE.map(([cls, label]) => (
              <div key={cls} className="flex items-baseline gap-4">
                <span className="w-36 shrink-0 type-mono-sm text-slate-500">{cls}</span>
                <span className={`${cls} text-white`}>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3" data-specimen="muting">
          <h2 className="type-label tracking-[0.22em] text-slate-500">Muting levels</h2>
          <div className="space-y-1">
            {MUTING.map(([cls, label]) => (
              <p key={cls} className={`type-body ${cls}`}>
                <span className="mr-4 inline-block w-36 type-mono-sm">{cls}</span>
                {label}
              </p>
            ))}
          </div>
        </section>

        <section className="space-y-3" data-specimen="spectral">
          <h2 className="type-label tracking-[0.22em] text-slate-500">The Spectral Nine (Prism: names a dimension, never decorates)</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-9">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="rounded-md border border-divider p-2 type-mono-sm text-slate-300">
                <span aria-hidden className="mb-1 block h-3 rounded-sm" style={{ background: `var(--spec-${i + 1}, transparent)` }} />
                D{i + 1}
              </div>
            ))}
          </div>
          <p className="type-note text-slate-500">In Altimeter the swatches are empty: the spectral tokens exist only under the Prism theme.</p>
        </section>

        <section className="space-y-3" data-specimen="status">
          <h2 className="type-label tracking-[0.22em] text-slate-500">Status colours (meaning, unchanged across themes)</h2>
          <div className="flex flex-wrap gap-3">
            {STATUS.map(([cls, label]) => (
              <span key={cls} className="inline-flex items-center gap-2 type-mono-sm text-slate-300">
                <span aria-hidden className={`inline-block h-3 w-3 rounded-full ${cls}`} />
                {label}
              </span>
            ))}
          </div>
        </section>

        <KitV2 />

        <KitParts />
      </main>
    </>
  );
}
