// Source excerpts for the mechanism drawer — verbatim from the scene's own files (presets.ts,
// motionHooks.ts and the panels). Kept as string constants so the drawer needs no build step;
// when the code moves, these move with it in the same commit.

export const SRC_GESTURE = `// GesturePanel.tsx — three tracks, three curves, one event-driven gesture
const TRACKS = [
  { property: "border-color",                 duration: "fast",       easing: "move"  },
  { property: "transform: scale",             duration: "base",       easing: "enter" },
  { property: "opacity + translateY (detail)",duration: "deliberate", easing: "enter" },
];
const t = (row, reduced) => reduced ? "none" : \`\${DURATION_MS[row.duration]}ms \${EASING[row.easing]}\`;
style={{
  transform: selected && !reduced ? "scale(1.03)" : "scale(1)",
  transition: [\`border-color \${t(border, reduced)}\`, \`transform \${t(lift, reduced)}\`].join(", "),
}}`;

export const SRC_PRESET = `// presets.ts — intent + fallback once per gesture; duration class + easing role per track
export const DURATION_MS = { fast: 120, base: 240, deliberate: 480 } as const;
export const PRESETS = {
  entrance: {
    intent: "This element is being drawn into existence.",
    cls: "entrance", keyframes: "surface-rise",
    tracks: [{ kind: "timed", property: "opacity", duration: "base", easing: "enter" }, …],
    reduced: "fade",
  },
  "spring-retarget": {
    tracks: [{ kind: "physics", property: "transform: translateX", stiffness: 220, damping: 22, settleBoundMs: 800 }],
    reduced: "settle",
  },
} as const satisfies Record<string, Preset>;`;

export const SRC_ENGINE = `// EnginePanel.tsx — the same gesture on three engines
// 1. CSS keyframes: platform-owned, MotionConfig cannot see it, the preset carries its own fallback
<span style={{ animation: animationFor("entrance", reduced) }} />
// 2. framer spring: library-owned; retargets mid-flight from position + velocity
<motion.span animate={{ x: target }} transition={{ type: "spring", stiffness, damping }} />
// 3. input-driven scrub: the range input is the clock — no duration, no one-shot, reversal is correct
const onScrub = (v) => {
  el.style.transform = reduced ? "none" : \`translateX(\${(v / 100) * TRAVEL_PX}px)\`;
  el.style.opacity = reduced ? String(0.4 + (v / 100) * 0.6) : "1";   // reduced = bounded to opacity
};`;

export const SRC_PERF = `// PerfPanel.tsx — one rAF clock, writes through refs, renders only at start and settle
const tick = (now) => {
  const dt = Math.min(now - last, MAX_DT_MS);   // clamp: a frozen clock resumes in one bounded step
  last = now; t += dt; n += 1;
  const q = Math.min(1, t / SWEEP_MS);
  if (a.current) a.current.style.transform = \`scaleX(\${ease(q)})\`;            // frame writes via refs
  if (b.current) b.current.style.transform = \`translateX(\${ease(q) * 100}%)\`;
  if (frames.current) frames.current.textContent = String(n);                 // never setState per frame
  if (q < 1) raf = requestAnimationFrame(tick);
  else setState("settled");                     // the reactive layer hears about it ONCE more: at rest
};
// the render counter is a DOM write after commit, so counting renders cannot itself cause one
useEffect(() => { const el = renders.current; if (el) el.textContent = String(Number(el.textContent || "0") + 1); });`;

export const SRC_BUDGET = `// presets.ts — the budgets are constants beside the presets, not memory at call sites
export const BUDGET = { entranceCapMs: 1000, staggerStepMs: 40, staggerCountCap: 8, ambientTravelPx: 3, … };
export function entranceTotalMs(perItemMs, count) {
  return perItemMs + BUDGET.staggerStepMs * Math.min(Math.max(count - 1, 0), BUDGET.staggerCountCap - 1);
}
// PresetPanel.tsx — the meter goes red past the cap
const total = entranceTotalMs(perItem, count);
const over = total > BUDGET.entranceCapMs;
<div className={over ? "bg-danger" : "bg-accent"} style={{ width: \`\${pct}%\` }} />`;

