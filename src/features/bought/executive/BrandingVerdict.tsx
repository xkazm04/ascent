// branding-1: the server's per-field verdict under a branding input, shared by the form and
// Forms. Renders nothing until the check has answered for the current draft. No hooks.

export function BrandingVerdict({ id, note }: { id: string; note: string | undefined }) {
  if (!note) return null;
  return (
    <span id={id} className="type-mono-sm normal-case tracking-normal text-amber-300">
      {note}
    </span>
  );
}

/** The Save button's label: the in-flight state wins, then the verdict's named intent. */
export function saveButtonLabel(saving: boolean, label: string): string {
  return saving ? "Saving…" : label;
}
