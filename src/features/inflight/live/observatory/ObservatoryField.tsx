"use client";

// The observatory field — a sky chart of the watched fleet in adoption × rigor space.
//
// It is deliberately aria-hidden: an SVG scatter of 40 circles is not navigable, and every body it
// draws is also a real <button> in <ObservatoryList>, which is the accessible twin. Selection state
// is owned by the PARENT and shared by both, so a lasso here checks the rows there and vice versa.

import { useId, useMemo, useState } from "react";
import { FIELD, isPlotted, type ObservatoryBody } from "./observatoryModel";
import { clusterBodies, isCluster, lassoHitTest, type ObservatoryItem, type Pt } from "./observatoryGeometry";
import { ObservatoryChrome } from "./ObservatoryChrome";
import { BodyMark, BodyTrail, ClusterMark } from "./ObservatoryBody";
import { LassoRect, useLasso } from "./ObservatoryLasso";
import { driftFrames, useDriftProgress } from "./observatoryMotion";

export interface ObservatoryDrift {
  /** Where the bodies WERE. Bodies with no `before` twin appear at their final place (no fake glide). */
  before: ObservatoryBody[];
  /** Where they landed — normally the same array passed as `bodies`; it is what the tween targets. */
  after: ObservatoryBody[];
  /** Changing this replays the drift once; keep it stable to leave the field at rest. */
  runId?: string;
}

export interface ObservatoryFieldProps {
  bodies: ObservatoryBody[];
  selected: ReadonlySet<string>;
  onSelect: (next: Set<string>) => void;
  /** Repos currently being scanned — their bodies take the shared `.live-dot` heartbeat. */
  scanning?: ReadonlySet<string>;
  /** Plays the outcome drift once when supplied (and its `runId` changes). */
  drift?: ObservatoryDrift | null;
  onBodyOpen?: (fullName: string) => void;
  /** Above this many plotted bodies the field aggregates into quadrant-cell clusters. */
  clusterThreshold?: number;
  className?: string;
}

export function ObservatoryField({
  bodies,
  selected,
  onSelect,
  scanning,
  drift = null,
  onBodyOpen,
  clusterThreshold = 40,
  className = "",
}: ObservatoryFieldProps) {
  const gradientId = useId();
  // Clusters the operator has opened up; expansion is view state, never a change to the model.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const items = useMemo(() => {
    const clustered = clusterBodies(bodies, clusterThreshold);
    return clustered.flatMap<ObservatoryItem>((i) => (isCluster(i) && expanded.has(i.id) ? i.members : [i]));
  }, [bodies, clusterThreshold, expanded]);

  const progress = useDriftProgress(drift ? drift.runId ?? "drift" : null);
  const frames = useMemo(() => {
    if (!drift) return null;
    return driftFrames(drift.before, drift.after.filter(isPlotted), progress);
  }, [drift, progress]);
  const frameFor = (fullName: string) => frames?.find((f) => f.body.fullName === fullName) ?? null;

  const toggle = (fullName: string) => {
    const next = new Set(selected);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    onSelect(next);
  };

  const pick = (polygon: Pt[], additive: boolean) => {
    if (polygon.length === 0) {
      if (!additive) onSelect(new Set());
      return;
    }
    const hit = lassoHitTest(polygon, items);
    onSelect(new Set(additive ? [...selected, ...hit] : hit));
  };

  const { lasso, handlers } = useLasso(pick);

  return (
    <svg
      viewBox={`0 0 ${FIELD.w} ${FIELD.h}`}
      aria-hidden
      data-testid="observatory-field"
      className={`w-full max-w-full touch-none select-none ${className}`}
      style={{ maxWidth: "100%" }}
      {...handlers}
    >
      <ObservatoryChrome gradientId={gradientId} />
      {items.map((item) => {
        if (isCluster(item)) {
          return (
            <ClusterMark
              key={item.id}
              cluster={item}
              selected={item.members.some((m) => selected.has(m.fullName))}
              onExpand={(id) => setExpanded(new Set([...expanded, id]))}
            />
          );
        }
        const f = frameFor(item.fullName);
        const at = f?.at ?? { x: item.x, y: item.y };
        return (
          <g key={item.fullName}>
            <BodyTrail trail={item.trail} to={at} fill={item.fill} />
            <BodyMark
              body={item}
              at={at}
              fill={f?.fill ?? item.fill}
              selected={selected.has(item.fullName)}
              scanning={scanning?.has(item.fullName) ?? false}
              crossed={(f?.crossed ?? false) && progress > 0.55}
              onToggle={toggle}
              onOpen={onBodyOpen}
            />
          </g>
        );
      })}
      <LassoRect lasso={lasso} />
    </svg>
  );
}
