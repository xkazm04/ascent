"use client";

// Field — the brand's form controls. THE STANDARD DID NOT EXIST BEFORE THIS FILE.
//
// A survey of the app found ~50 hand-rolled inputs on `border-slate-700 bg-slate-900 …` — the exact
// literal BRAND.md tells you not to write ("don't re-hardcode `border-slate-800 bg-slate-900/40`; use
// Surface / Kicker") — in at least four padding variants, and a `FIELD_LABEL` mono-label constant
// copy-pasted per modal. Every dialog therefore looked slightly different from every other one and
// none of them looked like the landing or /about pages, which DO use the brand tokens.
//
// So these primitives are deliberately thin: one control skin on the real tokens (`border-divider`,
// `bg-surface`, `focus-ring`, `accent`), one label treatment (`Kicker tone="muted"`, the same eyebrow
// the rest of the identity uses), and one selectable-card control for multi-choice — which is the only
// genuinely NEW thing here, because a bare `<input type="checkbox">` list was the ugliest surface in
// the app and had no brand-side answer at all.
//
// Labels associate IMPLICITLY (the control is wrapped by its `<label>`), matching what the existing
// modals already do — no id plumbing at the call site, and no chance of a mismatched `htmlFor`.

import { Kicker } from "./Kicker";

/**
 * The shared control skin for text inputs, textareas and selects. Exported so a one-off control that
 * doesn't fit the wrappers below still lands on the same tokens instead of inventing a fifth variant.
 */
export const CONTROL_CLASS =
  "focus-ring w-full rounded-lg border border-divider bg-surface/60 px-3 py-2 text-base text-white transition placeholder:text-slate-600 hover:border-slate-600 focus:border-accent disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A labelled form row: mono eyebrow, an optional hint, the control, then an error when there is one.
 *
 * The hint sits ABOVE the control and the error BELOW it, because they are read at different moments —
 * a hint is an instruction you want before you start typing (under a group of checkboxes it arrives
 * after you've already answered), while an error is feedback you look for right where you just acted.
 *
 * `as="fieldset"` switches the wrapper to a real `<fieldset>`/`<legend>` for a group of controls (a
 * checkbox set can't be wrapped in one `<label>`), which is also how the group gets an accessible name.
 */
export function Field({
  label,
  hint,
  error,
  as = "label",
  className = "",
  children,
}: {
  label: React.ReactNode;
  /** Instruction shown under the label. NOTE: for `as="label"` it sits inside the `<label>`, so it
   *  becomes part of the control's accessible name ("Company Optional") — usually what you want, but
   *  for a one-word marker prefer folding it into the label itself ("Company · optional"). */
  hint?: React.ReactNode;
  /** Validation message; takes the hint's place and turns it danger-toned. */
  error?: string | null;
  as?: "label" | "fieldset";
  className?: string;
  children: React.ReactNode;
}) {
  const Wrap = as === "fieldset" ? "fieldset" : "label";
  return (
    <Wrap className={`block ${className}`}>
      <Kicker as={as === "fieldset" ? "legend" : "span"} tone="muted">
        {label}
      </Kicker>
      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
      <div className="mt-1.5">{children}</div>
      {/* Deliberately NOT a live region. A form that marks the offending field AND announces the same
          failure from its footer would fire two announcements for one error; the footer (or whatever
          summary the caller owns) is the single announcement, and this is the visual marker that says
          WHICH control it was about. */}
      {error && <p className="mt-1.5 text-xs leading-relaxed text-danger">{error}</p>}
    </Wrap>
  );
}

export function TextInput({ className = "", ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`${CONTROL_CLASS} ${className}`} />;
}

export function TextArea({ className = "", ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`${CONTROL_CLASS} resize-y leading-relaxed ${className}`} />;
}

export function SelectInput({ className = "", children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`${CONTROL_CLASS} ${className}`}>
      {children}
    </select>
  );
}

/**
 * A selectable card — a checkbox rendered as a bordered tile with a title and a supporting line,
 * tinting to the accent when picked. The native input stays in the DOM (`sr-only`, so it keeps
 * keyboard operation, form semantics and AT announcement) and drives the visual box through `peer`,
 * which is what lets the focus ring land on the drawn box rather than on an invisible input.
 */
export function CheckCard({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  name,
}: {
  checked: boolean;
  onChange: () => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <label
      className={`flex items-start gap-3 rounded-lg border p-3 transition ${
        disabled
          ? "cursor-not-allowed border-divider bg-surface/40 opacity-60"
          : checked
            ? "cursor-pointer border-accent/60 bg-accent/10"
            : "cursor-pointer border-divider bg-surface/40 hover:border-slate-600"
      }`}
    >
      <input type="checkbox" name={name} checked={checked} onChange={onChange} disabled={disabled} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded border text-[11px] font-bold leading-none transition peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-ink ${
          checked ? "border-accent bg-accent text-on-accent" : "border-slate-600"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-100">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}
