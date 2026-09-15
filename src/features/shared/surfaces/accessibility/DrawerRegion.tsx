"use client";

// hidden-but-mounted-inertness: the detail drawer stays mounted (its draft must survive), so it is
// hidden — and hiding is TWO channels. Pick the mechanism and watch the probe: `opacity` closes the
// visual channel only (tab stops remain: the invisible detour); `hidden` closes both by itself
// (rung 2); `inert` at the subtree ROOT closes focus, activation and the tree from the SAME condition
// that drives the fade (rung 3). The attribute flips with the state, not at the end of the
// transition; on the way in, focus moves into the panel only after it is operable.

import { useEffect, useRef, useState } from "react";
import { tabStops } from "./a11yProbe";
import type { Row } from "./fixtures";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

type Mechanism = "inert" | "hidden" | "opacity";
const MECHANISMS: readonly { id: Mechanism; closes: string }[] = [
  { id: "inert", closes: "visual + focus + tree (one condition, one node)" },
  { id: "hidden", closes: "both, by itself — no second act" },
  { id: "opacity", closes: "visual only — the leak" },
];

export function DrawerRegion({ reduced, row }: { reduced: boolean; row: Row | null }) {
  const [open, setOpen] = useState(false);
  const [mechanism, setMechanism] = useState<Mechanism>("inert");
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);

  // On the way in: the subtree became operable in THIS commit, so focus may now enter it.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [open]);
  // The probe sees the target, not the class: it walks the tab-order candidates inside the panel
  // after every commit and writes the count into the DOM (a post-commit write, never state).
  useEffect(() => {
    const panel = panelRef.current;
    const out = probeRef.current;
    if (!panel || !out) return;
    const n = tabStops(panel).length;
    out.textContent = String(n);
    out.setAttribute("data-stops", String(n));
  });

  const visualOnly = mechanism === "opacity";
  const hideStyle = { opacity: open ? 1 : 0, transform: open ? "translateX(0)" : "translateX(12px)", transition: reduced ? "none" : "opacity 200ms ease-out, transform 200ms ease-out" };

  return (
    <Region technique="hidden-but-mounted-inertness" title="Hiding is two channels" note="The drawer keeps its draft, so it stays mounted. Whatever hides it must close the tree and the tab order too.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} aria-expanded={open} aria-controls="a11y-drawer" onClick={() => setOpen((o) => !o)}>
          {open ? "close details" : "open details"}
        </button>
        <div role="group" aria-label="Hide mechanism" className="flex gap-1">
          {MECHANISMS.map((m) => (
            <button key={m.id} type="button" aria-pressed={mechanism === m.id} className={mechanism === m.id ? BTN_ON : BTN} onClick={() => setMechanism(m.id)}>
              {m.id}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 type-caption text-slate-500">closes: {MECHANISMS.find((m) => m.id === mechanism)?.closes}</p>

      <div
        id="a11y-drawer"
        ref={panelRef}
        role="region"
        aria-label="Follow-up details"
        data-visually-hidden={!open}
        // One condition (`open`) drives every channel: the fade, the inert boundary, the hidden hide.
        inert={mechanism === "inert" ? !open : undefined}
        hidden={mechanism === "hidden" ? !open : undefined}
        style={mechanism === "hidden" ? undefined : hideStyle}
        className="mt-3 rounded-lg border border-divider bg-surface/40 p-3"
      >
        <p className="type-caption text-slate-200">{row ? `${row.title} · ${row.repo}` : "no follow-up selected"}</p>
        <label className="mt-2 block">
          <span className="type-caption text-slate-400">draft note</span>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="focus-ring mt-1 w-full rounded-md border border-divider bg-surface px-2 py-1 type-body-sm text-slate-200" />
        </label>
        <button type="button" className={`${BTN} mt-2`}>
          attach to digest
        </button>
      </div>

      <div className="mt-3 space-y-1">
        <Readout label={open ? "tab stops inside (open)" : "tab stops inside (hidden)"} value={<span ref={probeRef} data-stops="0">0</span>} tone={!open && visualOnly ? "text-danger" : "text-slate-200"} />
        <Readout label="draft survives" value={`${draft.length} chars`} />
      </div>
      <p className="mt-2 type-caption text-slate-500" data-drawer-verdict={!open && visualOnly ? "leak" : "closed"}>
        {!open && visualOnly ? "Invisible detour: the eye sees nothing, Tab still lands here, the reader describes a panel that is not on screen." : open ? "Open: operable, and focus entered only after it became so." : "Hidden: zero stops inside, no node in the tree — from the same condition as the fade."}
      </p>
    </Region>
  );
}
