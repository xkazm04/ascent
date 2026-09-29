"use client";

// Posture quadrants: adoption (x) by rigor (y). Labels come from the product's POSTURE_META; the drawn
// motif and the one-sentence description per quadrant are this page's own (stylised, not measured).

import { useState } from "react";
import { at } from "./at";
import { HUES, PRISM_POSTURES } from "./prismModel";

type PostureId = (typeof PRISM_POSTURES)[number]["id"];

const PQ: Record<PostureId, { x: number; y: number; axis: string; d: string }> = {
  "ai-native": { x: 1, y: 0, axis: "High adoption · high rigor", d: "Agents are used widely and the guardrails hold: tests, gates and review keep pace with what the agents produce." },
  ungoverned: { x: 1, y: 1, axis: "High adoption · low rigor", d: "AI is everywhere in the workflow, but tests, CI and review have not caught up. Bright, and scattered." },
  manual: { x: 0, y: 0, axis: "Low adoption · high rigor", d: "Strong tests and a reliable pipeline; AI is not yet part of how the team works. A steady, narrow line." },
  early: { x: 0, y: 1, axis: "Low adoption · low rigor", d: "Few shared AI conventions and few guardrails so far. The first lines are still to be lit." },
};

/** Deterministic scatter for the "ungoverned" quadrant (same picture on every render and every machine). */
function scatter(x: number, y: number) {
  let sd = 7;
  const rnd = () => {
    sd = (sd * 9301 + 49297) % 233280;
    return sd / 233280;
  };
  return HUES.map((h) =>
    Array.from({ length: 4 }, (_v, j) => {
      const cx0 = x + 24 + rnd() * 200;
      const cy0 = y + 24 + rnd() * 200;
      const a = rnd() * 6.28;
      return <path key={`${h}${j}`} d={`M${cx0.toFixed(1)} ${cy0.toFixed(1)}l${(Math.cos(a) * 22).toFixed(1)} ${(Math.sin(a) * 22).toFixed(1)}`} stroke={h} strokeWidth="2.6" strokeLinecap="round" />;
    }),
  );
}

function Art({ id, x, y }: { id: PostureId; x: number; y: number }) {
  const cx = x + 125, cy = y + 125;
  if (id === "ai-native") {
    return (
      <>
        <circle cx={cx} cy={cy} r="110" fill="url(#prism-qw)" />
        {HUES.map((h, i) => {
          const a = -Math.PI * 0.9 + i * ((Math.PI * 0.8) / 8);
          return <path key={h} d={`M${(cx + Math.cos(a) * 110).toFixed(1)} ${(cy + Math.sin(a) * 110 + 60).toFixed(1)}L${cx} ${cy}`} stroke={h} strokeWidth="2.4" opacity=".9" />;
        })}
        <circle cx={cx} cy={cy} r="7" fill="#fff" />
      </>
    );
  }
  if (id === "ungoverned") return <>{scatter(x, y)}</>;
  if (id === "manual") {
    return (
      <>
        <path d={`M${x + 20} ${y + 170}H${x + 230}`} stroke="#4CB2FF" strokeWidth="3" />
        {[0, 1, 2, 3, 4, 5].map((j) => (
          <path key={j} d={`M${x + 30} ${y + 60 + j * 16}H${x + 220}`} stroke="rgba(242,238,230,.22)" />
        ))}
      </>
    );
  }
  return (
    <>
      <circle cx={cx} cy={cy} r="70" fill="url(#prism-qe)" />
      <circle cx={cx} cy={cy} r="4" fill="#FF5A5F" />
    </>
  );
}

export function PrismPosture() {
  const [hot, setHot] = useState<PostureId>("ai-native");
  const [hov, setHov] = useState(false);
  const q = PRISM_POSTURES.find((p) => p.id === hot) ?? at(PRISM_POSTURES, 0);
  const P = PQ[hot];
  const show = (id: PostureId) => {
    setHov(true);
    setHot(id);
  };
  return (
    <div className="posture">
      <div className="po-stage" aria-live="polite">
        <p className="eyebrow"><span className="sw"></span>Posture · adoption × rigor</p>
        <h3>{q.label}</h3>
        <p className="mono" style={{ fontSize: 14, color: "var(--mute)" }}>{P.axis}</p>
        <p>{P.d}</p>
        <p className="note" style={{ marginTop: 6 }}>Two axes, four postures. Hover or focus a quadrant.</p>
      </div>
      <svg className={hov ? "po-map hov" : "po-map"} viewBox="0 0 520 540" role="group" aria-label="Posture quadrants" onMouseLeave={() => setHov(false)} onBlur={() => setHov(false)}>
        <defs>
          <radialGradient id="prism-qw">
            <stop offset="0" stopColor="#fff" stopOpacity=".85" />
            <stop offset=".4" stopColor="#dfe1ff" stopOpacity=".25" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="prism-qe">
            <stop offset="0" stopColor="#FF5A5F" stopOpacity=".6" />
            <stop offset="1" stopColor="#FF5A5F" stopOpacity="0" />
          </radialGradient>
        </defs>
        {PRISM_POSTURES.map((p) => {
          const pq = PQ[p.id];
          const x = 10 + pq.x * 252;
          const y = 10 + pq.y * 252;
          return (
            <g
              key={p.id}
              className={p.id === hot ? "q hot" : "q"}
              tabIndex={0}
              role="button"
              aria-label={`${p.label}: ${pq.axis}`}
              onMouseEnter={() => show(p.id)}
              onFocus={() => show(p.id)}
              onClick={() => show(p.id)}
            >
              <rect className="edge" x={x} y={y} width="248" height="248" rx="3" fill="rgba(242,238,230,.025)" stroke="rgba(242,238,230,.16)" />
              <Art id={p.id} x={x} y={y} />
              <text x={x + 14} y={y + 232} fill="#f2eee6" fontFamily="Segoe UI,Arial,sans-serif" fontSize="17" fontWeight="600">{p.label}</text>
            </g>
          );
        })}
        <text x="262" y="532" textAnchor="middle" fill="#a6abbd" fontFamily="Cascadia Mono,Consolas,monospace" fontSize="14">adoption →</text>
      </svg>
    </div>
  );
}