export const SRC_ONESHOT = `// motionHooks.ts — a surface-scoped seen-set keyed by identity, consulted during render
export function useSeenSet(scope) {
  const [seen, setSeen] = useState(() => new Set());
  const [prevScope, setPrevScope] = useState(scope);
  if (prevScope !== scope) { setPrevScope(scope); setSeen(new Set()); }   // the ONE reset policy
  const enters = (id) => !seen.has(id);
  const mark = (id) => setSeen((s) => (s.has(id) ? s : new Set(s).add(id)));
  return { enters, mark, size: seen.size };
}
// OneShotPanel.tsx — a poll re-delivers known ids: no replay; a new id enters alone;
// the entrance itself writes the set: ONE delegated animationend listener (the 1ms reduced epsilon fires it too)
useEffect(() => {
  const onEnd = (e) => { const id = e.target.closest("[data-id]")?.dataset.id; if (id) mark(id); };
  list.addEventListener("animationend", onEnd);
  return () => list.removeEventListener("animationend", onEnd);
}, [mark]);
<li data-id={r.id} style={{ animation: enters[i] ? animationFor("entrance", reduced, { delayMs }) : "none" }} />`;

export const SRC_REDUCED = `// presets.ts — reduction resolves at the preset layer; collapsed durations are epsilon, never zero
export function animationFor(name, reduced, opts = {}) {
  const p = PRESETS[name];
  if (!reduced || p.timingLoadBearing) return \`\${p.keyframes} \${presetMs(name)}ms \${ease} both\`;
  if (p.reduced === "fade") return \`surface-fade \${DURATION_MS.fast}ms \${EASING.enter} both\`;
  return \`\${p.keyframes} 1ms linear both\`;   // settle / still: end state on the first frame, animationend still fires
}
// ReducedPanel.tsx — the exit unmounts on the event in both modes
<span style={{ animation: \`surface-fade \${reduced ? 1 : DURATION_MS.base}ms linear reverse both\` }}
      onAnimationEnd={() => { setExiting(false); setExits((e) => e + 1); }} />`;

export const SRC_CONTENT = `// ReducedPanel.tsx — the payload resolves instantly; the label follows the loop, not the preference
const [figure, setFigure] = useState(reduced ? HEADLINE_FIGURE : 0);   // the end state IS the initial state
const [chars, setChars]   = useState(reduced ? HEADLINE_TEXT.length : 0);
if (prevReduced !== reduced) { setPrevReduced(reduced);
  if (reduced) { setFigure(HEADLINE_FIGURE); setChars(HEADLINE_TEXT.length); setLoopRan(false); } }
useEffect(() => {
  if (reduced) return;                    // the loop never starts; never zero, never blank
  /* rAF count-up: setLoopRan(true) on the first tick, then the figure and the typed headline … */
}, [run, reduced]);
const replay = () => reduced ? (setFigure(HEADLINE_FIGURE), setChars(HEADLINE_TEXT.length)) : setRun((r) => r + 1);
const liveness = !loopRan ? "static value" : done ? "counted" : "counting…";`;

export const SRC_LIFECYCLE = `// LoopPanel.tsx — visible stop, one-directional; taking control is a stop; cadence from elapsed time
const pick = (i) => { setPicked(i); pause.stop(); };            // first deliberate act stops autoplay
const resume = () => { setPicked(null); auto.restart(); pause.resume(); }; // labelled, separate, restarts the interval
<button onClick={pause.stop}   disabled={pause.userStop}>■ stop</button>
<button onClick={resume}       disabled={!pause.userStop}>▶ resume</button>
// motionHooks.ts — useElapsedStep: \`now\` is state advanced by an interval; nothing reads a clock in render
if (prevPaused !== paused) { setPrevPaused(paused);
  if (paused) setPausedAt(now); else if (pausedAt !== null) { setBanked((b) => b + (now - pausedAt)); setPausedAt(null); } }
const elapsed = Math.max(0, (pausedAt ?? now) - start - banked);
const step = Math.floor(elapsed / intervalMs) % count;`;

export const SRC_GOVERNANCE = `// motionHooks.ts — one merged answer over a closed decider set; each decider is a veto
const vetoes = [];
if (reduced)      vetoes.push("reduced");
if (!inView)      vetoes.push("in-view");        // abstains where IntersectionObserver is absent
if (!foregrounded)vetoes.push("foregrounded");
if (userStop)     vetoes.push("user-stop");      // one-directional: only resume() clears it
if (hoverPaused)  vetoes.push("hover (timed)");  // hoverUntil > now; armHover() sets Date.now() + hoverPauseMs
return { paused: vetoes.length > 0, vetoes, stop, resume, armHover, … };   // an interval ticks \`now\` only while armed`;
