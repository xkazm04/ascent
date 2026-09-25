"use client";

// THE ON AIR WALL — the theater as a broadcast multiview (`?wall=onair`; contest live-fleet-rounds,
// the owner's pick): a strip of the four answers, a PROGRAM monitor on the lane at work with its live
// file map, three PREVIEWS, a WIRE of the newest events, a small monitor for every other repo, and the
// honesty label. Same transport, cue controller and sound as the classic stage (TheaterShell.tsx).
//
// The rules that bind the classic theater bind this one:
//   • The four answers are `headerModel()` — the classic header's model — so the walls cannot disagree.
//   • Nothing to report → `TheaterEmpty` says it once (the same `nothingToReport` predicate).
//   • STALE → every liveness claim switches together: the clock freezes at last contact, ON AIR becomes
//     NO SIGNAL, every monitor holds its last frame behind NO SIGNAL with "last heard", and nothing moves.
//   • The CUE BUDGET: a landing slate appears only while a celebrate cue from the shared controller is
//     up (one per CUE_GAP_MS, attention outranking a landing), and the attention cue IS the CALL corner,
//     so `TheaterCueCards` is not rendered here.
//   • The kiosk renders no link at all, and shows only what its stripped pulse carries.

import { cockpitHref, ledgerHref } from "@/lib/org/runner-needs-you";
import { TheaterEmpty } from "../TheaterEmpty";
import type { TheaterSource } from "../TheaterShell";
import type { TheaterCue } from "../theaterCues";
import { fmtDuration } from "../theaterFormat";
import { headerModel, nothingToReport } from "../theaterHeaderModel";
import { feedStale, type TheaterFeed } from "../useTheaterPulse";
import type { SoundMode } from "../useTheaterSound";
import { needsDetail } from "./onairBlank";
import { cx, deskHref, fmtHms } from "./onairFormat";
import { smallItems } from "./onairSmallsModel";
import { slatesFrom, verifiedLine } from "./onairWireModel";
import { OnAirFooter } from "./OnAirFooter";
import { OnAirGrid } from "./OnAirGrid";
import { OnAirSmalls } from "./OnAirSmalls";
import { OnAirStrip, type OnAirState } from "./OnAirStrip";
import { useOnAirMemory } from "./useOnAirMemory";
import styles from "./onairWall.module.css";

export interface OnAirWallProps {
  feed: TheaterFeed;
  source: TheaterSource;
  sound: SoundMode;
  onToggleSound: () => void;
  cards: readonly TheaterCue[];
  reducedMotion: boolean;
}

export function OnAirWall({ feed, source, sound, onToggleSound, cards, reducedMotion }: OnAirWallProps) {
  const stale = feedStale(feed);
  const clock = stale && feed.receivedAt != null ? feed.receivedAt : feed.now;
  const heardAgoMs = feed.receivedAt != null ? Math.max(0, feed.now - feed.receivedAt) : null;
  const linked = source.kind !== "kiosk";
  const model = headerModel({
    pulse: feed.pulse,
    loaded: feed.loaded,
    stale,
    clock,
    heardAgoMs,
    error: feed.error,
    ledgerHref: linked ? ledgerHref(source.slug) : null,
  });
  const quiet = !stale && feed.loaded && nothingToReport(feed.pulse);
  const memory = useOnAirMemory(feed.pulse);
  const pulse = feed.pulse;
  const slates = slatesFrom(cards, pulse);

  const heardWords = heardAgoMs != null ? `last heard ${fmtDuration(heardAgoMs)} ago` : "no contact yet";
  const heard = heardAgoMs != null ? `Last heard ${fmtDuration(heardAgoMs)} ago · frame as of ${fmtHms(clock)}` : "No contact yet";
  const onAir: OnAirState = stale ? "lost" : model.running.live ? "on" : "off";
  const clockLabel = stale ? heardWords.toUpperCase() : source.kind === "demo" ? "DEMO CLOCK · LOCAL" : "LOCAL TIME";
  const verified = stale ? null : verifiedLine(slates);
  const todaySub = model.today.asOf ? { text: model.today.asOf, asOf: true } : verified ? { text: verified, asOf: false } : null;
  const needsLine = model.needs.sub ?? (model.needs.amber ? needsDetail(pulse, clock, linked) : feed.loaded && !quiet ? "no plan waits, no breaker fired" : "");

  const onMonitor = new Set<string>();
  for (const id of [memory.slots.pgm, ...memory.slots.pvw]) {
    const lane = pulse?.lanes.find((l) => l.laneId === id);
    if (lane) onMonitor.add(lane.repo);
  }
  const smalls = smallItems(pulse, onMonitor);

  return (
    <div className={cx(styles.wall, reducedMotion && styles.rm)} data-theater={source.kind} data-wall="onair" data-stale={stale || undefined}>
      <OnAirStrip
        model={model}
        clockText={fmtHms(clock) ?? "--:--:--"}
        clockLabel={clockLabel}
        onAir={onAir}
        deskHref={linked ? deskHref(source.slug) : null}
        todaySub={todaySub}
        needsLine={needsLine}
        needsHref={model.needs.href}
      />
      {quiet ? (
        <TheaterEmpty slug={source.slug} href={source.kind === "org" ? cockpitHref(source.slug) : null} />
      ) : pulse ? (
        <OnAirGrid pulse={pulse} memory={memory} clock={clock} stale={stale} heard={heard} slates={slates} arrivedKeys={feed.arrivedKeys} reducedMotion={reducedMotion} />
      ) : (
        <div className={styles.hold}>
          {!feed.loaded ? (stale ? "The server is not answering yet." : "Connecting…") : `No runner is reporting for ${source.slug}.`}
        </div>
      )}
      {quiet || !pulse ? null : <OnAirSmalls items={smalls.items} cols={smalls.cols} stale={stale} heardShort={heardWords} />}
      <OnAirFooter source={source} sound={sound} onToggleSound={onToggleSound} />
    </div>
  );
}
