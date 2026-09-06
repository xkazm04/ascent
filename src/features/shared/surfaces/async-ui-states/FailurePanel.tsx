"use client";

// failure-states: an alerts region whose next request can be made to fail. With nothing held, failure
// is a first-class state — distinct from empty, at the user's altitude, with a retry that reissues the
// same request through a BusyButton (or, when the class is unauthorized, no retry at all). With rows
// held, a failed refresh degrades: the rows stay, the failure is admitted beside them with how stale
// they now are. Every failure that renders is also counted as reported.

import { useEffect, useState } from "react";
import { ESCALATE_AFTER, FAILURE_COPY, LATENCY, type FailureClass, type Latency } from "./asyncState";
import { useRequestRegion } from "./asyncHooks";
import { BusyButton } from "./BusyButton";
import { alertRows, type Alert } from "./fixtures";
import { BTN, BTN_ON, GhostRows, ROW, Readout, Region, StateChip } from "./sceneParts";

export function FailureRegion({ reduced, latency }: { reduced: boolean; latency: Latency }) {
  const [failNext, setFailNext] = useState(false);
  const [cls, setCls] = useState<FailureClass>("unreachable");
  const region = useRequestRegion<Alert>();
  const { issue } = region;
  useEffect(() => {
    void issue({ rows: alertRows(), latencyMs: LATENCY.warm }, { tag: "arrival" });
  }, [issue]);

  const load = () => issue({ rows: alertRows(), latencyMs: LATENCY[latency], fail: failNext ? cls : undefined }, { tag: "load" });
  const state = region.state(false);
  const held = region.content.length > 0;
  const copy = region.error ? FAILURE_COPY[region.error] : null;
  const escalated = region.error === "unreachable" && region.failures >= ESCALATE_AFTER;

  return (
    <Region technique="failure-states" title="Spelled differently from empty" note="Zero-because-nothing-exists and zero-because-the-request-died are different facts with different next actions.">
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <button type="button" className={failNext ? BTN_ON : BTN} aria-pressed={failNext} onClick={() => setFailNext((f) => !f)} data-fail-next={failNext}>
          next request fails
        </button>
        {(Object.keys(FAILURE_COPY) as FailureClass[]).map((k) => (
          <button key={k} type="button" className={cls === k ? BTN_ON : BTN} aria-pressed={cls === k} onClick={() => setCls(k)}>
            {k}
          </button>
        ))}
        <button type="button" className={BTN} onClick={() => void load()}>
          {held ? "refresh" : "load"}
        </button>
        <button type="button" className={BTN} onClick={region.reset}>
          reset region
        </button>
        <StateChip state={state} />
      </div>

      <div className="mt-3 min-h-[7.5rem]" data-content={state} aria-busy={region.inFlight}>
        {state === "loading" ? (
          <GhostRows count={4} reduced={reduced} rowClass={ROW} />
        ) : state === "failed" && copy ? (
          <div role="alert" className="rounded-lg border border-danger/40 px-3 py-3" data-failure={region.error}>
            <p className="type-body-sm font-medium text-danger">
              <span aria-hidden className="mr-1.5 inline-block h-4 w-4 rounded-full border border-danger text-center type-micro leading-4">
                !
              </span>
              {escalated ? "Still can’t reach the alerts service." : copy.title}
            </p>
            <p className="mt-0.5 type-caption text-slate-500">{copy.action === "retry" ? "Your filters and place are kept. Retry reissues exactly this request." : "Retrying would not help — sign in, then the alerts load on their own."}</p>
            <div className="mt-2">
              {copy.action === "retry" ? (
                <BusyButton label="Retry" busyLabel="Retrying…" reduced={reduced} className={BTN} onPress={load} />
              ) : (
                <button type="button" className={BTN}>
                  Sign in
                </button>
              )}
            </div>
          </div>
        ) : (
          <ul className="space-y-1" data-rows>
            {region.content.map((a) => (
              <li key={a.id} className={ROW}>
                <span className="type-caption text-slate-300">{a.label}</span>
                <span className={`type-caption ${a.severity === "danger" ? "text-danger" : "text-warn"}`}>{a.severity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {held && region.error ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 type-caption text-warn" role="status" data-ambient-failure>
          Last refresh failed · showing alerts as of <span className="font-mono tabular-nums">{region.ageS}s</span> ago
          {copy?.action === "retry" ? <BusyButton label="retry" busyLabel="retrying…" reduced={reduced} className={`${BTN} !min-w-0`} onPress={load} /> : null}
        </p>
      ) : null}
      <div className="mt-2 space-y-1">
        <Readout label="held / error" value={`${region.content.length} / ${region.error ?? "null"}`} />
        <Readout label="reported to telemetry" value={<span data-reported={region.failures}>{region.failures}</span>} />
      </div>
      <p className="mt-2 type-caption text-slate-500">To see the first-load failure: reset the region, arm the failure, load. Calm outside, loud inside — every rendered failure is also counted.</p>
    </Region>
  );
}
