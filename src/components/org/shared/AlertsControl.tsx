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

import { useEffect, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR, ThresholdFields, trapTab } from "./AlertsControlParts";
import { MovementBadge, MovementSince, useOrgMovement } from "./AlertsMovement";

export function AlertsControl({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [overallDrop, setOverallDrop] = useState(""); // "" = inherit the default (5)
  const [dimensionDrop, setDimensionDrop] = useState(""); // "" = inherit the default (15)
  // The values loaded from the server, so we can tell what the admin actually changed. Thresholds are
  // an independent, backend-supported payload from the webhook — an org on the global sink must be able
  // to tune sensitivity WITHOUT typing a webhook, and an untouched webhook must not be resent (a
  // present webhookUrl is an authoritative set/clear on the API).
  const [initialWebhook, setInitialWebhook] = useState("");
  const [initialOverallDrop, setInitialOverallDrop] = useState("");
  const [initialDimensionDrop, setInitialDimensionDrop] = useState("");
  const [configured, setConfigured] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { movement, badgeCount, markSeen } = useOrgMovement(org);

  // Opening the control IS the act of looking, so it advances the watermark (the list stays visible —
  // only the badge clears). Kept in an effect rather than the click handler so a keyboard/programmatic
  // open counts the same as a mouse one.
  useEffect(() => {
    if (open) markSeen();
  }, [open, markSeen]);

  // Dismiss on outside click / Escape. Deliberately does NOT reset the form state: the component
  // stays mounted, so an accidentally-dismissed dirty draft (webhook pasted, test sent, clicked
  // elsewhere) is still there on reopen instead of being silently discarded. (ambiguity-ui #4)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // a11y: the popover declares role="dialog", so it must own the focus half of that contract too. On
  // open, move focus into the dialog (so keyboard/SR users land inside what they just opened) and
  // restore it to the trigger on close. Tab is trapped via onKeyDown below.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const first = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? dialogRef.current)?.focus();
    return () => {
      trigger?.focus();
    };
  }, [open]);

  // Content loads lazily (Loading… → form). Once the form renders, advance focus from the dialog
  // container to its first field — but only if the user hasn't already Tabbed elsewhere.
  useEffect(() => {
    if (!open || !loaded) return;
    if (document.activeElement !== dialogRef.current) return;
    dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, [open, loaded]);

  // Load the current webhook the first time the popover opens.
  useEffect(() => {
    if (!open || loaded) return;
    fetch(`/api/org/alerts?org=${encodeURIComponent(org)}`)
      .then(async (r) => {
        if (r.status === 403 || r.status === 401) {
          setDenied(true);
          return;
        }
        const d = await r.json().catch(() => ({}));
        const url = typeof d.webhookUrl === "string" ? d.webhookUrl : "";
        const od = typeof d.overallDrop === "number" ? String(d.overallDrop) : "";
        const dd = typeof d.dimensionDrop === "number" ? String(d.dimensionDrop) : "";
        setWebhookUrl(url);
        setInitialWebhook(url);
        setConfigured(!!url);
        setOverallDrop(od);
        setInitialOverallDrop(od);
        setDimensionDrop(dd);
        setInitialDimensionDrop(dd);
      })
      .catch(() => setError("Couldn't load alert settings."))
      .finally(() => setLoaded(true));
  }, [open, loaded, org]);

  async function post(payload: Record<string, unknown>, kind: "save" | "clear" | "test") {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/org/alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, ...payload }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Request failed.");
      return d as { webhookUrl?: string | null; delivered?: boolean; error?: string };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  // Save is meaningful only when something actually CHANGED (a touched webhook or a threshold field —
  // thresholds save independently of the sink, the fix that lets a global-sink org tune sensitivity
  // with no webhook). A pristine form disables Save: an always-enabled Save on an unchanged webhook
  // read as "there's something left to do" and blurred the test-vs-save distinction below.
  // (ambiguity-ui 2026-07-16 #4)
  const webhookTouched = webhookUrl.trim() !== initialWebhook.trim();
  const thresholdsChanged = overallDrop !== initialOverallDrop || dimensionDrop !== initialDimensionDrop;
  const dirty = webhookTouched || thresholdsChanged;
  const canSave = dirty;

  async function save() {
    const payload: Record<string, unknown> = {
      overallDrop: overallDrop.trim() === "" ? null : Number(overallDrop),
      dimensionDrop: dimensionDrop.trim() === "" ? null : Number(dimensionDrop),
    };
    // Only send webhookUrl when the field actually changed. A present webhookUrl is an authoritative
    // set/clear on the API, so resending an untouched (often empty, global-sink) value would clear the
    // override on every threshold-only save — the reason a webhook-less org couldn't tune sensitivity.
    if (webhookTouched) payload.webhookUrl = webhookUrl.trim() === "" ? null : webhookUrl;
    const d = await post(payload, "save");
    if (d) {
      if (webhookTouched) setConfigured(!!d.webhookUrl);
      // Sync the baseline so the form is no longer "dirty" after a successful save.
      setInitialWebhook(webhookUrl);
      setInitialOverallDrop(overallDrop);
      setInitialDimensionDrop(dimensionDrop);
      setNotice("Saved.");
    }
  }
  async function clear() {
    const d = await post({ webhookUrl: null }, "clear");
    if (d) {
      setWebhookUrl("");
      setInitialWebhook("");
      setConfigured(false);
      setNotice("Cleared — alerts fall back to the global sink (if any).");
    }
  }
  async function test() {
    // Send the URL currently in the form so "Send test" validates the CANDIDATE webhook the admin is
    // editing — not the previously-saved sink. A blank field tests the org's resolved/saved sink.
    // When the form is dirty, the success notice must NOT read like a terminal confirmation:
    // "delivered ✓" alone sounded like the webhook was configured, so admins clicked away (the popover
    // dismisses on any outside click) with the URL never saved — discovered weeks later when a real
    // regression landed in the wrong channel. (ambiguity-ui 2026-07-16 #4)
    const d = await post({ test: true, webhookUrl }, "test");
    if (d)
      setNotice(
        d.delivered
          ? dirty
            ? "Test alert delivered ✓ — not saved yet. Click Save to apply."
            : "Test alert delivered ✓"
          : d.error ?? "No sink configured.",
      );
  }

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
