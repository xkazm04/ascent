// EvidencePanel: the one boxed object of a surface. Title (mono path), a "read with" line, a numbered code
// excerpt, a fact list (dl), a guardband sentence, and optional footer navigation. The border and glow take the
// dimension's hue when `dimension` is given. Content is data the caller measured; invented content passes
// `honesty` so the tag shows (the landing's evidence is illustrative and says so).
import type { ReactNode } from "react";
import { HonestyTag, type HonestyKind } from "./Marks";
import type { DimensionId } from "./DimensionLine";

export type EvidenceFact = { label: string; value: ReactNode };

export function EvidencePanel({
  title,
  via,
  code,
  facts,
  guard,
  dimension,
  honesty,
  footer,
  className = "",
}: {
  title: string;
  via?: string;
  /** Excerpt lines, rendered with line numbers. */
  code?: readonly string[];
  facts?: readonly EvidenceFact[];
  guard?: ReactNode;
  dimension?: DimensionId;
  honesty?: HonestyKind;
  footer?: ReactNode;
  className?: string;
}) {
  const hue = dimension ? `var(--spec-${dimension}, var(--color-accent))` : "var(--color-accent)";
  return (
    <section
      data-kit="evidence-panel"
      data-role="evidence-panel"
      aria-label={`Evidence: ${title}`}
      style={{ ["--c" as string]: hue }}
      className={`rounded-[4px] border bg-surface-strong/80 p-5 ${className}`}
    >
      <header className="mb-3">
        <h3 data-role="evidence-title" className="m-0 break-all font-mono type-body font-normal text-white">
          {title}
        </h3>
        {(via || honesty) && (
          <p className="mt-1 flex flex-wrap items-center gap-2 type-body-sm text-slate-400">
            {via && <span>Read with {via}</span>}
            {honesty && <HonestyTag kind={honesty} />}
          </p>
        )}
      </header>
      {code && code.length > 0 && (
        <pre data-role="evidence-code" className="mb-4 overflow-x-auto rounded-[3px] py-3 font-mono type-mono-sm leading-relaxed text-slate-200">
          {code.map((line, i) => (
            <span key={i} className="block whitespace-pre pr-4">
              <span aria-hidden className="mr-3 inline-block w-8 select-none text-right text-slate-600">
                {i + 1}
              </span>
              {line}
            </span>
          ))}
        </pre>
      )}
      {facts && facts.length > 0 && (
        <dl data-role="evidence-facts" className="mb-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 type-body-sm">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-slate-400">{f.label}</dt>
              <dd className="m-0 text-slate-100">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {guard && (
        <p data-role="evidence-guard" className="mb-3 border-t border-divider pt-3 type-body-sm text-slate-400">
          {guard}
        </p>
      )}
      {footer}
    </section>
  );
}
