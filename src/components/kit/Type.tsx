// Kit v2 typographic set: the landing type roles (docs/design/KIT-V2-LANGUAGE.md section 1) as parts.
// Server-safe, no state. Sizes live in src/app/kit.css keyed by data-level so the two themes share one API;
// the Altimeter fallback is the app's own type-* classes, so these render sensibly in both looks.
import type { ElementType, ReactNode } from "react";

export type DisplayLevel = "page" | "section" | "figure" | "named";

const ALT: Record<DisplayLevel, string> = {
  page: "type-heading font-semibold text-white",
  section: "type-title font-semibold text-white",
  figure: "type-figure text-white",
  named: "type-body font-semibold text-white",
};

/**
 * A statement in two weights: `children` is the light statement (300 in Prism), `named` is the thing named,
 * set heavier (600). `<Display as="h2" level="section" named="Nine lines out.">One line in.</Display>`.
 */
export function Display({
  as: Tag = "h2",
  level = "section",
  named,
  children,
  className = "",
  id,
}: {
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "div";
  level?: DisplayLevel;
  /** The named phrase, rendered as `<b>` so it takes the 600 weight and, for `figure`, stays inline. */
  named?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
}) {
  const T = Tag as ElementType;
  return (
    <T id={id} data-kit="display" data-level={level} data-role="display" className={`${ALT[level]} ${className}`}>
      {children}
      {named != null && (
        <>
          {children != null && " "}
          <b data-role="display-named">{named}</b>
        </>
      )}
    </T>
  );
}

/** The label above a section: sentence case, mute, with the 28x3 spectral tick (drawn by kit.css in Prism). */
export function Eyebrow({ children, className = "", as: Tag = "p" }: { children: ReactNode; className?: string; as?: "p" | "div" | "span" }) {
  const T = Tag as ElementType;
  return (
    <T data-kit="eyebrow" data-role="eyebrow" className={`type-label text-slate-400 ${className}`}>
      {children}
    </T>
  );
}

/** The paragraph under a statement: 17px, paper at 85%, capped at 34em. */
export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p data-kit="lede" data-role="lede" className={`type-body max-w-[34em] text-slate-300 ${className}`}>
      {children}
    </p>
  );
}

/** Metadata and fine print: 13px mute (`note` = 15px dim for footnotes under a figure). */
export function Caption({ children, tone = "caption", className = "" }: { children: ReactNode; tone?: "caption" | "note"; className?: string }) {
  return (
    <p
      data-kit="caption"
      data-tone={tone}
      data-role="caption"
      className={`${tone === "note" ? "type-body-sm text-slate-500" : "type-caption text-slate-400"} ${className}`}
    >
      {children}
    </p>
  );
}

/** Evidence text only: a file path, a dimension id, a weight. The one place mono is right in Prism. */
export function MonoPath({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <code data-kit="mono-path" data-role="mono-path" className={`break-all font-mono type-mono-sm text-slate-300 ${className}`}>
      {children}
    </code>
  );
}
