// Kit batch 6 specimen, part 1 (2026-10-22): the Live desk and the On Air wall. Both are separate compositions
// with their own palette module (desk.module.css, onairWall.module.css); under Prism those modules re-point
// their scope variables to the Prism palette. This specimen renders their real classes at small scale with
// synthetic lanes, so a palette regression shows here before it shows on a live wall. Server-safe.
import { Pips } from "@/features/inflight/live/desk/Pips";
import type { RoundLane } from "@/features/inflight/live/desk/deskTypes";
import desk from "@/features/inflight/live/desk/desk.module.css";
import wall from "@/features/inflight/live/theater/onair/onairWall.module.css";
import strip from "@/features/inflight/live/theater/onair/onairStrip.module.css";

const lane = (id: string, verdict: RoundLane["verdict"], errored = false): RoundLane =>
  ({ id, runId: "run", repo: "acme/sample", cycle: 1, phase: "done", verdict, closes: 0, commits: 0, costMicros: null, errored }) as unknown as RoundLane;

const LANES = [lane("1", "verified"), lane("2", "rejected"), lane("3", "baseline-unavailable"), lane("4", "skipped"), lane("5", null), lane("6", "verified", true)];

const SLOT = "grid gap-4 border-t border-divider py-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]";

export function KitLive() {
  return (
    <>
      <div data-specimen="b6-live-desk" className={SLOT}>
        <div className="space-y-2">
          <p className="font-mono type-mono-sm text-slate-300">Live desk</p>
          <p className="type-note text-slate-400">
            The answers strip and a round&apos;s lane pips. Verdict colours keep their meaning (verified, rejected, baseline unavailable, skipped, unknown ring,
            errored cross); the chrome is the Prism palette.
          </p>
        </div>
        <div className={desk.desk} style={{ padding: 16 }}>
          <div className={desk.answers} style={{ marginBottom: 12 }}>
            <div>
              <span className={desk.cap}>Running</span>
              <div className={desk.v}>
                Yes <small>kp · Editing</small>
              </div>
            </div>
            <div>
              <span className={desk.cap}>Today</span>
              <div className={desk.v}>3 verified</div>
            </div>
            <div>
              <span className={desk.cap}>Cost</span>
              <div className={`${desk.v} ${desk.muted}`}>not reported</div>
            </div>
            <div>
              <span className={desk.cap}>Needs you</span>
              <div className={`${desk.v} ${desk.warn}`}>1 plan</div>
            </div>
          </div>
          <Pips lanes={LANES} />
        </div>
      </div>
      <div data-specimen="b6-onair-wall" className={SLOT}>
        <div className="space-y-2">
          <p className="font-mono type-mono-sm text-slate-300">On Air wall</p>
          <p className="type-note text-slate-400">
            The station bug and two answer cells on the wall&apos;s own scale unit. The wall is full-screen on a TV; here it is held in a box.
          </p>
        </div>
        <div className={wall.wall} style={{ position: "relative", inset: "auto", height: 150, padding: 8 }}>
          <div className={strip.strip} style={{ flexBasis: "auto", gridTemplateColumns: "1.2fr 1fr 1fr", minHeight: 110 }}>
            <div className={strip.cell}>
              <div className={strip.brand}>
                <span>ASCENT</span>
                <span className={strip.sep}>·</span>
                <span className={strip.lv}>LIVE</span>
              </div>
              <div className={strip.clock}>14:02</div>
              <div className={strip.bugrow}>
                <span className={strip.onair} data-state="on">
                  <i className={strip.lamp} />
                  ON AIR
                </span>
              </div>
            </div>
            <div className={strip.cell}>
              <div className={strip.k}>Now</div>
              <div className={strip.h}>kp · Editing</div>
              <div className={strip.s}>src/lib/scan.ts</div>
            </div>
            <div className={strip.cell} data-tone="warn">
              <div className={strip.k}>Needs you</div>
              <div className={strip.h}>1 plan waits</div>
              <div className={strip.s}>approve or dismiss</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
