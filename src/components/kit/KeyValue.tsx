// KeyValue — a definition list of facts: mono muted key, readable value. `layout="row"` puts the key
// and value on one line with the value right-aligned (settings, briefs); `stack` puts the key over the value.
export interface KeyValueItem {
  key: string;
  value: React.ReactNode;
  /** Optional muted explanation under the value. */
  hint?: React.ReactNode;
}

export function KeyValue({
  items,
  layout = "row",
  className = "",
}: {
  items: KeyValueItem[];
  layout?: "row" | "stack";
  className?: string;
}) {
  return (
    <dl data-kit="key-value" data-layout={layout} data-role="key-value" className={`divide-y divide-divider ${className}`}>
      {items.map((it) => (
        <div
          key={it.key}
          data-role="key-value-row"
          className={layout === "row" ? "flex items-baseline justify-between gap-4 py-2" : "py-2"}
        >
          <dt className="type-label tracking-widest text-slate-500">{it.key}</dt>
          <dd className={layout === "row" ? "min-w-0 text-right type-body-sm text-slate-200" : "mt-0.5 type-body-sm text-slate-200"}>
            {it.value}
            {it.hint != null && <span className="block type-note text-slate-500">{it.hint}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
