"use client";

// State/effects/handlers for the Alerts control popover (AlertsControl.tsx). Owns no JSX — split out
// per docs/ORG-TABS-REFACTOR.md's extraction order (state/effects/handlers before JSX regions) to
// bring AlertsControl.tsx under the 200-LOC cap.

import { useEffect, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "./AlertsControlParts";
import { useOrgMovement } from "./AlertsMovement";

export function useAlertsControl(org: string) {
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

  return {
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
  };
}
