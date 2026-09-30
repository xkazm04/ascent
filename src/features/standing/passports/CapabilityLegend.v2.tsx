// Prism legend for the capability table. Marks match CapabilityCellV2: glyph plus word, slate
// underline for where a control is wired. No status hue.
import { Caption } from "@/components/kit";

const ROWS: { mark: string; label: string; hint: string }[] = [
  { mark: "✓", label: "verified", hint: "The repository's own doctor ran this command and it passed." },
  { mark: "·", label: "declared", hint: "Declared in the manifest and not yet run." },
  { mark: "×", label: "failed", hint: "Declared, and its last doctor run failed." },
  { mark: "?", label: "placeholder", hint: "Declared but still a placeholder token: not fillable yet." },
  { mark: "no", label: "not declared", hint: "This repository does not declare this capability at all." },
];

export function CapabilityLegendV2() {
  return (
    <div className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {ROWS.map((row) => (
          <li key={row.label} title={row.hint} className="type-caption text-slate-400">
            <span className="text-slate-200">{row.mark}</span> {row.label}
          </li>
        ))}
      </ul>
      <Caption>A solid underline is enforced pre-push. A dotted underline is enforced as a CI hard pass.</Caption>
    </div>
  );
}
