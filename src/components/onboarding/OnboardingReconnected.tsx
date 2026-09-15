import type { ReattachState } from "@/components/onboarding/useImportReattach";

// The "you came back mid-scan" banner (Direction 8).
//
// A refresh during a scan used to land on the repo picker: the run was still going server-side (the
// import route's mapPool outlives the request), still persisting and still spending, and the wizard
// showed no trace of it — so the obvious move was to start the same scan again. This says, plainly,
// that the run is alive and that the wizard is following it rather than re-running it.
//
// Its own file so OnboardingScanStep.tsx (254 of its 300-LOC cap) doesn't grow. No hooks, no
// handlers: a plain presentational component, deliberately not marked "use client".

export function ReconnectedNotice({ state }: { state: ReattachState }) {
  if (state.status === "off" || state.status === "settled") return null;

  if (state.status === "unavailable") {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 type-body-sm text-amber-300">
        A scan from before you reloaded may still be running, but this page can&apos;t follow it from here.{" "}
        <strong>Don&apos;t start it again</strong> — that would scan (and charge for) the same repositories twice.
        Open the dashboard to see where it got to.
      </p>
    );
  }

  return (
    <p
      role="status"
      className="mt-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 type-body-sm text-slate-300"
    >
      <strong className="text-white">Reconnected</strong> — this scan was already running when you reloaded, and it
      kept going on the server. Nothing was started again.{" "}
      {state.pending > 0 ? (
        <>
          <span className="type-mono-sm tabular-nums">{state.pending}</span> of{" "}
          <span className="type-mono-sm tabular-nums">{state.total}</span>{" "}
          {state.total === 1 ? "repository is" : "repositories are"} still in progress; this updates on its own.
        </>
      ) : (
        <>Checking where it got to…</>
      )}
    </p>
  );
}
