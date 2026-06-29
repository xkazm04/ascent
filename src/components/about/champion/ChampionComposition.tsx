"use client";

// Remotion composition for "Spread what works": a contributor network where weak links (red, dashed)
// heal into strong links (azure, solid) as a practice-pulse propagates outward from the champions. A
// pulse dot travels each link as it heals; nodes light up and ripple when the wave reaches them; the
// live metrics count weak links down and adoption up. Frame-deterministic via useCurrentFrame.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { NODES, GLINKS, NODE_ADOPT, HEAL } from "./graph";
import { MONO, clamp01, Metric, lerpHex, W, H } from "../compositionShared";

// Weak (#f87171) → strong (#3b9eff) link color, via the shared channel-wise lerp.
const mix = (t: number): string => lerpHex("#f87171", "#3b9eff", t);

export const ChampionComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const linkT = GLINKS.map((l) => (l.reachable ? clamp01((frame - l.healStart) / HEAL) : 0));
  const weakRemaining = linkT.filter((t) => t < 0.5).length;
  const adoptionPct = Math.round((NODES.filter((_, i) => frame >= NODE_ADOPT[i]!).length / NODES.length) * 100);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#080d1a",
        backgroundImage: "radial-gradient(60% 60% at 50% 28%, rgba(59,158,255,0.08), transparent 70%)",
      }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        {GLINKS.map((l, i) => {
          const t = linkT[i]!;
          const a = NODES[l.from]!;
          const b = NODES[l.to]!;
          return (
            <line
              key={i}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={mix(t)}
              strokeWidth={interpolate(t, [0, 1], [1.2, 2.8])}
              strokeOpacity={interpolate(t, [0, 1], [0.4, 0.85])}
              strokeDasharray={t < 0.5 ? "5 6" : undefined}
              strokeLinecap="round"
            />
          );
        })}
        {GLINKS.map((l, i) => {
          const p = l.reachable ? (frame - l.healStart) / HEAL : -1;
          if (p < 0 || p > 1) return null;
          const a = NODES[l.from]!;
          const b = NODES[l.to]!;
          return (
            <circle
              key={i}
              cx={interpolate(p, [0, 1], [a.x, b.x])}
              cy={interpolate(p, [0, 1], [a.y, b.y])}
              r={4.5}
              fill="#cfe6ff"
              opacity={interpolate(p, [0, 0.2, 0.8, 1], [0, 1, 1, 0])}
            />
          );
        })}
        {NODES.map((n, i) => {
          const at = clamp01((frame - NODE_ADOPT[i]!) / 12);
          const adopted = frame >= NODE_ADOPT[i]!;
          const r = n.champion ? 12 : 6.5;
          const fill = n.champion ? "#3b9eff" : adopted ? "#7bbcff" : "#475569";
          return (
            <g key={i}>
              {at > 0 && at < 1 && (
                <circle cx={n.x} cy={n.y} r={interpolate(at, [0, 1], [r, r + 22])} fill="none" stroke="#3b9eff" strokeWidth={1.5} opacity={interpolate(at, [0, 1], [0.7, 0])} />
              )}
              {n.champion && <circle cx={n.x} cy={n.y} r={r + 7} fill="none" stroke="#3b9eff" strokeOpacity={0.3} strokeWidth={2} />}
              <circle cx={n.x} cy={n.y} r={r} fill={fill} stroke={n.champion ? "#cfe6ff" : "#0b1322"} strokeWidth={n.champion ? 2 : 1} />
            </g>
          );
        })}
      </svg>

      <div style={{ position: "absolute", left: 36, top: 32, fontFamily: MONO }}>
        <div style={{ color: "#3b9eff", fontSize: 32, letterSpacing: 3, textTransform: "uppercase" }}>Practices spreading</div>
      </div>
      <div style={{ position: "absolute", right: 36, top: 28, display: "flex", gap: 44, textAlign: "right", fontFamily: MONO }}>
        <Metric label="weak links" value={weakRemaining} color="#f87171" />
        <Metric label="adoption" value={`${adoptionPct}%`} color="#3b9eff" />
      </div>
    </AbsoluteFill>
  );
};
