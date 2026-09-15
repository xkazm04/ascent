// The four delivery-outcome readings as one instrument: four panels, identical geometry, read in a
// glance instead of as two tables and a paragraph.
//
// The withheld reading is the reason this is a drawing. A rate the sample floor refuses to state
// renders as a VOID track — dashed, unfilled, with an em dash where the figure would be — and
// `rendersValue("missing")` is what stops a numeral appearing there at all. In a table that same
// refusal was a dash the reader had to be told about in a sentence at the bottom of the panel.
//
// Server-safe; `WhyChip` crosses the client boundary itself.

import { scoreHex } from "@/lib/ui";
import { VOID_DASH, WhyChip, clamp, fmtNum, isNum, r2, rendersValue, stateTitle } from "@/components/org/viz";
import type { DoraPanel } from "./doraPanels";

const W = 120;
const H = 8;

/** Lower-is-better readings invert the ramp: a 4% change-failure rate is good news, and scoreHex(4)
 *  — deep red for a LOW number — would say the opposite. The PrSignalsBand revert-rate precedent. */
function tone(p: DoraPanel): string | undefined {
  if (!isNum(p.value)) return undefined;
  const pctOfDomain = p.domainMax > 0 ? (p.value / p.domainMax) * 100 : 0;
  return scoreHex(clamp(p.higherIsBetter ? pctOfDomain : 100 - pctOfDomain, 0, 100));
}

function Track({ p }: { p: DoraPanel }) {
  const void_ = !rendersValue(p.state) || !isNum(p.value);
  const w = void_ ? 0 : r2((clamp(p.value, 0, p.domainMax) / Math.max(1, p.domainMax)) * W);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-2 w-full" role="img" aria-label={stateTitle(p.state, p.label)} preserveAspectRatio="none">
      <title>{stateTitle(p.state, p.label)}</title>
      {void_ ? (
        <rect data-track={p.id} data-state="missing" x={0.5} y={0.5} width={W - 1} height={H - 1} rx={2} fill="none" stroke="var(--color-divider)" strokeWidth={1} strokeDasharray={VOID_DASH} />
      ) : (
        <>
          <rect x={0} y={0} width={W} height={H} rx={2} fill="var(--color-divider)" fillOpacity={0.5} />
          <rect data-track={p.id} data-state="measured" x={0} y={0} width={Math.max(1, w)} height={H} rx={2} fill={tone(p) ?? "var(--color-accent)"} />
        </>
      )}
    </svg>
  );
}

export function DoraSmallMultiple({ panels }: { panels: DoraPanel[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-divider bg-divider sm:grid-cols-2 lg:grid-cols-4">
      {panels.map((p) => (
        <div key={p.id} className="bg-ink p-4">
          <div className="flex items-center gap-1.5">
            <span className="font-mono type-micro uppercase tracking-wider text-slate-400">{p.label}</span>
            <WhyChip hint={p.hint} label={p.label} />
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            {/* A withheld reading prints an em dash. It must never print 0. */}
            <span className="type-figure font-bold" style={{ color: tone(p) ?? "#e2e8f0" }}>
              {isNum(p.value) ? `${fmtNum(p.value)}${p.unit}` : "—"}
            </span>
            <span className="type-note text-slate-500">{p.sub}</span>
          </div>
          <Track p={p} />
          <div className="mt-1 flex justify-between font-mono type-micro tabular-nums text-slate-600">
            <span>0</span>
            <span>{`${fmtNum(p.domainMax)}${p.unit}`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
