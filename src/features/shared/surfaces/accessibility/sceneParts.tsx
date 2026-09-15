// Shared markup for the accessibility scene's regions. No hooks, no "use client": a Region is the
// `data-technique` boundary the frame spotlights; IconButton is the scene's one icon-only primitive,
// whose `label` prop is REQUIRED by the type — the nameless case does not compile.

import { Kicker } from "@/components/ui";

export function Region({ technique, title, note, children, className = "" }: { technique: string; title: string; note?: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-technique={technique} className={`rounded-xl border border-divider bg-ink p-4 ${className}`} aria-label={title}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="type-body-sm font-semibold text-white">{title}</h3>
        <span className="type-caption text-slate-600">{technique}</span>
      </div>
      {note ? <p className="mb-3 type-caption text-slate-500">{note}</p> : null}
      {children}
    </section>
  );
}

export function Readout({ label, value, tone = "text-slate-200" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <Kicker tone="muted" as="span">
        {label}
      </Kicker>
      <span className={`type-mono-sm tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export const BTN = "focus-ring rounded-md border border-slate-700 px-2 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-40";
export const BTN_ON = "focus-ring rounded-md border border-accent bg-accent/10 px-2 py-1 type-caption text-accent-soft";

/**
 * primitive-level-a11y: an icon-only control carries an explicit name, structurally. The glyph is
 * decorative (`aria-hidden`), the name is the required `label`, the element is the NATIVE button so
 * role, Enter/Space activation and disabled semantics come from the platform, and the shared
 * `.focus-ring` is the visible focus. A consumer cannot render this without a name.
 */
export function IconButton({ label, glyph, onClick, disabled, id, className = "" }: { label: string; glyph: string; onClick?: () => void; disabled?: boolean; id?: string; className?: string }) {
  return (
    <button type="button" id={id} aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`${BTN} ${className}`}>
      <span aria-hidden>{glyph}</span>
    </button>
  );
}

/** A native-button switch: role + checked state announced, named for the thing it controls. */
export function Switch({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={`${on ? BTN_ON : BTN} inline-flex items-center gap-2`}>
      <span aria-hidden className={`inline-block h-3 w-6 rounded-full border ${on ? "border-accent bg-accent/40" : "border-slate-600"}`} />
      {label}
    </button>
  );
}
