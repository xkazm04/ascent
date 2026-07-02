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

  // Save is meaningful when there's a webhook to store OR a threshold field changed (thresholds save
  // independently of the sink — the fix that lets a global-sink org tune sensitivity with no webhook).
  const webhookTouched = webhookUrl.trim() !== initialWebhook.trim();
  const thresholdsChanged = overallDrop !== initialOverallDrop || dimensionDrop !== initialDimensionDrop;
  const canSave = webhookUrl.trim() !== "" || thresholdsChanged;

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
    const d = await post({ test: true }, "test");
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
              {notice && <p className="mt-2 text-sm text-emerald-300">{notice}</p>}
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
