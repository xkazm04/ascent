"use client";

// THE STAMP — a landing, marked on the modules whose edits it carried (celebratory class: rare, so
// entitled to be seen). For `STAMP_HOLD_MS` after the screen SAW the landing a large rotated stamp
// sits over the module; then it rests as a small badge in the module's label band for as long as the
// screen stays open. The entrance plays once, only inside `STAMP_ENTER_MS` of the sighting (a remount
// later shows the stamp still, never replays it). Reduced motion: the stamp simply is there.

import { motion } from "framer-motion";
import type { HeatStamp } from "./heatTypes";
import { STAMP_ENTER_MS, STAMP_HOLD_MS } from "./heatStyle";

const stampWords = (s: HeatStamp) => (s.kinds.includes("verified") ? (s.kinds.includes("landed") ? "Landed and verified" : "Verified") : "Landed");

/** True while the big stamp shows: a celebrated landing inside its hold. */
export function stampHeld(s: HeatStamp, now: number): boolean {
  return s.celebrate && now - s.at >= 0 && now - s.at < STAMP_HOLD_MS;
}

export function StampMark({ stamp, now, reducedMotion, big }: { stamp: HeatStamp; now: number; reducedMotion: boolean; big: boolean }) {
  const entering = !reducedMotion && now - stamp.at < STAMP_ENTER_MS;
  const landed = stamp.kinds.includes("landed");
  const verified = stamp.kinds.includes("verified");
  const body = (
    <span
      className={`flex flex-col items-center whitespace-nowrap rounded-lg border-[3px] border-double border-success-soft bg-ink/85 font-mono font-bold uppercase text-success-soft shadow-[0_0_40px_-6px] shadow-success/60 ${big ? "px-5 py-2" : "px-3 py-1"}`}
    >
      <span className={`tracking-[0.18em] ${big ? "type-display min-[2400px]:text-6xl" : "type-title"}`}>
        <span aria-hidden>✓ </span>
        {landed ? "Landed" : "Verified"}
      </span>
      {landed && verified ? <span className={`tracking-[0.3em] ${big ? "type-mono-sm min-[2400px]:text-2xl" : "type-micro"}`}>and verified</span> : null}
    </span>
  );
  return (
    <div data-stamp="held" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden>
      {entering ? (
        <>
          <motion.span
            className="absolute h-24 w-24 rounded-full border-2 border-success-soft"
            initial={{ opacity: 0.7, scale: 0.4 }}
            animate={{ opacity: 0, scale: 2.6 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
          <motion.span
            initial={{ opacity: 0, scale: 1.8, rotate: -18 }}
            animate={{ opacity: 1, scale: 1, rotate: -7 }}
            transition={{ duration: 0.42, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {body}
          </motion.span>
        </>
      ) : (
        <span style={{ transform: "rotate(-7deg)" }}>{body}</span>
      )}
    </div>
  );
}

/** The resting mark: a check and, past one landing, how many sessions landed work here. On a narrow
 *  tile it drops its word (`compact`) — the folder's name is the map's structure and outranks the
 *  badge's adjective, which the title and the summary still carry. */
export function StampBadge({ stamp, compact = false }: { stamp: HeatStamp; compact?: boolean }) {
  const count = stamp.count > 1 ? `×${stamp.count}` : "";
  return (
    <span
      data-stamp="badge"
      data-compact={compact || undefined}
      title={`${stampWords(stamp)} — work this screen watched land here`}
      className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-success/50 bg-success/10 px-1.5 font-mono type-caption font-semibold text-success-soft"
    >
      <span aria-hidden>✓</span>
      {compact ? count : count || (stamp.kinds.includes("landed") ? "landed" : "verified")}
    </span>
  );
}
