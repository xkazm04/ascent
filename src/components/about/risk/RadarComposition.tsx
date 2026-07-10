"use client";

// Remotion composition for "Catch it early": the radar IDENTIFIES risks (blips ping in, alerting)
// while a MITIGATION WAVE expands from the center — each previously-identified blip resolves (alert
// red/amber → green) the instant the wave front sweeps over it. One blip sits beyond the wave's reach
// and stays open; the security gate flips FAIL → PASS once every critical is cleared. Live metrics
// count open risks down and mitigations up. Frame-deterministic via useCurrentFrame.

import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { CX, CY, R, BLIPS, WAVE_START, WAVE_END, WAVE_MAX, BEAM_END } from "./radar";
import { MONO, clamp01, Metric, lerpHex, W, H } from "../compositionShared";

const GREEN = "#22c55e";

export const RadarComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const beamAngle = interpolate(frame, [0, BEAM_END], [-90, 450], { extrapolateRight: "clamp" });
  const beamOpacity = interpolate(frame, [BEAM_END - 35, BEAM_END], [0.4, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const waveR = interpolate(frame, [WAVE_START, WAVE_END], [0, WAVE_MAX], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const waveFront = frame >= WAVE_START && frame <= WAVE_END + 8;

  const detected = BLIPS.filter((b) => frame >= b.detect).length;
  const openRisks = BLIPS.filter((b) => frame >= b.detect && frame < b.mitigate).length;
  const mitigated = BLIPS.filter((b) => frame >= b.mitigate).length;
  const criticalOpen = BLIPS.filter((b) => b.critical && frame >= b.detect && frame < b.mitigate).length;

  const gate = detected === 0 ? "scan" : criticalOpen > 0 ? "fail" : "pass";
  const gateColor = gate === "pass" ? GREEN : gate === "fail" ? "#ef4444" : "#3b9eff";
  const gateText = gate === "pass" ? "Gate Pass" : gate === "fail" ? "Gate Fail" : "Scanning";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#080d1a",
        backgroundImage: "radial-gradient(55% 55% at 50% 50%, rgba(59,158,255,0.07), transparent 70%)",
      }}
    >
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="radar-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b9eff" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#3b9eff" stopOpacity={0} />
          </linearGradient>
          {/* feathered fill (fades to nothing at the edge) + a blur for the glowing front, so the
              wave reads as a soft shadow rather than a fixed borderline */}
          <radialGradient id="secured-fill">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.1} />
            <stop offset="76%" stopColor="#22c55e" stopOpacity={0.07} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </radialGradient>
          <filter id="wave-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {[70, 130, R].map((r) => (
          <circle key={r} cx={CX} cy={CY} r={r} fill="none" stroke="#1e293b" strokeWidth={1} />
        ))}
        <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} stroke="#16233b" strokeWidth={1} />
        <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} stroke="#16233b" strokeWidth={1} />

        {/* identification sweep */}
        <g style={{ transformOrigin: `${CX}px ${CY}px`, transform: `rotate(${beamAngle + 90}deg)` }} opacity={beamOpacity}>
          <path d={`M${CX} ${CY} L${CX - 23} ${CY - 189} A189 189 0 0 1 ${CX + 23} ${CY - 189} Z`} fill="url(#radar-beam)" />
          <line x1={CX} y1={CY} x2={CX} y2={CY - R} stroke="#7bbcff" strokeWidth={1.5} />
        </g>

        {/* mitigation wave from center: a feathered "secured" disc + a soft blurred front (a glow,
            not a hard borderline) */}
        {waveR > 2 && <circle cx={CX} cy={CY} r={waveR} fill="url(#secured-fill)" />}
        {waveFront && waveR > 2 && (
          <circle
            cx={CX}
            cy={CY}
            r={waveR}
            fill="none"
            stroke="#34d399"
            strokeWidth={3}
            opacity={interpolate(frame, [WAVE_END - 15, WAVE_END + 8], [0.5, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
            filter="url(#wave-glow)"
          />
        )}

        {BLIPS.map((b, i) => {
          if (frame < b.detect) return null;
          const age = frame - b.detect;
          const resolved = frame >= b.mitigate;
          const resolving = Number.isFinite(b.mitigate) ? clamp01((frame - b.mitigate) / 18) : 0;
          const alertColor = b.critical ? "#ef4444" : "#f97316";
          const core = lerpHex(alertColor, GREEN, resolving);
          // pop-in: scale up from 0 with a slight overshoot so the appearance is visible
          const scale = interpolate(age, [0, 6, 12], [0, 1.3, 1], { extrapolateRight: "clamp" });
          // ongoing alert ping — starts once the pop has settled, until the blip is resolved
          const ping = !resolved && age > 12 ? ((age - 12) % 24) / 24 : -1;
          return (
            <g key={i}>
              {age < 18 && (
                <circle cx={b.x} cy={b.y} r={interpolate(age, [0, 18], [5, 26])} fill="none" stroke={alertColor} strokeWidth={1.6} opacity={interpolate(age, [0, 18], [0.75, 0])} />
              )}
              {ping >= 0 && (
                <circle cx={b.x} cy={b.y} r={6 + ping * 14} fill="none" stroke={alertColor} strokeWidth={1.3} opacity={(1 - ping) * 0.5} />
              )}
              {resolving > 0 && resolving < 1 && (
                <circle cx={b.x} cy={b.y} r={interpolate(resolving, [0, 1], [6, 22])} fill="none" stroke={GREEN} strokeWidth={1.6} opacity={interpolate(resolving, [0, 1], [0.8, 0])} />
              )}
              <circle cx={b.x} cy={b.y} r={5.5 * scale} fill={core} stroke="#0b1322" strokeWidth={1} />
            </g>
          );
        })}
        <circle cx={CX} cy={CY} r={3} fill="#7bbcff" />
      </svg>

      <div style={{ position: "absolute", left: 36, top: 32, fontFamily: MONO }}>
        <div style={{ color: "#3b9eff", fontSize: 32, letterSpacing: 3, textTransform: "uppercase" }}>Risk radar</div>
      </div>
      <div style={{ position: "absolute", right: 36, top: 28, display: "flex", gap: 44, textAlign: "right", fontFamily: MONO }}>
        <Metric label="open risks" value={openRisks} color="#f97316" />
        <Metric label="mitigated" value={mitigated} color={GREEN} />
      </div>
      <div style={{ position: "absolute", left: 36, bottom: 30, fontFamily: MONO }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 20px",
            borderRadius: 12,
            border: `1px solid ${gateColor}`,
            background: `${gateColor}1a`,
          }}
        >
          <span style={{ width: 13, height: 13, borderRadius: 99, background: gateColor }} />
          <span style={{ color: gateColor, fontSize: 28, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 }}>{gateText}</span>
        </span>
      </div>
    </AbsoluteFill>
  );
};
