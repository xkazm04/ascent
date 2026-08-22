"use client";

// One body (or one cluster ring) on the observatory field. Kept apart from ObservatoryField.tsx so
// both stay under the 200-line cap and the per-mark chrome is readable on its own.

import { projectX, projectY, type PlottedBody, type TrailPoint } from "./observatoryModel";
import type { ObservatoryCluster } from "./observatoryGeometry";

/** React 19 hydration: an SVG <title> must have exactly ONE text child, so titles are pre-joined. */
function Title({ text }: { text: string }) {
  return <title>{text}</title>;
}

export function BodyTrail({ trail, to, fill }: { trail: TrailPoint[]; to: { x: number; y: number }; fill: string }) {
  if (trail.length === 0) return null;
  const pts = [...trail, to].map((p) => `${projectX(p.x)},${projectY(p.y)}`).join(" ");
  return <polyline points={pts} fill="none" stroke={fill} strokeWidth={1.25} strokeOpacity={0.28} strokeLinecap="round" />;
}

export function BodyMark({
  body,
  at,
  fill,
  selected,
  scanning,
  crossed,
  onToggle,
  onOpen,
}: {
  body: PlottedBody;
  at: { x: number; y: number };
  fill: string;
  selected: boolean;
  scanning: boolean;
  crossed: boolean;
  onToggle: (fullName: string, additive: boolean) => void;
  onOpen?: (fullName: string) => void;
}) {
  const cx = projectX(at.x);
  const cy = projectY(at.y);
  const title = `${body.fullName} — adoption ${body.adoption ?? "—"}, rigor ${body.rigor ?? "—"}${
    body.overall != null ? `, overall ${body.overall}` : ""
  }`;
  return (
    <g
      className="cursor-pointer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.detail === 2 && onOpen) onOpen(body.fullName);
        else onToggle(body.fullName, e.shiftKey);
      }}
    >
      <Title text={title} />
      {crossed && <circle cx={cx} cy={cy} r={body.r} className="burst-ring" fill="none" stroke={fill} strokeWidth={1.5} />}
      {selected && (
        <circle cx={cx} cy={cy} r={body.r + 5} fill="none" className="stroke-accent" strokeWidth={1.5} strokeOpacity={0.9} />
      )}
      <circle
        cx={cx}
        cy={cy}
        r={body.r}
        fill={fill}
        fillOpacity={0.82}
        stroke={fill}
        strokeWidth={1}
        className={scanning ? "live-dot" : undefined}
        style={scanning ? { transformBox: "fill-box", transformOrigin: "center" } : undefined}
      />
    </g>
  );
}

export function ClusterMark({
  cluster,
  selected,
  onExpand,
}: {
  cluster: ObservatoryCluster;
  selected: boolean;
  onExpand: (id: string) => void;
}) {
  const cx = projectX(cluster.x);
  const cy = projectY(cluster.y);
  return (
    <g
      className="cursor-pointer"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onExpand(cluster.id);
      }}
    >
      <Title text={cluster.label} />
      <circle
        cx={cx}
        cy={cy}
        r={cluster.r}
        fill="none"
        className={selected ? "stroke-accent" : "stroke-divider"}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        className="fill-slate-400 font-mono text-[11px] tabular-nums"
        data-testid="cluster-count"
      >
        {cluster.count}
      </text>
    </g>
  );
}
