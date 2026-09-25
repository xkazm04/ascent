"use client";

// THE CAMERA — a lane's accumulated file map, the lit tile (the tail's newest file) and the trail from
// the file before it. Two measured behaviours, both imperative on purpose (they read layout):
//   • FIT: density steps down (d1…d4, cumulative) only while the map overflows its camera, so a big
//     session simplifies instead of shrinking type below 12 px; re-fit on resize.
//   • TRAIL: a dashed line between the previous file and the lit one, placed from their boxes.
// Both write to DOM nodes React renders with constant props, so a re-render never undoes them.

import { useLayoutEffect, useRef } from "react";
import type { LaneMonitorView } from "./onairLaneModel";
import { cx } from "./onairFormat";
import styles from "./onairCamera.module.css";
import mon from "./onairMonitor.module.css";

const DENSITY = [styles.d1, styles.d2, styles.d3, styles.d4].filter(Boolean) as string[];
const LIT_CLASS = { read: styles.litRead, edit: styles.litEdit, write: styles.litWrite };

function centre(el: Element, box: DOMRect) {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2 - box.left).toFixed(1), y: (r.top + r.height / 2 - box.top).toFixed(1) };
}

export function OnAirCamera({ view, reducedMotion, className }: { view: LaneMonitorView; reducedMotion: boolean; className?: string }) {
  const camRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGSVGElement>(null);
  const litPath = view.lit?.path ?? null;
  const from = view.active ? view.from : null;
  const drawFresh = Boolean(view.lit?.live) && !reducedMotion;

  useLayoutEffect(() => {
    const cam = camRef.current;
    const map = mapRef.current;
    const trail = trailRef.current;
    if (!cam || !map || !trail) return;
    const tile = (path: string | null) => (path == null ? null : ([...map.querySelectorAll("[data-p]")].find((t) => t.getAttribute("data-p") === path) ?? null));
    const place = () => {
      const a = tile(from);
      const b = tile(litPath);
      if (!a || !b || a === b) {
        trail.style.display = "none";
        return;
      }
      const box = cam.getBoundingClientRect();
      const p1 = centre(a, box);
      const p2 = centre(b, box);
      trail.style.display = "";
      const line = trail.querySelector("line")!;
      const dot = trail.querySelector("circle")!;
      line.setAttribute("x1", p1.x);
      line.setAttribute("y1", p1.y);
      line.setAttribute("x2", p2.x);
      line.setAttribute("y2", p2.y);
      dot.setAttribute("cx", p1.x);
      dot.setAttribute("cy", p1.y);
    };
    const fit = () => {
      for (const d of DENSITY) cam.classList.remove(d);
      if (map.querySelector("[data-p]")) {
        for (let i = 0; i < DENSITY.length && map.scrollHeight > map.clientHeight + 2; i++) cam.classList.add(DENSITY[i]!);
      }
      place();
    };
    fit();
    if (drawFresh && styles.draw) {
      trail.classList.remove(styles.draw);
      void trail.getBoundingClientRect();
      trail.classList.add(styles.draw);
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(cam);
    return () => ro.disconnect();
  }, [view.files, litPath, from, drawFresh]);

  const tone = view.active && view.lit ? LIT_CLASS[view.lit.tone] : styles.litLast;
  const stageWord = !view.active && view.files ? view.short : null;
  return (
    <div ref={camRef} className={cx(styles.cam, className)}>
      <div ref={mapRef} className={styles.map}>
        {view.groups.map((g) => (
          <div key={g.dir} className={styles.dir} style={{ flexGrow: g.files.length }}>
            <span className={styles.dn}>{`${g.dir || "."}/`}</span>
            {g.files.map((f) => {
              const lit = f.path === litPath;
              return (
                <span
                  key={f.path}
                  data-p={f.path}
                  data-role={lit ? "onair-tile-lit" : "onair-tile"}
                  title={f.path}
                  className={cx(styles.f, f.edited ? styles.e : styles.r, lit && styles.lit, lit && tone, !lit && f.path === from && styles.from, lit && f.live && !reducedMotion && styles.flash)}
                >
                  <i>{f.base}</i>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <svg ref={trailRef} className={styles.trail} aria-hidden="true" style={{ display: "none" }}>
        <line x1="0" y1="0" x2="0" y2="0" />
        <circle r="3" cx="0" cy="0" />
      </svg>
      {view.note ? (
        <div className={styles.camnote}>
          <b>{view.note.word}</b>
          <span>
            {view.stage === "plan" && view.note.planner ? (
              <>
                <span className={styles.mono}>{view.note.planner}</span> writes the read-only plan · then <span className={styles.mono}>{view.note.exec}</span> reads and edits
                <br />
                no file touched yet this cycle
              </>
            ) : view.stage === "plan" ? (
              <>
                Writing the read-only plan
                <br />
                no file touched yet this cycle
              </>
            ) : (
              "No file touched yet this cycle"
            )}
          </span>
        </div>
      ) : null}
      <div className={styles.camchip}>
        <b>{view.files}</b> {view.files === 1 ? "FILE" : "FILES"} · <b>{view.edited}</b> EDITED
        {view.files && !view.complete ? " · SINCE SCREEN OPENED" : ""}
        {stageWord ? <span className={cx(styles.st, mon[`s-${view.stage}`])}>{stageWord}</span> : null}
      </div>
    </div>
  );
}
