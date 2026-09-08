"use client";

// keyboard-navigation-models: the segment strip is ONE tab stop from outside; arrows move within it,
// Home/End jump to its edges, Tab leaves to the next widget. Roving tabindex: exactly one member is
// tab-reachable, and arrow movement moves real focus AND selection together. The roving position is
// keyed by member IDENTITY: resort the strip and the active member stays the same member; remove it
// and focus falls to its nearest surviving neighbour, never to whatever now occupies its slot.

import { useRef, useState } from "react";
import { SEGMENTS, type Segment } from "./fixtures";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

export function StripRegion({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const [order, setOrder] = useState<Segment[]>(() => [...SEGMENTS]);
  const [removed, setRemoved] = useState(0);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const active = order.some((s) => s.id === selected) ? selected : order[0]!.id;

  // Arrow movement: focus and selection move together, by identity. Event handler, so focusing the
  // (already mounted) target through its ref is legitimate here.
  const move = (to: Segment) => {
    onSelect(to.id);
    refs.current.get(to.id)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = order.findIndex((s) => s.id === active);
    const n = order.length;
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    if (j === -1) return;
    e.preventDefault();
    move(order[j]!);
  };

  const resort = () => setOrder((o) => [...o].reverse()); // identities survive; positions do not
  const removeActive = () => {
    if (order.length <= 1) return;
    const i = order.findIndex((s) => s.id === active);
    const survivor = order[i + 1] ?? order[i - 1]!; // nearest surviving neighbour
    setOrder((o) => o.filter((s) => s.id !== active));
    setRemoved((r) => r + 1);
    move(survivor);
  };

  return (
    <Region technique="keyboard-navigation-models" title="Tab between, arrows within" note="One stop from outside. Left/Right roam, Home/End jump, Tab exits. Position is keyed by identity, so a resort cannot teleport focus.">
      <div role="toolbar" aria-label="Segment" aria-orientation="horizontal" className="flex flex-wrap gap-1" onKeyDown={onKeyDown} data-roving-active={active}>
        {order.map((s) => (
          <button
            key={s.id}
            type="button"
            ref={(el) => {
              if (el) refs.current.set(s.id, el);
              else refs.current.delete(s.id);
            }}
            tabIndex={s.id === active ? 0 : -1}
            aria-pressed={s.id === active}
            className={s.id === active ? BTN_ON : BTN}
            onClick={() => onSelect(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={resort}>
          resort
        </button>
        <button type="button" className={BTN} onClick={removeActive} disabled={order.length <= 1}>
          remove active member
        </button>
        <span className="type-caption text-slate-500">
          {removed} removed · {order.length} members
        </span>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="tab stops in strip" value={<span data-strip-stops={1}>1 of {order.length}</span>} />
        <Readout label="active (by identity)" value={active} />
      </div>
    </Region>
  );
}
