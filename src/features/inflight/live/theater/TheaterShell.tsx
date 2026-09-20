"use client";

// THE THEATER — a chrome-less, full-screen page for a passive third monitor: is the standing runner
// running, what is it doing right now, is it going well, does it need me. Rendered by
// /theater/[slug] (signed in), by /live/shared/[token] for a `view: "theater"` kiosk link, and by
// `?demo=1` from the fixture on a simulated clock.
//
// Layout, top to bottom: the dateline + controls, the four-answer header (which the hero never
// changes), the HERO SLOT (theaterHeroSlot.ts — `?hero=<id>` picks one), the latest rail, and
// the cue cards floating above it. The shell owns the transport choice and the clocks; every piece
// below it is a rendering of `TheaterFeed` and the instant it is told to measure against — frozen at
// last contact when the pulse is stale, so nothing on the page pretends to move.

import { useReducedMotion } from "@/components/ui/useReducedMotion";
import { cockpitHref, ledgerHref } from "@/lib/org/runner-needs-you";
import type { PulseEvent } from "@/lib/local/runner-types";
import { TheaterCueCards } from "./TheaterCueCards";
import { TheaterEmpty } from "./TheaterEmpty";
import { TheaterHeader } from "./TheaterHeader";
import { TheaterLatestRail } from "./TheaterLatestRail";
import { TheaterTopBar, type TheaterMode } from "./TheaterTopBar";
import type { DemoScenario } from "./theaterFixture";
import { headerModel, nothingToReport } from "./theaterHeaderModel";
import { renderHero } from "./theaterHeroSlot";
import type { TheaterCue } from "./theaterCues";
import { useTheaterCues } from "./useTheaterCues";
import { useTheaterDemo } from "./useTheaterDemo";
import { feedStale, useTheaterPulse, type TheaterFeed } from "./useTheaterPulse";
import { useTheaterSound, type SoundMode } from "./useTheaterSound";

export type TheaterSource =
  | { kind: "org"; slug: string }
  | { kind: "kiosk"; slug: string; token: string }
  | { kind: "demo"; slug: string; scenario: DemoScenario; startAtS: number };

type Arrive = (events: PulseEvent[]) => void;
type Render = (feed: TheaterFeed) => React.ReactNode;

function LiveFeed({ url, onArrivals, render }: { url: string; onArrivals: Arrive; render: Render }) {
  const feed = useTheaterPulse(url, { onArrivals });
  return <>{render(feed)}</>;
}

function DemoFeed({ scenario, startAtS, onArrivals, render }: { scenario: DemoScenario; startAtS: number; onArrivals: Arrive; render: Render }) {
  const feed = useTheaterDemo(scenario, { startAtS, onArrivals });
  return <>{render(feed)}</>;
}

export function pulseUrl(source: TheaterSource): string | null {
  if (source.kind === "org") return `/api/org/loop/pulse?org=${encodeURIComponent(source.slug)}`;
  if (source.kind === "kiosk") return `/api/live/pulse?token=${encodeURIComponent(source.token)}`;
  return null;
}

function note(source: TheaterSource): string | null {
  if (source.kind === "kiosk") return "kiosk · read-only";
  if (source.kind === "demo") return `demo · fixture data${source.scenario === "running" ? "" : ` · ${source.scenario}`}`;
  return null;
}

interface StageProps {
  feed: TheaterFeed;
  source: TheaterSource;
  sound: SoundMode;
  onToggleSound: () => void;
  cards: readonly TheaterCue[];
  reducedMotion: boolean;
  heroId: string | null;
}

export function TheaterStage({ feed, source, sound, onToggleSound, cards, reducedMotion, heroId }: StageProps) {
  const stale = feedStale(feed);
  const clock = stale && feed.receivedAt != null ? feed.receivedAt : feed.now;
  // With nothing true yet, ONE component answers (TheaterEmpty) and the others stand down — see its
  // note. `nothingToReport` is the same predicate the header's quiet mode uses, so they cannot differ.
  const quiet = !stale && feed.loaded && nothingToReport(feed.pulse);
  const model = headerModel({
    pulse: feed.pulse,
    loaded: feed.loaded,
    stale,
    clock,
    heardAgoMs: feed.receivedAt != null ? Math.max(0, feed.now - feed.receivedAt) : null,
    error: feed.error,
    ledgerHref: source.kind === "org" ? ledgerHref(source.slug) : null,
  });
  const mode: TheaterMode = source.kind;
  return (
    <div className="flex min-h-screen flex-col bg-ink text-slate-200" data-theater={mode} data-stale={stale || undefined}>
      <TheaterTopBar slug={source.slug} mode={mode} note={note(source)} sound={sound} onToggleSound={onToggleSound} />
      <TheaterHeader model={model} />
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {quiet ? (
          <TheaterEmpty slug={source.slug} href={source.kind === "org" ? cockpitHref(source.slug) : null} />
        ) : feed.pulse ? (
          renderHero(heroId, { pulse: feed.pulse, now: clock, reducedMotion })
        ) : (
          <p className="px-6 py-6 type-title text-slate-400">
            {!feed.loaded ? (stale ? "The server is not answering yet." : "Connecting…") : `No runner is reporting for ${source.slug}.`}
          </p>
        )}
      </main>
      {quiet ? null : <TheaterLatestRail events={feed.pulse?.latest ?? []} arrivedKeys={feed.arrivedKeys} reducedMotion={reducedMotion} />}
      <TheaterCueCards cards={cards} reducedMotion={reducedMotion} />
    </div>
  );
}

export function TheaterShell({ source, soundPreselect = false, heroId = null }: { source: TheaterSource; soundPreselect?: boolean; heroId?: string | null }) {
  const sound = useTheaterSound(soundPreselect);
  const cues = useTheaterCues(sound.mode === "on");
  const reducedMotion = useReducedMotion();
  const render: Render = (feed) => (
    <TheaterStage feed={feed} source={source} sound={sound.mode} onToggleSound={sound.toggle} cards={cues.cards} reducedMotion={reducedMotion} heroId={heroId} />
  );
  if (source.kind === "demo") return <DemoFeed scenario={source.scenario} startAtS={source.startAtS} onArrivals={cues.push} render={render} />;
  return <LiveFeed url={pulseUrl(source)!} onArrivals={cues.push} render={render} />;
}
