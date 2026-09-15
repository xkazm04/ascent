// ONE shared, self-scaling ticker for every live elapsed label in the scene (timestamp-display). It
// fires at the finest cadence any CURRENT subscriber needs — every second while the youngest label
// is fresh, slowing to 30s and then 5m as the labels age — restarts only when the target cadence
// changes, and stops at zero subscribers. A per-cell interval cannot be coalesced, cannot slow with
// age, and multiplies; this module is the infrastructure a second author would otherwise reinvent.
// It also owns `now`: cells read the ticker's clock instead of calling Date.now() during render.
// No React.

export type Subscriber = { instant?: number; notify: () => void };

const subs = new Set<Subscriber>();
let timer: ReturnType<typeof setInterval> | null = null;
let cadence = 0;
let paused = false;
let now = 0;

export const CADENCES = { fresh: 1_000, aging: 30_000, old: 300_000 } as const;

/** 1s under a minute, 30s under an hour, 5m past it — keyed on the youngest live label. */
export function cadenceForAge(ageMs: number): number {
  if (ageMs < 60_000) return CADENCES.fresh;
  if (ageMs < 3_600_000) return CADENCES.aging;
  return CADENCES.old;
}

function youngestAge(): number {
  let min = Infinity;
  for (const s of subs) if (s.instant !== undefined) min = Math.min(min, Math.abs(now - s.instant));
  return min;
}

function stop(): void {
  if (timer) clearInterval(timer);
  timer = null;
  cadence = 0;
}

function schedule(): void {
  if (paused || subs.size === 0) return stop();
  const want = cadenceForAge(youngestAge());
  if (timer && want === cadence) return; // restart only when the target cadence changes
  stop();
  cadence = want;
  timer = setInterval(tick, cadence);
}

function tick(): void {
  now = Date.now();
  subs.forEach((s) => s.notify());
  schedule();
}

export function subscribe(sub: Subscriber): () => void {
  if (subs.size === 0) now = Date.now();
  subs.add(sub);
  schedule();
  return () => {
    subs.delete(sub);
    schedule();
  };
}

/** The visible pause control's hook: a paused ticker holds every label still and says so. */
export function setPaused(p: boolean): void {
  if (paused === p) return;
  paused = p;
  if (!p) now = Date.now();
  schedule();
  subs.forEach((s) => s.notify());
}

export const tickerNow = (): number => now || Date.now();
export const tickerState = () => ({ subscribers: subs.size, cadenceMs: timer ? cadence : 0, paused });
