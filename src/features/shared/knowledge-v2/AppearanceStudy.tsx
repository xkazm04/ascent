"use client";

import { useState } from "react";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import styles from "./playground.module.css";

export function AppearanceStudy({ slug }: { slug: string }) {
  const [state, setState] = useState("Ready");
  const [accent, setAccent] = useState("Ascent");
  const [compact, setCompact] = useState(false);
  const [position, setPosition] = useState(false);
  const [motion, setMotion] = useState(true);
  const [quality, setQuality] = useState("Balanced");
  const reduced = useReducedMotion();
  if (slug === "design-tokens")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>Appearance</h3>
          <label>
            <input
              type="checkbox"
              checked={compact}
              onChange={(e) => {
                setCompact(e.target.checked);
                setState("Ready");
              }}
            />{" "}
            Compact
          </label>
        </div>
        <div className={styles.swatches}>
          {["Ascent", "Mint", "Amber"].map((name, i) => (
            <button
              key={name}
              aria-label={name}
              aria-pressed={accent === name}
              style={{ background: ["var(--kb-accent)", "var(--kb-green)", "var(--kb-warn)"][i] }}
              onClick={() => {
                setAccent(name);
                setState("Ready");
              }}
            >
              {accent === name ? "✓" : ""}
            </button>
          ))}
        </div>
        <div
          className={styles.themeCard}
          style={
            {
              "--demo-accent": { Ascent: "var(--kb-accent)", Mint: "var(--kb-green)", Amber: "var(--kb-warn)" }[accent],
              padding: compact ? 20 : 38,
            } as React.CSSProperties
          }
        >
          <span>YOUR WORKSPACE</span>
          <h3>A little more you.</h3>
          <p>Good defaults. Room to make it yours.</p>
          <button onClick={() => setState("Applied")}>{state === "Applied" ? "✓ Applied" : "Apply appearance"}</button>
        </div>
        <p className={styles.hint} role="status">
          {accent} · {compact ? "Compact" : "Comfortable"} spacing
        </p>
      </div>
    );
  if (slug === "motion" || slug === "adaptive-fidelity-tiers")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>{slug === "motion" ? "Move with intention" : "Visual fidelity"}</h3>
          <label>
            <input type="checkbox" checked={motion} onChange={(e) => setMotion(e.target.checked)} /> Motion
          </label>
        </div>
        {slug === "adaptive-fidelity-tiers" && (
          <div className={styles.segmented}>
            {["Essential", "Balanced", "Rich"].map((q) => (
              <button key={q} aria-pressed={quality === q} onClick={() => setQuality(q)}>
                {q}
              </button>
            ))}
          </div>
        )}
        <div className={styles.motionTrack} data-quality={quality}>
          <div
            className={styles.motionTile}
            style={{
              left: position ? "calc(100% - 92px)" : "12px",
              transition: reduced || !motion ? "none" : "left 550ms cubic-bezier(.2,.8,.2,1)",
            }}
          >
            ↗
          </div>
        </div>
        <div className={styles.demoFooter}>
          <span>
            {reduced ? "Reduced motion preference respected" : motion ? "550 ms · Ease out" : "Instant · Motion off"}
          </span>
          <button onClick={() => setPosition((p) => !p)}>
            Move {position ? "left" : "right"} {position ? "←" : "→"}
          </button>
        </div>
      </div>
    );
  return null;
}
