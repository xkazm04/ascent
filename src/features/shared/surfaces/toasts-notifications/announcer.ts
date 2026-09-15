// The announcement layer (announcement-accessibility): one writer, its own serial queue independent of
// the visual one, politeness from the severity table (never a per-call-site grade), coalescing on the
// same semantic keys, assertive jumping the queue without erasing it, a bounded backlog that sheds
// oldest awareness first, and one region mutation per drain. Pure; the regions themselves are mounted
// by AnnouncerPanel at scene mount, EMPTY, and only ever written into.

import type { Politeness } from "./severity";

export interface Utterance {
  key: string;
  text: string;
  politeness: Politeness;
  /** Awareness-class utterances are what a storm sheds first. */
  awareness: boolean;
}

export interface Voiced extends Utterance {
  at: number;
}

export interface AnnouncerState {
  queue: Utterance[];
  /** The live regions' current text — the only thing assistive technology hears. */
  polite: string;
  assertive: string;
  /** Alternated on every write so two identical utterances in a row are still two mutations. */
  nonce: number;
  voiced: Voiced[];
  /** Time until the next drain — spacing so the previous utterance lands. */
  cooldownMs: number;
  dropped: number;
}

export const DRAIN_GAP_MS = 1_500;
export const QUEUE_CAP = 6;

export const emptyAnnouncer = (): AnnouncerState => ({ queue: [], polite: "", assertive: "", nonce: 0, voiced: [], cooldownMs: 0, dropped: 0 });

/** Enqueue one transition. Same key pending → replaced (the update, not the original). Assertive → front. */
export function enqueue(a: AnnouncerState, u: Utterance): AnnouncerState {
  let queue = a.queue.filter((q) => q.key !== u.key);
  queue = u.politeness === "assertive" ? [u, ...queue] : [...queue, u];
  let dropped = a.dropped;
  while (queue.length > QUEUE_CAP) {
    const idx = queue.findIndex((q) => q.awareness && q.politeness === "polite");
    if (idx === -1) break;
    queue.splice(idx, 1);
    dropped += 1;
  }
  return { ...a, queue, dropped };
}

/** One drain = one region mutation. Called by the scene clock; `drainNow` is the manual step. */
export function drainTick(a: AnnouncerState, dt: number, now: number): AnnouncerState {
  if (a.cooldownMs > 0) {
    const cooldownMs = a.cooldownMs - dt;
    if (cooldownMs > 0) return { ...a, cooldownMs };
    a = { ...a, cooldownMs: 0 };
  }
  return drainNow(a, now);
}

export function drainNow(a: AnnouncerState, now: number): AnnouncerState {
  const [next, ...rest] = a.queue;
  if (!next) return a;
  const nonce = a.nonce + 1;
  const written = { polite: next.politeness === "polite" ? next.text : a.polite, assertive: next.politeness === "assertive" ? next.text : a.assertive };
  return { ...a, ...written, queue: rest, nonce, voiced: [{ ...next, at: now }, ...a.voiced].slice(0, 8), cooldownMs: DRAIN_GAP_MS };
}

/** The text a region renders: the utterance plus a zero-width alternation so repeats still mutate. */
export const regionText = (text: string, nonce: number) => (text ? `${text}${nonce % 2 ? "​" : ""}` : "");
