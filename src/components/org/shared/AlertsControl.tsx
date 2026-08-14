"use client";

// Org dashboard "Alerts" chip + config popover (admin-only). Surfaces the per-org alert webhook
// backend (GET/POST /api/org/alerts) that previously had no UI: set/clear the Slack-compatible
// incoming-webhook the org's regression / low-credit / weekly-digest alerts POST to, and send a test
// so an admin can confirm delivery now instead of waiting for a real regression. Lazily loads the
// current webhook on open; a non-admin viewer just sees an "admins only" note (the GET 403s).
//
// The chip also carries the fleet's UNREAD state: a movement count since this viewer's last look, and
// a "since you last looked" list above the config section (see AlertsMovement.tsx). That half is
// member-readable and degrades to the old countless chip whenever there's no viewer/membership.
//
// State/effects/handlers live in useAlertsControl.ts — this file is JSX only.

import { trapTab, ThresholdFields } from "./AlertsControlParts";
import { AlertsHistory } from "./AlertsHistory";
import { MovementBadge, MovementSince } from "./AlertsMovement";
import { useAlertsControl } from "./useAlertsControl";

export function AlertsControl({ org }: { org: string }) {
  const {
    open,
    setOpen,
    loaded,
    webhookUrl,
    setWebhookUrl,
    overallDrop,
    setOverallDrop,
    dimensionDrop,
    setDimensionDrop,
    configured,
    denied,
    busy,
    error,
    notice,
    ref,
    triggerRef,
    dialogRef,
    movement,
    badgeCount,
    dirty,
    canSave,
    save,
    clear,
    test,
  } = useAlertsControl(org);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        title="Configure where this org's alerts are sent"
      >
        <span aria-hidden>🔔</span> Alerts
        <MovementBadge count={badgeCount} capped={movement?.capped ?? false} />
      </button>

      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-label="Alert routing"
          tabIndex={-1}
          onKeyDown={(e) => trapTab(e, dialogRef.current)}
          className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl outline-none"
        >
          {/* What moved since this viewer last looked — above the config, because it's the reason a
              returning lead opens this at all. Renders nothing when there's no movement payload. */}
          <MovementSince movement={movement} />
          {/* Persisted dispatch history (AlertEvent) — what was raised and whether it landed,
              including alerts raised with no sink configured. Member-readable, lazy-loaded. */}
          <AlertsHistory org={org} />
          <div className="font-mono text-sm uppercase tracking-widest text-accent">Alert routing</div>
          {denied ? (
            <p className="mt-2 text-sm text-slate-400">Only org admins can configure alert routing.</p>
          ) : !loaded ? (
            <p className="mt-2 font-mono text-sm text-slate-500">Loading…</p>
          ) : (
            <>
              <p className="mt-1 text-sm text-slate-400">
                Slack-compatible incoming webhook for this org&apos;s regression, low-credit, and weekly-digest
                alerts. Leave blank to use the deployment&apos;s global sink.
              </p>
              <input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 outline-none focus:border-accent"
              />

              <ThresholdFields
                overallDrop={overallDrop}
                dimensionDrop={dimensionDrop}
                setOverallDrop={setOverallDrop}
                setDimensionDrop={setDimensionDrop}
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy !== null || !canSave}
                  className="focus-ring rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
                >
                  {busy === "save" ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={test}
                  disabled={busy !== null}
                  className="focus-ring rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
                >
                  {busy === "test" ? "Sending…" : "Send test"}
                </button>
                {configured && (
                  <button
                    type="button"
                    onClick={clear}
                    disabled={busy !== null}
                    className="focus-ring rounded-md border border-slate-700 px-2.5 py-1.5 text-sm text-slate-400 transition hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
                  >
                    Clear
                  </button>
                )}
              </div>
              {/* Standing dirty-state cue: the dialog closes on ANY outside click/Escape, so a form
                  with unapplied edits needs a visible marker that outlasts a transient notice.
                  (ambiguity-ui 2026-07-16 #4) */}
              {dirty && <div className="mt-2 font-mono text-xs text-warn">Unsaved changes — Save to apply.</div>}
              {/* fleet-alerts-digests #6: a PERSISTENT polite live region so Save / Clear / Send-test
                  results (and errors) are announced to screen readers. Previously these were plain
                  <p>s that mounted on demand — no SR voiced them, so a keyboard/SR admin got no
                  confirmation the webhook saved or the test delivered. The container is always mounted
                  while the form is open so the announcement fires reliably when its text changes. */}
              <div role="status" aria-live="polite" className={notice || error ? "mt-2 text-sm" : "sr-only"}>
                {notice && <span className="text-emerald-300">{notice}</span>}
                {error && <span className="text-danger">{error}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
