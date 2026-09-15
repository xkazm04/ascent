// Source excerpts for the mechanism drawer — verbatim from the scene's own files (sceneParts.tsx,
// StripRegion.tsx, DrawerRegion.tsx, a11yHooks.ts). String constants so the drawer needs no build
// step; when the code moves, these move with it in the same commit. Second half: sources2.ts.

export const SRC_PRIMITIVE = `// sceneParts.tsx — the icon-only primitive: a NATIVE button whose name is a required prop
export function IconButton({ label, glyph, onClick, disabled, id, className = "" }: { label: string; glyph: string; … }) {
  return (
    <button type="button" id={id} aria-label={label} title={label} onClick={onClick} disabled={disabled} className={\`\${BTN} \${className}\`}>
      <span aria-hidden>{glyph}</span>
    </button>
  );
}
/** A native-button switch: role + checked state announced, named for the thing it controls. */
export function Switch({ label, on, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onToggle} className={…}>
      <span aria-hidden className={…} />
      {label}
    </button>
  );
}
// WorklistRegion.tsx — the row is not a click target; actions are siblings, and a delete hands focus on
const survivor = rows[i + 1] ?? rows[i - 1] ?? null;
if (survivor) tableRef.current?.querySelector(\`[data-row-id="\${survivor.id}"] button\`)?.focus();
else emptyRef.current?.focus();`;

export const SRC_KEYBOARD = `// StripRegion.tsx — roving tabindex: one stop outside, arrows within, position keyed by identity
const active = order.some((s) => s.id === selected) ? selected : order[0]!.id;
const move = (to: Segment) => { onSelect(to.id); refs.current.get(to.id)?.focus(); };   // focus + selection together
const onKeyDown = (e) => {
  const i = order.findIndex((s) => s.id === active); const n = order.length; let j = -1;
  if (e.key === "ArrowRight") j = (i + 1) % n;
  else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
  else if (e.key === "Home") j = 0;
  else if (e.key === "End") j = n - 1;
  if (j === -1) return; e.preventDefault(); move(order[j]!);
};
const resort = () => setOrder((o) => [...o].reverse());          // identities survive; positions do not
const removeActive = () => {
  const survivor = order[i + 1] ?? order[i - 1]!;                 // nearest surviving neighbour
  setOrder((o) => o.filter((s) => s.id !== active)); move(survivor);
};
<button tabIndex={s.id === active ? 0 : -1} aria-pressed={s.id === active} … />`;

export const SRC_INERT = `// DrawerRegion.tsx — one condition (open) drives every channel; the probe reads the tab order, not the class
<div id="a11y-drawer" ref={panelRef} role="region" aria-label="Follow-up details"
  data-visually-hidden={!open}
  inert={mechanism === "inert" ? !open : undefined}      // rung 3: focus + tree + activation, at the subtree root
  hidden={mechanism === "hidden" ? !open : undefined}    // rung 2: closes both channels by itself
  style={mechanism === "hidden" ? undefined : hideStyle} // opacity + translate: the visual channel only
/>
// on the way in: focus enters only after the subtree is operable (this commit)
useEffect(() => { if (open) panelRef.current?.querySelector("textarea")?.focus(); }, [open]);
// a11yProbe.ts — what Tab would reach under \`root\`
export function tabStops(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => {
    if (el.getAttribute("tabindex") === "-1") return false;
    if (el.disabled) return false;
    if (el.closest("[inert]") || el.closest("[hidden]")) return false;
    return true;
  });
}`;

export const SRC_LIVE = `// a11yHooks.ts — ONE announcer: two homes, a serial drain, assertive preempts, bounded, reaped
const announce = useCallback((text, politeness = "polite") => {
  seq.current += 1;
  const u = { id: seq.current, text, politeness };
  setQueue((q) => {
    const at = politeness === "assertive" ? q.findIndex((x) => x.politeness === "polite") : -1;
    const next = at === -1 ? [...q, u] : [...q.slice(0, at), u, ...q.slice(at)];   // preempt, do not erase
    if (next.length <= QUEUE_BOUND) return next;
    /* shed the OLDEST polite message */
  });
}, []);
useEffect(() => {
  const head = queue[0]; if (!head) return;
  const id = setTimeout(() => {                                // one utterance per tick
    setQueue((q) => q.slice(1));
    setLive((l) => ({ ...l, [head.politeness]: head }));
    setLog((l) => [...l, head].slice(-8));
  }, spacingMs);
  return () => clearTimeout(id);                                // the drain names its reaper
}, [queue, spacingMs]);
// AnnouncerRegion.tsx — mounted from the first render; a fresh node per utterance (keyed remount)
<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
  {live.polite ? <span key={live.polite.id}>{live.polite.text}</span> : null}
</div>`;
