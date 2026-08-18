"use client";

// "Regenerate token" — the owner's kill switch for a leaked ingest token. Two-step by design: the
// first click swaps in an inline confirm that states the CONSEQUENCE in plain words, because the
// action is instant and remote — every exporter still using the old token starts getting 401s on its
// next push, and the operator of that exporter finds out from a dashboard, not from this page.
//
// On success the caller receives the new token and re-renders the endpoint snippet with it, so the
// owner can copy the corrected configuration without a page reload (a reload here would be actively
// harmful: the token they need to paste is only obtainable from this response).

import { useState } from "react";

export function RegenerateTokenButton({ slug, onRotated }: { slug: string; onRotated: (token: string, epoch: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, rotate: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { token?: string; epoch?: number; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? `Regeneration failed (${res.status}).`);
        return;
      }
      onRotated(data.token, data.epoch ?? 0);
      setConfirming(false);
    } catch {
      setError("Request failed. Is the app reachable?");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="focus-ring rounded-lg border border-divider px-3 py-1.5 text-sm text-slate-300 transition hover:border-orange-400/60 hover:text-white"
        >
          Regenerate token
        </button>
        {error && (
          <p role="status" className="text-sm text-orange-300">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-orange-400/40 bg-orange-400/5 p-3">
      <p className="text-sm text-slate-300">
        Regenerating invalidates the current token <strong className="font-semibold text-white">immediately</strong>. Every Claude Code
        exporter, CI job and collector still configured with it stops reporting (HTTP 401) until it is reconfigured with the new token.
        Telemetry sent in the meantime is not queued or recovered. Only this organization is affected.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={rotate}
          disabled={busy}
          className="focus-ring rounded-lg border border-orange-400/50 bg-orange-400/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-orange-400/20 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Yes, regenerate"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="focus-ring rounded-lg border border-divider px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
        {error && (
          <p role="status" className="text-sm text-orange-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
