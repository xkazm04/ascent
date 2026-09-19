"use client";

import { useState } from "react";
import { LEVEL_HEX } from "@/lib/ui";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import styles from "./playground.module.css";

const TOKENS = [
  { name: "accent", paint: "var(--color-accent)", use: "the one azure" },
  { name: "ink", paint: "var(--color-ink)", use: "page canvas" },
  { name: "surface", paint: "var(--color-surface)", use: "panel base" },
  { name: "divider", paint: "var(--color-divider)", use: "hairline" },
  { name: "danger", paint: "var(--color-danger)", use: "error" },
  { name: "warn", paint: "var(--color-warn)", use: "warning" },
  { name: "success", paint: "var(--color-success)", use: "success notices" },
] as const;

const LEVEL_IDS = Object.keys(LEVEL_HEX) as (keyof typeof LEVEL_HEX)[];

function chip(paint: string) {
  return {
    display: "inline-block",
    width: 16,
    height: 16,
    borderRadius: 3,
    background: paint,
    boxShadow: "inset 0 0 0 1px var(--color-divider)",
    verticalAlign: "middle",
  } as const;
}

export function AppearanceStudy({ slug }: { slug: string }) {
  const [position, setPosition] = useState(false);
  const [motion, setMotion] = useState(true);
  const [quality, setQuality] = useState("Balanced");
  const reduced = useReducedMotion();
  if (slug === "design-tokens")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>Token table</h3>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Token</th>
                <th>Use</th>
                <th>Swatch</th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((token) => (
                <tr key={token.name}>
                  <td>
                    <strong>{token.name}</strong>
                  </td>
                  <td>{token.use}</td>
                  <td>
                    <i aria-hidden style={chip(token.paint)} />
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>LEVEL_HEX</strong>
                </td>
                <td>level/score color, only</td>
                <td>
                  {LEVEL_IDS.map((id) => (
                    <span key={id} style={{ marginRight: 10 }}>
                      <i aria-hidden style={chip(LEVEL_HEX[id])} /> {id}
                    </span>
                  ))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={styles.hint} role="status">
          One azure on cold ink. LEVEL_HEX for levels and scores, nothing else.
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
