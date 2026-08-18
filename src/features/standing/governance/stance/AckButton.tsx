"use client";

// Acknowledge the CURRENT stance version on one repo's behalf (admin action). Writes the
// OrgArtifactAck row via POST /api/org/ai-stance/ack, then refreshes the server-rendered readout.

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AckButton({ org, repo, version }: { org: string; repo: string; version: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ack() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/ai-stance/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo, version }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Failed to acknowledge.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to acknowledge.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={ack}
        disabled={busy}
        title={error ?? `Record that ${repo} adopted stance v${version}`}
        className="focus-ring rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs uppercase tracking-[0.14em] text-slate-400 transition hover:border-accent hover:text-white disabled:opacity-50"
      >
        {busy ? "…" : `Ack v${version}`}
      </button>
      {error && <span className="text-xs text-orange-300">{error}</span>}
    </span>
  );
}
