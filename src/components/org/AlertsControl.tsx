"use client";

// Org dashboard "Alerts" chip + config popover (admin-only). Surfaces the per-org alert webhook
// backend (GET/POST /api/org/alerts) that previously had no UI: set/clear the Slack-compatible
// incoming-webhook the org's regression / low-credit / weekly-digest alerts POST to, and send a test
// so an admin can confirm delivery now instead of waiting for a real regression. Lazily loads the
// current webhook on open; a non-admin viewer just sees an "admins only" note (the GET 403s).

import { useEffect, useRef, useState } from "react";

export function AlertsControl({ org }: { org: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [overallDrop, setOverallDrop] = useState(""); // "" = inherit the default (5)
  const [dimensionDrop, setDimensionDrop] = useState(""); // "" = inherit the default (15)
  const [configured, setConfigured] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
        setWebhookUrl(url);
        setConfigured(!!url);
        setOverallDrop(typeof d.overallDrop === "number" ? String(d.overallDrop) : "");
        setDimensionDrop(typeof d.dimensionDrop === "number" ? String(d.dimensionDrop) : "");
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

  async function save() {
    const d = await post(
      {
        webhookUrl,
        overallDrop: overallDrop.trim() === "" ? null : Number(overallDrop),
        dimensionDrop: dimensionDrop.trim() === "" ? null : Number(dimensionDrop),
      },
      "save",
    );
    if (d) {
      setConfigured(!!d.webhookUrl);
      setNotice("Saved.");
    }
  }
  async function clear() {
    const d = await post({ webhookUrl: null }, "clear");
    if (d) {
      setWebhookUrl("");
      setConfigured(false);
      setNotice("Cleared — alerts fall back to the global sink (if any).");
    }
  }
  async function test() {
    // Send the URL currently in the form so "Send test" validates the CANDIDATE webhook the admin is
    // editing — not the previously-saved sink. A blank field tests the org's resolved/saved sink.
    const d = await post({ test: true, webhookUrl }, "test");
    if (d) setNotice(d.delivered ? "Test alert delivered ✓" : d.error ?? "No sink configured.");
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white"
        title="Configure where this org's alerts are sent"
      >
        <span aria-hidden>🔔</span> Alerts
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Alert routing"
          className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-2xl"
        >
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

              <div className="mt-3 text-sm text-slate-400">Regression sensitivity (points) — blank inherits the default.</div>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
                  overall drop
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={overallDrop}
                    onChange={(e) => setOverallDrop(e.target.value)}
                    placeholder="5"
                    className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
                  />
                </label>
                <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
                  dimension drop
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={dimensionDrop}
                    onChange={(e) => setDimensionDrop(e.target.value)}
                    placeholder="15"
                    className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
                  />
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={save}
                  // Enable Save when ANYTHING is editable, not only when a webhook URL is present: the
                  // backend supports a thresholds-only update (an org on the global ALERT_WEBHOOK_URL
                  // leaves this field blank), so gating purely on the URL made regression sensitivity
                  // un-tunable through the UI. A blank URL is sent as a no-op clear; clearing an existing
                  // per-org webhook stays on the dedicated Clear button.
                  disabled={busy !== null || !(webhookUrl.trim() || overallDrop.trim() || dimensionDrop.trim())}
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
              {notice && <p className="mt-2 text-sm text-emerald-300">{notice}</p>}
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
