"use client";

// Map view — "efficiency quadrant" (the PassportScatter idiom): one point per repo, x = how much AI
// actually reaches the work (aiInvolvedRate), y = simulated $/mo spent, size = seats, color = the ROI
// verdict. The four regions answer "is the spend working?" at a glance — money with no AI reaching PRs
// floats top-left (idle/waste), high-AI-low-cost sits bottom-right (lean). A verdict legend filters the
// cloud, and a side rail turns the concern cohorts (ungoverned / idle / shadow) into an action list
// with report links. Client (hover + filter state).

import { useState } from "react";
import Link from "next/link";
import { VERDICT_META, fmtMoney, type AiDeliveryModel, type AiRepoRoi, type Verdict } from "./aiDeliveryModel";
import { VerdictChip } from "./aiShared";

const W = 480;
const H = 356;
// Asymmetric padding reserves a clean gutter above and below the plot for the quadrant captions, so a
// point parked in a corner can never occlude them (and same-color text-over-dot never happens).
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 44;
const PAD_B = 52;
const ADOPT_SPLIT = 15; // matches the model's ADOPT_HI

// Concern cohorts get an action rail; starter/working don't need one.
const COHORTS: { verdict: Verdict; verb: string }[] = [
  { verdict: "ungoverned", verb: "Require review on" },
  { verdict: "idle", verb: "Reclaim seats on" },
  { verdict: "shadow", verb: "Bring under a plan" },
];

// idle/shadow are money- & plan-framed ("reclaim seats", "bring under a plan") — honest actions only
// when spend is connected. In simulated mode they'd rest on placeholder dollars, so the rail withholds
// them (the git-real governance cohort still shows). Kept in sync with classify()'s spend-derived set.
const MONEY_COHORTS = new Set<Verdict>(["idle", "shadow"]);

