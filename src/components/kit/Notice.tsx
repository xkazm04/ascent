// Notice: the ruled status banner. A short statement that something failed or needs attention, set as a
// hairline-ruled line (a paper edge in Prism) with a "!" glyph and the words, never a coloured box.
// Status is the glyph and the sentence, so it survives without hue. Server-safe.
import type { ReactNode } from "react";

export type NoticeTone = "error" | "info";

export function Notice({
  tone = "error",
  children,
  className = "",
  id,
  ...rest
}: {
  /** `error` is announced (role=alert) with a "!" glyph; `info` is polite (role=status). */
  tone?: NoticeTone;
  children: ReactNode;
  className?: string;
  id?: string;
} & Partial<Record<`data-${string}`, string | boolean>>) {
  const error = tone === "error";
  return (
    <p
      id={id}
      role={error ? "alert" : "status"}
      data-kit="notice"
      data-role="notice"
      data-tone={tone}
      {...rest}
      className={`type-body-sm ${error ? "text-slate-100" : "text-slate-300"} ${className}`}
    >
      {error && <span aria-hidden>! </span>}
      {children}
    </p>
  );
}
