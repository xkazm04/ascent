"use client";

// Two-step regenerate. The confirm states the consequence before the token is invalidated.
import { useState } from "react";
import { GhostAction, Panel, PrimaryAction } from "@/components/kit";
import { ConnectNotice } from "./ConnectNotice";

export function RegenerateTokenV2({ slug, onRotated }: { slug: string; onRotated: (token: string) => void }) {
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
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? `Regeneration failed (${res.status}).`);
        return;
      }
      onRotated(data.token);
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
        <GhostAction
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          Regenerate token
        </GhostAction>
        {error && <ConnectNotice ok={false} text={error} />}
      </div>
    );
  }

  return (
    <Panel pad="sm" aria-label="Confirm token regeneration">
      <p className="type-body-sm text-slate-200">
        Regenerating invalidates the current token immediately. Every Claude Code exporter, CI job and collector still configured with it
        stops reporting (HTTP 401) until it is reconfigured with the new token. Telemetry sent in the meantime is not queued or recovered.
        Only this organization is affected.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PrimaryAction onClick={() => void rotate()} disabled={busy}>
          {busy ? "Regenerating…" : "Yes, regenerate"}
        </PrimaryAction>
        <GhostAction onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </GhostAction>
        {error && <ConnectNotice ok={false} text={error} />}
      </div>
    </Panel>
  );
}
