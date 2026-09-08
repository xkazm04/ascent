"use client";

// a11y-verification: the gate runs over the scene's OWN DOM and sees the target, not a proxy — it
// computes names, walks the tab order, and counts live regions that were mounted before any news.
// Every number carries its predicate; a run that examined zero controls is a FAILED RUN, spelled
// differently from a pass. The two layers no automation replaces (contrast floor here, the human
// pass with a real reader) are listed as untested, never as green.

import { useState, type RefObject } from "react";
import { runGates, type GateReport } from "./a11yProbe";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";

type Target = "scene" | "nothing";

export function GatesRegion({ rootRef }: { rootRef: RefObject<HTMLElement | null> }) {
  const [target, setTarget] = useState<Target>("scene");
  const [report, setReport] = useState<GateReport | null>(null);

  const run = () => {
    const root = rootRef.current;
    if (!root) return;
    // "nothing": the audit pointed at a selector that matches no surface — the classic empty pass.
    const scope: ParentNode = target === "scene" ? root : root.ownerDocument.createDocumentFragment();
    setReport(runGates(scope));
  };
  const failedRun = report !== null && report.controlsExamined === 0;
  const verdict = report === null ? "not run" : failedRun ? "failed run" : report.nameless.length === 0 && report.stopsInHiddenSubtrees === 0 ? "floor cleared" : "findings";

  return (
    <Region technique="a11y-verification" title="The gate sees the target" note="Layers 1-3 run here against this scene's DOM. A green audit is a floor cleared, quoted with its denominator.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={run}>
          run gates
        </button>
        <div role="group" aria-label="Audit target" className="flex gap-1">
          {(["scene", "nothing"] as const).map((t) => (
            <button key={t} type="button" aria-pressed={target === t} className={target === t ? BTN_ON : BTN} onClick={() => setTarget(t)}>
              {t === "scene" ? "this scene" : "an empty selector"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 space-y-1" data-gate-verdict={verdict}>
        <Readout label="verdict" value={verdict} tone={failedRun ? "text-danger" : verdict === "findings" ? "text-warn" : "text-slate-200"} />
        <Readout label="L1 names" value={report ? `${report.nameless.length} nameless of ${report.controlsExamined} controls` : "—"} tone={report?.nameless.length ? "text-warn" : "text-slate-200"} />
        <Readout label="L2 announcer" value={report ? `${report.liveRegions} live regions, mounted before the news` : "—"} />
        <Readout label="L3 tab walk" value={report ? `${report.stops} stops · ${report.stopsInHiddenSubtrees} inside hidden subtrees` : "—"} tone={report?.stopsInHiddenSubtrees ? "text-danger" : "text-slate-200"} />
        <Readout label="L4 contrast" value="untested — no gate at the token site" tone="text-warn" />
        <Readout label="L5 human pass" value="not run — untested is not passing" tone="text-warn" />
      </div>
      {report ? (
        <p className="mt-2 type-caption text-slate-500" data-gate-examined={report.controlsExamined}>
          {failedRun
            ? "0 controls examined: the instrument saw nothing. This is a failed run, not a clean one."
            : `Predicate: button, a[href], input, select, textarea inside this scene, names computed in precedence order; stops = elements Tab would reach, excluding inert, hidden, disabled and tabindex -1.${report.nameless.length ? ` Nameless: ${report.nameless.join(", ")}.` : ""}`}
        </p>
      ) : null}
    </Region>
  );
}
