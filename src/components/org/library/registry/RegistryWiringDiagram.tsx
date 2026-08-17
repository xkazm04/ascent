// The Blueprint direction's stepper: the six steps drawn as a WIRING DIAGRAM — ascent → registry →
// fleet repos, with each step annotated onto the wire it completes. An engineering drawing, not a
// wizard: you read where the circuit is broken rather than being told "step 3 of 6".
//
// Dependency-free SVG on the brand tokens (currentColor + the accent), sized by viewBox so it scales.
// Motion: entrance ONLY, via the app's existing `.animate-fade-up` utility (already gated under
// prefers-reduced-motion in globals.css). No new keyframes, no always-on loops.

import { Kicker } from "@/components/ui";
import type { RegistryView } from "@/lib/org/registry-view";
import { registrySteps, type RegistryStep, type StepState } from "./registryModel";

const W = 720;
const H = 240;

/** Node x-centers: ascent · registry · fleet · developers. */
const NODES = [
  { id: "ascent", label: "ascent", sub: "index · PRs", x: 78 },
  { id: "registry", label: "registry", sub: "your repo", x: 268 },
  { id: "fleet", label: "fleet repos", sub: ".ai/manifest.yaml", x: 470 },
  { id: "dev", label: "developers", sub: "git + npx ascent", x: 648 },
] as const;

const WIRE_Y = 96;

/** A wire is live when the step that energizes it is done. */
function wireTone(state: StepState): { stroke: string; dash?: string } {
  if (state === "done") return { stroke: "var(--color-accent)" };
  if (state === "active") return { stroke: "var(--color-accent)", dash: "5 4" };
  if (state === "blocked") return { stroke: "var(--color-warn)", dash: "2 4" };
  return { stroke: "var(--color-divider)", dash: "2 5" };
}

export function RegistryWiringDiagram({ view }: { view: RegistryView }) {
  const steps = registrySteps(view);
  const byId = Object.fromEntries(steps.map((s) => [s.id, s])) as Record<RegistryStep["id"], RegistryStep>;

  // Which step energizes which wire, with the node pair resolved here (not by index) so the drawing
  // can never render a wire between undefined endpoints.
  const wires: { a: (typeof NODES)[number]; b: (typeof NODES)[number]; step: RegistryStep; label: string }[] = [
    {
      a: NODES[0],
      b: NODES[1],
      // The permissions step gates this wire: a blocked App permission is what breaks it, not scaffolding.
      step: byId.permissions.state === "blocked" ? byId.permissions : byId.scaffold,
      label: "contents:write · scaffold PR",
    },
    { a: NODES[1], b: NODES[2], step: byId.point, label: "pointer + catalog.json" },
    { a: NODES[2], b: NODES[3], step: byId.verify, label: "sync · invoke events" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Kicker tone="muted">Wiring · ascent → registry → fleet</Kicker>
        <span className="font-mono text-xs text-slate-500">
          {steps.filter((s) => s.state === "done" || s.state === "skipped").length}/{steps.length} circuits closed
        </span>
      </div>

      <div className="animate-fade-up overflow-x-auto rounded-2xl border border-divider bg-surface-strong/40 p-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Registry wiring diagram: ascent to registry to fleet repos to developers">
          {/* wires */}
          {wires.map((w, i) => {
            const { a, b } = w;
            const tone = wireTone(w.step.state);
            const mid = (a.x + b.x) / 2;
            return (
              <g key={i}>
                <line
                  x1={a.x + 46}
                  y1={WIRE_Y}
                  x2={b.x - 46}
                  y2={WIRE_Y}
                  stroke={tone.stroke}
                  strokeWidth={1.5}
                  strokeDasharray={tone.dash}
                />
                <text x={mid} y={WIRE_Y - 12} textAnchor="middle" className="fill-slate-500 font-mono" fontSize="10">
                  {w.label}
                </text>
                <text x={mid} y={WIRE_Y + 20} textAnchor="middle" fontSize="10" className="font-mono" fill={tone.stroke}>
                  {w.step.state === "done" ? "closed" : w.step.state === "blocked" ? "blocked" : w.step.state === "active" ? "in progress" : "open"}
                </text>
              </g>
            );
          })}

          {/* nodes */}
          {NODES.map((n) => (
            <g key={n.id}>
              <rect x={n.x - 46} y={WIRE_Y - 24} width={92} height={48} rx={6} fill="var(--color-ink)" stroke="var(--color-divider)" />
              <text x={n.x} y={WIRE_Y - 4} textAnchor="middle" className="fill-white font-mono" fontSize="11">
                {n.label}
              </text>
              <text x={n.x} y={WIRE_Y + 12} textAnchor="middle" className="fill-slate-500 font-mono" fontSize="9">
                {n.sub}
              </text>
            </g>
          ))}

          {/* step annotations, hung under the drawing like callouts on a schematic */}
          {steps.map((s, i) => {
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = 24 + col * 232;
            const y = 156 + row * 40;
            const tone = wireTone(s.state);
            return (
              <g key={s.id}>
                <circle cx={x + 6} cy={y - 4} r={3.5} fill={s.state === "pending" ? "var(--color-divider)" : tone.stroke} />
                <text x={x + 18} y={y} className="fill-slate-300 font-mono" fontSize="10">
                  {String(s.n).padStart(2, "0")} {s.title}
                </text>
                <text x={x + 18} y={y + 13} className="fill-slate-600 font-mono" fontSize="9">
                  {s.detail.length > 44 ? `${s.detail.slice(0, 43)}…` : s.detail}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
