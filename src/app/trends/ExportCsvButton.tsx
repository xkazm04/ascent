"use client";

// "Export CSV" as UI, not as a raw navigation to an auth-gated API route (G5-16).
//
// It used to be a plain `<a href="/api/history?...&format=csv">`. That is a full top-level navigation
// into an endpoint that answers 401 with a JSON body — so a user whose session had quietly expired
// watched the entire trends page be replaced by `{"error":"Sign in to view history."}`. No download,
// no explanation, no way back but the browser's Back button.
//
// The download now goes through fetch, so every non-OK status is handled as UI: 401/403 becomes a
// re-auth prompt (the page re-renders as the sign-in notice on reload, so reloading IS the recovery),
// and anything else becomes a plain retryable error. Success streams to a Blob and clicks a synthetic
// anchor, keeping the page — and its scroll position, and the range toggle's state — intact.

import { useCallback, useRef, useState } from "react";
import { HEADER_ACTION_LINK_CLASS } from "@/components/report/pill";

type State = "idle" | "working" | "expired" | "error";

/** Pull `filename="…"` out of a content-disposition header; null when absent/unparseable. */
function filenameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const m = /filename="?([^";]+)"?/i.exec(disposition);
  return m?.[1] ?? null;
}

export function ExportCsvButton({ repo }: { repo: string }) {
  const [state, setState] = useState<State>("idle");
  // One in-flight export at a time: a double-click otherwise fires two identical heavy CSV queries and
  // two downloads.
  const busy = useRef(false);

  const onClick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setState("working");
    let url: string | null = null;
    try {
      const res = await fetch(`/api/history?repo=${encodeURIComponent(repo)}&format=csv`, {
        headers: { accept: "text/csv" },
      });
      if (res.status === 401 || res.status === 403) {
        setState("expired");
        return;
      }
      if (!res.ok) {
        setState("error");
        return;
      }
      const blob = await res.blob();
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers.get("content-disposition")) ?? "ascent-trends.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setState("idle");
    } catch {
      // Offline / aborted / CORS-less network failure — same recoverable story as a 5xx.
      setState("error");
    } finally {
      // Revoke later, not synchronously after `click()`: some engines are still fetching the object
      // URL at that point. (Copied into a const — TS does not keep a `let`'s narrowing inside a closure.)
      const created = url;
      if (created) setTimeout(() => URL.revokeObjectURL(created), 10_000);
      busy.current = false;
    }
  }, [repo]);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={state === "working"}
        className={`${HEADER_ACTION_LINK_CLASS} disabled:opacity-60`}
        title="Download this repo's scan history as CSV"
      >
        {state === "working" ? "Exporting…" : "Export CSV ↓"}
      </button>
      {state === "expired" && (
        <span role="alert" className="font-mono text-sm text-amber-300">
          Session expired —{" "}
          <button type="button" onClick={() => window.location.reload()} className="underline">
            sign in again
          </button>
        </span>
      )}
      {state === "error" && (
        <span role="alert" className="font-mono text-sm text-rose-300">
          Export failed — try again.
        </span>
      )}
    </span>
  );
}
