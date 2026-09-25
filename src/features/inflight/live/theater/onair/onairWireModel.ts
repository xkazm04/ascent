// THE WIRE AND THE SLATES — the newest events as rows, and the landing slates the cue budget allows.
//
// A slate is a CUE, not a second celebration system: it appears only while a `celebrate` card from
// the shared cue controller (`useTheaterCues` → `theaterCues.ts`) is up, so it inherits that budget —
// at most one cue per `CUE_GAP_MS`, a burst coalesced into one, and a cue that also carries an
// attention event speaks as ATTENTION (the CALL corner), never as a landing. It sits on the landed
// lane's own monitor, so no landing ever covers the CALL.

import type { LoopPulse, PulseEvent } from "@/lib/local/runner-types";
import type { TheaterCue } from "../theaterCues";
import { eventKey } from "../theaterPulseParse";
import { repoShort, toMs } from "../theaterFormat";
import { eventTone, fmtHms, KIND_WORD, type EventTone } from "./onairFormat";

/** A wire row older than this is dimmed: still true, no longer news. */
export const WIRE_OLD_MS = 15 * 60_000;
export const WIRE_MAX = 12;

export interface WireRow {
  key: string;
  time: string;
  word: string;
  tone: EventTone;
  headline: string;
  fresh: boolean;
  old: boolean;
}

export function wireRows(p: LoopPulse | null, arrived: ReadonlySet<string>): WireRow[] {
  if (!p) return [];
  const pulseMs = toMs(p.at) ?? 0;
  return p.latest.slice(0, WIRE_MAX).map((e) => {
    const key = eventKey(e);
    const at = toMs(e.at);
    return {
      key,
      time: fmtHms(at) ?? "",
      word: KIND_WORD[e.kind] ?? e.kind,
      tone: eventTone(e.kind),
      headline: e.headline,
      fresh: arrived.has(key),
      old: at != null && pulseMs - at > WIRE_OLD_MS,
    };
  });
}

export interface Slate {
  id: string;
  repo: string;
  headline: string;
  /** "verified close · D4 · cited claims" — the close that landed with it, when the pulse says so. */
  label: string | null;
}

const closeLabel = (e: PulseEvent, latest: readonly PulseEvent[]): string | null => {
  const close = latest.find((x) => x.kind === "verified-close" && x.repo === e.repo && x.at === e.at);
  return close ? close.headline.replace(/^\S+\s+closed\s+/, "") : null;
};

/** The slates up right now, by repo: one per landed repo of every celebrate card on screen. */
export function slatesFrom(cards: readonly TheaterCue[], p: LoopPulse | null): Map<string, Slate> {
  const out = new Map<string, Slate>();
  for (const card of cards) {
    if (card.kind !== "celebrate") continue;
    for (const e of card.events) {
      if (e.kind !== "landed") continue;
      out.set(e.repo, { id: `${card.id}:${e.repo}`, repo: e.repo, headline: e.headline, label: closeLabel(e, p?.latest ?? []) });
    }
  }
  return out;
}

/** TODAY's second line while a slate with a close is up: "+1 verified · kp · D4 · cited claims". */
export function verifiedLine(slates: ReadonlyMap<string, Slate>): string | null {
  for (const s of slates.values()) if (s.label) return `+1 verified · ${repoShort(s.repo)} · ${s.label}`;
  return null;
}
