"use client";

// The diff-comparison showcase: a scan comparison desk for one fictional repository. The pair region
// names the question, the level region names the level, the offload hook computes with an identity
// and a budget, the modes region renders the result in the reader's mode, and the honesty, invisible
// and drift regions show what the diff must still disclose. Every technique of the registry's
// `diff-comparison` subject is a region carrying data-technique="<slug>" for the frame to spotlight.
// `reduced` and `volume` come from props — never a media query; framer-motion enters via the body map.

import { useMemo, useState } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import type { Mode } from "./DiffView";
import { DriftRegion } from "./DriftRegion";
import { REPO, signalsFor } from "./fixtures";
import { HonestyRegion, CAPS } from "./HonestyRegion";
import { InvisibleRegion } from "./InvisibleRegion";
import type { Alignment, Level } from "./kernel";
import { LevelRegion } from "./LevelRegion";
import { ModesRegion } from "./ModesRegion";
import { OffloadRegion } from "./OffloadRegion";
import { DEFAULT_SPECIES, PairRegion, resolvePair, type PairState } from "./PairRegion";
import { useComparison } from "./useComparison";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const [pair, setPair] = useState<PairState>({ species: DEFAULT_SPECIES, candidate: "scan-1204", self: false, pruned: false });
  const [level, setLevel] = useState<Level>("fields");
  const [alignment, setAlignment] = useState<Alignment>("keyed");
  const [remembered, setRemembered] = useState<Mode>("side-by-side");
  const [override, setOverride] = useState<Mode | null>(null);
  const [cap, setCap] = useState<number>(CAPS[1]);
  const [killed, setKilled] = useState(false);

  const resolved = resolvePair(pair);
  // The declared species has no scan on the left; the field kernel compares the candidate with the
  // temporal baseline so the desk stays populated, and the pair notice says the diff is not the answer.
  const baselineId = resolved.baseline ?? "scan-1191";
  const base = useMemo(() => signalsFor(volume, baselineId), [volume, baselineId]);
  const cand = useMemo(() => signalsFor(volume, resolved.candidate), [volume, resolved.candidate]);
  const cmp = useComparison({ pairKey: `${baselineId}→${resolved.candidate}`, level, alignment, base, cand }, { killed });
  const result = cmp.state.status === "ready" ? cmp.state.result : null;

  return (
    <div className="space-y-3" data-scene="diff-comparison" data-reduced={reduced}>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString("en-US")}</span> fictional detector signals per scan of{" "}
        <span className="font-mono text-slate-300">{REPO}</span>, seeded; a window of the diff is rendered. Nothing here is an Ascent org.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <PairRegion pair={pair} onChange={setPair} />
        <LevelRegion level={level} onLevel={setLevel} alignment={alignment} onAlignment={setAlignment} base={base} cand={cand} result={result} />
      </div>
      <OffloadRegion cmp={cmp} killed={killed} onKill={setKilled} reduced={reduced} />
      <ModesRegion
        state={cmp.state}
        remembered={remembered}
        onRemember={setRemembered}
        override={override}
        onOverride={setOverride}
        cap={cap}
        reduced={reduced}
        pairNotice={pair.self || resolved.baseline === null ? resolved.notice : null}
      />
      <div className="grid gap-3 lg:grid-cols-2">
        <HonestyRegion state={cmp.state} cap={cap} onCap={setCap} retry={cmp.retry} base={base} cand={cand} />
        <InvisibleRegion pairLabel={resolved.label} />
      </div>
      <DriftRegion />
    </div>
  );
}
