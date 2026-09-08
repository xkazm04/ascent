"use client";

// The feed showcase: a fictional org's fleet-activity feed — scans, level changes, security findings,
// follow-ups, sync bursts — with one store behind it (feedStore.ts) and five regions, one per technique
// of the registry's `feed` subject, each carrying data-technique="<slug>" for the frame to spotlight.
// The viewport IS the live-prepend region; the other four hold the controls and readouts the feed
// reacts to. `reduced` and `volume` come from props: entrances are off under `reduced`, and the
// volume sizes the system of record (the feed holds a page of it, the reaper the rest). Nothing here
// loops on its own, so no pause control is owed.

import type { SurfaceSceneProps } from "../surfaceBody";
import { ChronologyRegion } from "./ChronologyPanel";
import { ClusterRegion } from "./ClusterPanel";
import { FeedRegion } from "./FeedRegion";
import { SPAN_DAYS } from "./fixtures";
import { ReadRegion } from "./ReadPanel";
import { RetentionRegion } from "./RetentionPanel";
import { useFeed } from "./useFeed";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  // The store is keyed on the volume: a new volume is a new system of record, not a mutation.
  return <FeedScene key={volume} reduced={reduced} volume={volume} />;
}

function FeedScene({ reduced, volume }: Omit<SurfaceSceneProps, "technique">) {
  const { s, d, dispatch } = useFeed(volume);
  return (
    <div className="space-y-3" data-scene="feed" data-reduced={reduced}>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString("en-US")}</span> fictional occurrences over {SPAN_DAYS} days, seeded; the feed holds a page of{" "}
        {s.server.length.toLocaleString("en-US")} retained. Scene clock: UTC, frozen at mount, advanced only by arrivals. Nothing here is an Ascent org.
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <FeedRegion s={s} d={d} dispatch={dispatch} reduced={reduced} />
        <div className="space-y-3">
          <ChronologyRegion s={s} dispatch={dispatch} />
          <ReadRegion s={s} d={d} dispatch={dispatch} />
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ClusterRegion s={s} d={d} dispatch={dispatch} />
        <RetentionRegion s={s} d={d} dispatch={dispatch} />
      </div>
    </div>
  );
}
