// Source excerpts for the mechanism drawer, second half — verbatim from FormRegion.tsx, a11yProbe.ts,
// signal.ts / Scene.tsx, GatesRegion.tsx and PairingsRegion.tsx. First half: sources.ts.

export const SRC_NAME = `// a11yProbe.ts — the name is computed over a precedence chain, and the scene reports WHICH source won
export function computeName(el) {
  const labelledBy = byIds("aria-labelledby"); if (labelledBy) return { name: labelledBy, source: "aria-labelledby" };
  const ariaLabel = el.getAttribute("aria-label")?.trim(); if (ariaLabel) return { name: ariaLabel, source: "aria-label" };
  if (el is input | textarea | select) { const labels = […el.labels]; if (labels.length) return { name, source: "label" }; }
  else { const content = el.textContent.trim(); if (content) return { name: content, source: "content" }; }
  const placeholder = el.getAttribute("placeholder"); if (placeholder) return { name: placeholder, source: "placeholder" };
  return { name: "", source: "none" };
}
// FormRegion.tsx — the error is attached to the field AND voiced, the hint precedes it in the chain
const describedBy = ["a11y-title-hint", error ? "a11y-title-error" : null].filter(Boolean).join(" ");
<input id="a11y-title" aria-describedby={describedBy} aria-invalid={error ? true : undefined} … />
if (!title.trim()) { setError(msg); announce(msg, "assertive"); return; }   // blocks the current act
// label-in-name: the visible label is the authority; the accessible name BEGINS with it
<button id="a11y-save" type="submit" aria-label={\`Save, follow-up \${rowId}\`}>Save</button>`;

export const SRC_PREFS = `// signal.ts — ONE signal, read at one boundary, derived everywhere
export type PrefSignal = { reduced: boolean; scale: TextScale; forced: boolean };
export const PRESERVES = {
  reduced: "feedback replaced, never removed: the drawer settles instantly, …",
  scale:   "content reflows: the table wraps and grows; nothing truncates or overlaps",
  forced:  "meaning survives the palette: status keeps a glyph and a word beside its color",
};
// Scene.tsx — the frame resolves \`reduced\` (OS query OR simulate toggle); the scene never re-detects
const signal: PrefSignal = { reduced, scale, forced };
<div style={{ zoom: scale / 100, filter: forced ? "grayscale(1) contrast(1.15)" : undefined }}>
// DrawerRegion.tsx — derived, not re-detected
transition: reduced ? "none" : "opacity 200ms ease-out, transform 200ms ease-out"
// WorklistRegion.tsx — the structural carrier a forced palette keeps
<td className={STATUS_TONE[r.status]}><span aria-hidden>{STATUS_GLYPH[r.status]} </span>{r.status}</td>`;

export const SRC_VERIFY = `// a11yProbe.ts — the gate runs over the scene's own DOM and sees the target
export function runGates(root) {
  const controls = Array.from(root.querySelectorAll("button, a[href], input, select, textarea"));
  const nameless = controls.filter((el) => computeName(el).name === "" && !el.closest("[aria-hidden='true']"));
  const stops = tabStops(root);
  const leaks = […root.querySelectorAll(FOCUSABLE)].filter((el) => el.closest("[data-visually-hidden='true']") && !el.closest("[inert]") && !el.closest("[hidden]"));
  return { controlsExamined: controls.length, nameless, stops: stops.length, stopsInHiddenSubtrees: leaks.length, liveRegions: root.querySelectorAll("[aria-live]").length };
}
// GatesRegion.tsx — zero examined is a FAILED RUN, spelled differently from a pass
const scope = target === "scene" ? root : root.ownerDocument.createDocumentFragment();
const failedRun = report !== null && report.controlsExamined === 0;
const verdict = report === null ? "not run" : failedRun ? "failed run" : … ? "floor cleared" : "findings";
<Readout label="L4 contrast"   value="untested — no gate at the token site" />
<Readout label="L5 human pass" value="not run — untested is not passing" />`;

export const SRC_DIVERGENCE = `// fixtures.ts — "supported" is a written list of pairs, each result dated; the rest is untested
export const PAIRINGS = [
  { reader: "NVDA",      browser: "Firefox", measured: "2026-08-30", prePopulated: "silent", repeat: "silent" },
  { reader: "VoiceOver", browser: "Safari",  measured: "2026-08-30", prePopulated: "voices", repeat: "silent" },
  { reader: "JAWS",      browser: "Chrome",  measured: "2026-07-14", prePopulated: "silent", repeat: "voices" },
];
export const UNHELD = [{ reader: "Narrator", browser: "Edge" }, { reader: "TalkBack", browser: "Chrome (Android)" }];
// PairingsRegion.tsx — the matrix moves: a result older than the clock is flagged, not trusted
const age = daysBetween(p.measured, TODAY);
<td className={age > STALE_DAYS ? "text-danger" : "text-slate-500"}>{p.measured}{age > STALE_DAYS ? " · stale" : ""}</td>
<td colSpan={3}>untested — not held, not passing</td>
// a workaround names its pairing; deleting it without re-measuring is refused
<p>serves: VoiceOver · Safari and NVDA · Firefox — observed without it: an identical repeat was silent — last checked 2026-08-30</p>
{proposed ? <div data-deletion="refused">Refused until re-measured on the pairings it serves. …</div> : null}`;
