// SettingRow — one configurable thing: a label and explanation on the left, its control on the right,
// hairline-separated inside a Panel. The control is passed in (toggle, select, button); the row owns
// only the layout so every settings surface aligns the same.
export function SettingRow({
  label,
  description,
  control,
  status,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  /** Optional muted state line under the description ("Managed by your plan"). */
  status?: React.ReactNode;
}) {
  return (
    <div
      data-kit="setting-row"
      data-role="setting-row"
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-divider py-3 last:border-b-0"
    >
      <div className="min-w-0 max-w-xl">
        <div className="type-body font-medium text-white">{label}</div>
        {description != null && <p className="type-body-sm text-slate-400">{description}</p>}
        {status != null && <p className="mt-0.5 type-note text-slate-500">{status}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