export function AiRoiQuadrant({ model, slug }: { model: AiDeliveryModel; slug: string }) {
  const [active, setActive] = useState<Verdict | null>(null);
  const [hover, setHover] = useState<AiRepoRoi | null>(null);
  const simulated = model.fidelity === "simulated";

  const xMax = Math.max(20, Math.ceil(Math.max(...model.repos.map((r) => r.aiInvolvedRate)) / 10) * 10);
  const meanSpend = model.summary.totalMonthlySpend / Math.max(1, model.summary.repos);
  const yMax = Math.max(500, Math.ceil(Math.max(...model.repos.map((r) => r.monthlySpend)) / 500) * 500);
  const ySplit = Math.max(meanSpend, 200);

  const px = (v: number) => PAD_L + (Math.max(0, Math.min(xMax, v)) / xMax) * (W - PAD_L - PAD_R);
  const py = (v: number) => H - PAD_B - (Math.max(0, Math.min(yMax, v)) / yMax) * (H - PAD_B - PAD_T);
  const seatR = (seats: number) => 4 + Math.min(8, seats / 8);

  const splitX = px(ADOPT_SPLIT);
  const splitY = py(ySplit);

  // Captions live in the top/bottom gutters (never inside the plot), so points can't cover them.
  // Top row names the high-spend regions, bottom row the low-spend regions.
  const capTop = PAD_T - 20;
  const capBottom = H - PAD_B + 22;
  const quadCaptions = [
    { x: PAD_L + 2, y: capTop, anchor: "start" as const, text: "idle — paying, little AI", hex: "#f97316" },
    { x: W - PAD_R - 2, y: capTop, anchor: "end" as const, text: "invested & active", hex: "#22c55e" },
    { x: PAD_L + 2, y: capBottom, anchor: "start" as const, text: "starter", hex: "#64748b" },
    { x: W - PAD_R - 2, y: capBottom, anchor: "end" as const, text: "lean — high AI, low cost", hex: "#7bbcff" },
  ];

  return (
    <div className="space-y-3">
      {simulated && (
        <p className="text-xs text-slate-500">
          Spend (Y-axis) and seat sizes are a deterministic sample — only AI reach (X-axis) is real (git).{" "}
          <Link href={`/org/${slug}/integrations`} className="text-accent transition hover:underline">
            Connect a provider
          </Link>{" "}
          for real spend.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* the map */}
        <div className="relative rounded-2xl border border-divider bg-surface-strong/40 p-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="AI adoption versus AI spend, one point per repository; color is the ROI verdict.">
            {/* quadrant tints */}
            <rect x={PAD_L} y={PAD_T} width={splitX - PAD_L} height={splitY - PAD_T} fill="#f97316" fillOpacity={0.05} />
            <rect x={splitX} y={PAD_T} width={W - PAD_R - splitX} height={splitY - PAD_T} fill="#22c55e" fillOpacity={0.05} />
            {/* axes */}
            <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#334155" />
            <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#334155" />
            {/* split lines */}
            <line x1={splitX} y1={PAD_T} x2={splitX} y2={H - PAD_B} stroke="#1e293b" strokeDasharray="3 3" />
            <line x1={PAD_L} y1={splitY} x2={W - PAD_R} y2={splitY} stroke="#1e293b" strokeDasharray="3 3" />
            {/* axis labels */}
            <text x={(PAD_L + W - PAD_R) / 2} y={H - 8} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500">
              AI reach (% of PRs) →
            </text>
            <text x={12} y={(PAD_T + H - PAD_B) / 2} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500" transform={`rotate(-90 12 ${(PAD_T + H - PAD_B) / 2})`}>
              Spend $/mo →
            </text>
            {quadCaptions.map((c) => (
              <text key={c.text} x={c.x} y={c.y} textAnchor={c.anchor} fontSize="9" fontFamily="monospace" className="pointer-events-none" fill={c.hex} fillOpacity={0.75}>
                {c.text}
              </text>
            ))}
            {simulated && (
              <text
                x={(PAD_L + W - PAD_R) / 2}
                y={(PAD_T + H - PAD_B) / 2}
                textAnchor="middle"
                fontSize="14"
                fontFamily="monospace"
                className="pointer-events-none select-none fill-slate-600"
                opacity={0.5}
              >
                sample spend
              </text>
            )}
            {/* points */}
            {model.repos.map((r) => {
              const faded = active != null && r.verdict !== active;
              return (
                <circle
                  key={r.fullName}
                  cx={px(r.aiInvolvedRate)}
                  cy={py(r.monthlySpend)}
                  r={seatR(r.seats)}
                  fill={VERDICT_META[r.verdict].hex}
                  fillOpacity={0.85}
                  opacity={faded ? 0.15 : 1}
                  stroke="#04070e"
                  strokeWidth={0.75}
                  className="cursor-pointer transition-opacity duration-300 motion-reduce:transition-none"
                  onMouseEnter={() => setHover(r)}
                  onMouseLeave={() => setHover(null)}
                >
                  <title>{simulated ? `${r.name} — AI reach ${r.aiInvolvedRate}% · ${VERDICT_META[r.verdict].label} (spend is a sample)` : `${r.name} — AI reach ${r.aiInvolvedRate}%, ${fmtMoney(r.monthlySpend)}/mo, ${r.seats} seats · ${VERDICT_META[r.verdict].label}`}</title>
                </circle>
              );
            })}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-divider bg-surface-strong/95 px-2.5 py-1.5 shadow-lg"
              style={{ left: `${(px(hover.aiInvolvedRate) / W) * 100}%`, top: `${(py(hover.monthlySpend) / H) * 100}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
            >
              <div className="whitespace-nowrap font-mono text-sm font-bold text-white">{hover.name}</div>
              <div className="whitespace-nowrap font-mono text-xs text-slate-400">
                {hover.aiInvolvedRate}% AI{simulated ? " · sample spend" : ` · ${fmtMoney(hover.monthlySpend)}/mo · ${hover.seats} seats`}
              </div>
            </div>
          )}

          {/* verdict legend — click to filter the cloud */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {(Object.keys(VERDICT_META) as Verdict[]).map((v) => {
              const on = active === v;
              const n = model.summary.counts[v];
              return (
                <button
                  key={v}
                  type="button"
                  disabled={n === 0}
                  onClick={() => setActive(on ? null : v)}
                  aria-pressed={on}
                  className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs transition disabled:opacity-30 ${on ? "border-current" : "border-divider hover:border-slate-600"}`}
                  style={{ color: VERDICT_META[v].hex }}
                >
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: VERDICT_META[v].hex }} />
                  {VERDICT_META[v].label} <span className="tabular-nums text-slate-500">{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* action rail — the concern cohorts as work lists. Money-framed cohorts (idle/shadow) are
            withheld in simulated mode since their dollars are a placeholder; the git-real governance
            cohort survives, and a connect prompt replaces the fake all-clear. */}
        <div className="space-y-3">
          {COHORTS.filter(({ verdict }) => !(simulated && MONEY_COHORTS.has(verdict))).map(({ verdict, verb }) => {
            const rows = model.repos.filter((r) => r.verdict === verdict);
            if (rows.length === 0) return null;
            const spend = rows.reduce((s, r) => s + r.monthlySpend, 0);
            return (
              <div key={verdict} className="rounded-xl border border-divider bg-surface/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <VerdictChip verdict={verdict} />
                  {!simulated && spend > 0 && <span className="font-mono text-xs tabular-nums text-slate-400">{fmtMoney(spend)}/mo</span>}
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {verb} {rows.length} repo{rows.length > 1 ? "s" : ""}:
                </p>
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                  {rows.slice(0, 8).map((r) => (
                    <li key={r.fullName}>
                      <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-slate-300 transition hover:text-accent">
                        {r.name}
                      </Link>
                    </li>
                  ))}
                  {rows.length > 8 && <li className="font-mono text-sm text-slate-600">+{rows.length - 8}</li>}
                </ul>
              </div>
            );
          })}
          {simulated ? (
            <div className="rounded-xl border border-divider bg-surface/40 p-3 text-xs text-slate-500">
              Idle-seat and shadow-AI verdicts rest on spend Ascent can&apos;t see yet.{" "}
              <Link href={`/org/${slug}/integrations`} className="text-accent transition hover:underline">
                Connect a provider
              </Link>{" "}
              to surface reclaimable seats and unplanned AI.
            </div>
          ) : (
            model.summary.counts.ungoverned === 0 &&
            model.summary.counts.idle === 0 &&
            model.summary.counts.shadow === 0 && (
              <div className="rounded-xl border border-divider bg-surface/40 p-4 text-sm text-slate-400">
                <span aria-hidden className="mr-2 text-lime-400">✓</span>
                No idle, ungoverned, or shadow AI spend detected across the fleet.
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
