// FormField: one labelled input. The label sits above, the hint and error below, and the control is passed in
// (or use <Input>, <Select>, <Textarea>, which carry the kit's control look). Server-safe: no hooks. The error
// is a word with a glyph, never a colour alone (hue is reserved for dimensions).
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CONTROL =
  "focus-ring w-full rounded-lg border border-divider bg-surface-strong px-3 py-2 type-body-sm text-white placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60";

export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  /** The id of the control, so the label is programmatically tied to it. */
  htmlFor?: string;
  hint?: ReactNode;
  /** A validation message. Rendered with a leading glyph and role="alert". */
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-kit="form-field" data-role="form-field" data-invalid={error ? "" : undefined} className={`space-y-1.5 ${className}`.trim()}>
      <label htmlFor={htmlFor} data-role="form-label" className="block type-body-sm font-medium text-slate-100">
        {label}
      </label>
      {children}
      {hint != null && !error && (
        <p data-role="form-hint" className="type-note text-slate-400">
          {hint}
        </p>
      )}
      {error != null && (
        <p data-role="form-error" role="alert" className="type-note text-slate-100">
          <span aria-hidden>! </span>
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input data-kit="field-control" data-role="input" className={`${CONTROL} ${className}`.trim()} {...rest} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select data-kit="field-control" data-role="select" className={`${CONTROL} ${className}`.trim()} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea data-kit="field-control" data-role="textarea" className={`${CONTROL} ${className}`.trim()} {...rest} />;
}
