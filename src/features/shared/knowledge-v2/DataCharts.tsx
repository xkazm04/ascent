"use client";

import { useState } from "react";
import { projects } from "./sampleProjects";
import styles from "./playground.module.css";

export function DataCharts({ slug }: { slug: string }) {
  const [period, setPeriod] = useState("Week");
  const [node, setNode] = useState("web-platform");
  if (slug === "data-viz") {
    const values = period === "Week" ? [42, 57, 48, 70, 63, 82, 94] : [32, 45, 60, 78];
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>Readiness over time</h3>
          <div className={styles.segmented}>
            {["Week", "Month"].map((p) => (
              <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.bigMetric}>
          {values.at(-1)}
          <span>/ 100</span>
          <small>{period === "Week" ? "+52 this week" : "+46 this month"}</small>
        </div>
        <div className={styles.chart} role="img" aria-label={`${period} readiness scores: ${values.join(", ")}`}>
          {values.map((v, i) => (
            <div key={i}>
              <span>{v}</span>
              <i style={{ height: `${v * 2}px` }} />
              <small>
                {period === "Week" ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i] : `Week ${i + 1}`}
              </small>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (slug === "canvas-graph")
    return (
      <div className={styles.demo}>
        <div className={styles.demoToolbar}>
          <h3>Dependency map</h3>
          <span>Select a node</span>
        </div>
        <div className={styles.graph}>
          <svg viewBox="0 0 600 240" preserveAspectRatio="none" aria-hidden="true">
            <path d="M110 65L300 120 490 65M110 180L300 120 490 180" />
          </svg>
          {projects.slice(0, 5).map((p, i) => (
            <button
              key={p.name}
              aria-pressed={node === p.name}
              style={{ left: `${[3, 36, 69, 3, 69][i]}%`, top: `${[18, 43, 18, 68, 68][i]}%` }}
              onClick={() => setNode(p.name)}
            >
              ◈ &nbsp; {p.name}
            </button>
          ))}
        </div>
        <div className={styles.insight} role="status">
          <strong>{node}</strong>
          <span>
            {projects.find((p) => p.name === node)?.language} · Readiness {projects.find((p) => p.name === node)?.score}
            /100
          </span>
        </div>
      </div>
    );
  return null;
}
