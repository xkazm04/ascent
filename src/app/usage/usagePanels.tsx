import { Stat as UiStat } from "@/components/ui/Stat";

// The canonical ledger-family Stat (src/components/ui/Stat.tsx) covers the label/value/sub shape
// this page needs; this site only adds the self-bordered card chrome around it (G8-52). Note the
// value here renders one step smaller (text-2xl, via ui/Stat's own "ledger" sizing) than this page's
// prior hand-rolled text-3xl — that size isn't exposed by the shared component and isn't worth a
// one-caller prop just to preserve a single page's larger figure.
export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <UiStat label={label} value={value} sub={sub} />
    </div>
  );
}

// Per-provider label + accent so the "By inference engine" bars are distinguishable at a glance
// (was every provider in the same azure with its raw id). Unknown ids fall back to accent + the id.
const PROVIDER_META: Record<string, { label: string; color: string }> = {
  gemini: { label: "Gemini", color: "#4285f4" },
  bedrock: { label: "AWS Bedrock", color: "#ff9900" },
  claude: { label: "Claude", color: "#d97757" },
  "claude-cli": { label: "Claude CLI", color: "#d97757" },
  mock: { label: "Mock (deterministic)", color: "#94a3b8" },
};
export function providerMeta(id: string): { label: string; color: string } {
  return PROVIDER_META[id] ?? { label: id, color: "var(--color-accent)" };
}

export function Bar({
  label,
  value,
  total,
  color,
  pattern,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  pattern?: boolean;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono tabular-nums text-slate-400">
          {value.toLocaleString()} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            // Redundant (non-color) encoding so the public/free vs private/billable split stays
            // legible without relying on hue alone (CVD): the free series is stippled.
            backgroundImage: pattern
              ? "repeating-linear-gradient(45deg, rgba(255,255,255,0.3) 0 3px, transparent 3px 6px)"
              : undefined,
          }}
        />
      </div>
    </div>
  );
}
