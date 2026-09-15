// The fleet's context decay field — potency against ≈commits-since-edit, with the fleet's median
// decay curve through it. The Repositories tab's context lens now OPENS on this (§2.2) instead of on
// four tiles under a 148-character lede.
//
// Reading it: every dot is one repo's guidance. Left is freshly written, right is many commits later;
// high is still true, low is mostly wrong. The dashed rule at 50% is the half-life — a dot under it
// is a file that misleads an agent more often than it helps. The curve is the fleet's own median
// decay rate (contextDecayViz.ts), so a dot above the curve holds up better than the fleet median
// and one below decays faster. Repos that could not be measured are NOT plotted at zero: they are
// counted under the plot with the kit's own hatch and void marks.
//
// Server-safe: no hooks, no handlers, and no motion — so there is nothing for reduced-motion to
// suppress. Colour is scoreHex (the level ramp) and CSS tokens only; no hand-picked hex (BRAND.md).

import { KICKER_SVG_CLASS, StateSwatch, VizDefs, r2, type VizState } from "@/components/org/viz";
import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { decayCurve, type DecayField } from "./contextDecayViz";

const W = 320;
const H = 150;
const L = 30;
const R = 8;
const T = 10;
const B = 24;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;

function SwatchCount({ state, n, label, hint }: { state: VizState; n: number; label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={hint}>
      <StateSwatch state={state} />
      <Kicker tone="muted" as="span">
        <span className="tabular-nums text-slate-400">{n}</span> {label}
      </Kicker>
    </span>
  );
}

export function FleetDecayScatter({ field, className = "" }: { field: DecayField; className?: string }) {
  const x = (commits: number) => r2(L + (Math.max(0, commits) / field.maxCommits) * PLOT_W);
  const y = (potency: number) => r2(T + (1 - Math.max(0, Math.min(100, potency)) / 100) * PLOT_H);
  const curve = decayCurve(field);
  const past = field.points.filter((p) => p.pastHalfLife).length;

  const ariaLabel =
    field.points.length === 0
      ? "Fleet context decay: no repository has both a freshness reading and a commit count yet."
      : `Fleet context decay: ${field.points.length} measured ${field.points.length === 1 ? "repository" : "repositories"}, ` +
        `${past} past half-life (guidance now more wrong than right), over up to ${field.maxCommits} approximate commits since the last edit. ` +
        (field.halfCommits == null
          ? "No median decay curve is drawn: no repository has decayed enough to supply a rate."
          : `The fleet's median guidance halves after about ${Math.round(field.halfCommits)} commits.`);

  return (
    <div className={className}>
      {field.points.length === 0 ? (
        <p role="img" aria-label={ariaLabel} className="type-body-sm text-slate-500">
          No repository has both a freshness reading and a commit count yet.
        </p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
          <title>{ariaLabel}</title>
          <VizDefs />

          {/* frame: the two axes, as hairlines */}
          <line x1={L} y1={T} x2={L} y2={T + PLOT_H} stroke="var(--color-divider)" strokeWidth={1} />
          <line x1={L} y1={T + PLOT_H} x2={L + PLOT_W} y2={T + PLOT_H} stroke="var(--color-divider)" strokeWidth={1} />

          {/* the half-life rule — under it, the file is more wrong than right */}
          <line x1={L} y1={y(50)} x2={L + PLOT_W} y2={y(50)} stroke="var(--color-divider)" strokeWidth={1} strokeDasharray="3 3" />
          <text x={L + 3} y={y(50) - 4} fontSize={8} className={KICKER_SVG_CLASS}>
            half-life
          </text>

          {curve.length > 0 && (
            <polyline
              data-curve
              points={curve.map((p) => `${x(p.x)},${y(p.y)}`).join(" ")}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              strokeOpacity={0.45}
            />
          )}

          {field.points.map((p) => (
            <circle key={p.id} data-point={p.id} cx={x(p.commits)} cy={y(p.potency)} r={3.2} fill={scoreHex(p.potency)} fillOpacity={0.9}>
              <title>{`${p.label} — ${Math.round(p.potency)}% potency after ≈${p.commits} commits${p.pastHalfLife ? " (past half-life)" : ""}`}</title>
            </circle>
          ))}

          {/* axis ends only: the reader needs the domain, not a ruler */}
          <text x={L - 4} y={y(100) + 3} textAnchor="end" fontSize={8} className={KICKER_SVG_CLASS}>100%</text>
          <text x={L - 4} y={y(0) + 3} textAnchor="end" fontSize={8} className={KICKER_SVG_CLASS}>0</text>
          <text x={L} y={H - 6} fontSize={8} className={KICKER_SVG_CLASS}>0 commits since edit</text>
          <text x={L + PLOT_W} y={H - 6} textAnchor="end" fontSize={8} className={KICKER_SVG_CLASS}>
            ≈{field.maxCommits}
          </text>
        </svg>
      )}

      {(field.unknown > 0 || field.absent > 0 || field.notAssessed > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {field.unknown > 0 && (
            <SwatchCount
              state="not-judged"
              n={field.unknown}
              label="freshness unknown"
              hint="The scan ran but the history lookup degraded, so decay is unknown — never fabricated. Quality and drift are still measured."
            />
          )}
          {field.absent > 0 && (
            <SwatchCount
              state="missing"
              n={field.absent}
              label="no guidance file"
              hint="Assessed and carrying no agent-context file at all: there is nothing here to decay, which is an absence and not a low score."
            />
          )}
          {field.notAssessed > 0 && (
            <SwatchCount
              state="not-judged"
              n={field.notAssessed}
              label="not assessed"
              hint="Scanned before context health existed — re-scan to measure. Never counted as 'no context'."
            />
          )}
        </div>
      )}

      <table className="sr-only">
        <caption>Fleet context decay — potency against approximate commits since the last edit</caption>
        <thead>
          <tr>
            <th scope="col">Repository</th>
            <th scope="col">Potency</th>
            <th scope="col">≈ commits since edit</th>
          </tr>
        </thead>
        <tbody>
          {field.points.map((p) => (
            <tr key={p.id}>
              <th scope="row">{p.label}</th>
              <td>{`${Math.round(p.potency)}%`}</td>
              <td>{p.commits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
