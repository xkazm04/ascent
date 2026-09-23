"use client";

import { useState } from "react";
import {
  BandLadder,
  Distribution,
  Legend,
  STATE_LABEL,
  ladderLegendStates,
  type LadderBand,
  type VizState,
} from "@/components/org/viz";
import { LEVELS, levelForScore } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import { projects } from "./sampleProjects";
import styles from "./playground.module.css";

/** Invented playground series — labelled as a study, never as live org data. */
const STUDY = {
  Week: [42, 57, 48, 70, 63, 82, 94],
  Month: [32, 45, 60, 78],
} as const;

type Period = keyof typeof STUDY;

function five(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.round((sorted.length - 1) * p)]!;
  return { min: sorted[0]!, q1: pick(0.25), median: pick(0.5), q3: pick(0.75), max: sorted[sorted.length - 1]! };
}

function levelBands(values: readonly number[]): LadderBand[] {
  return LEVELS.map((level) => {
    const count = values.filter((v) => levelForScore(v).id === level.id).length;
    const state: VizState = count > 0 ? "measured" : "missing";
    const [lo, hi] = level.band;
    return {
      id: level.id,
      label: `${level.id} · ${level.name}`,
      state,
      count,
      color: scoreHex((lo + hi) / 2),
    };
  });
}

function DataVizStudy() {
  const [period, setPeriod] = useState<Period>("Week");
  const values = STUDY[period];
  const latest = values.at(-1)!;
  const bands = levelBands(values);
  const states = ladderLegendStates(bands, null);
  return (
    <div className={styles.demo}>
      <div className={styles.demoToolbar}>
        <h3>Playground readiness</h3>
        <div className={styles.segmented}>
          {(["Week", "Month"] as const).map((p) => (
            <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.bigMetric} style={{ color: scoreHex(latest) }}>
        {latest}
        <span>/ 100</span>
        <small>{STATE_LABEL.measured} · study score</small>
      </div>
      <Distribution
        {...five(values)}
        you={latest}
        n={values.length}
        digits={0}
        label={`${period} playground readiness`}
      />
      <BandLadder bands={bands} title={`${period} playground level bands`} />
      <Legend states={states} />
      <p className={styles.hint} role="status">
        Playground study series — not live org data. Empty bands are {STATE_LABEL.missing.toLowerCase()}, never a
        zero.
      </p>
    </div>
  );
}

export function DataCharts({ slug }: { slug: string }) {
  const [node, setNode] = useState("web-platform");
  if (slug === "data-viz") return <DataVizStudy />;
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
