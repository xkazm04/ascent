"use client";

// MOONSHOT #33 — the Apply affordance on a registry-origin practice.
//
// Its own file because `RegistryPractices.tsx` is a SERVER component (no hooks, no handlers) and must
// stay one: adding "use client" there would drag the whole registry list across the boundary for the
// sake of one button. Co-located extraction, per AGENTS.md.
//
// WHAT CHANGED AND WHAT DID NOT. The file stays under the registry's own review process — nothing here
// writes back to it, and "Open in registry" is still the affordance for changing the practice itself.
// What this adds is DISTRIBUTION: a draft PR that copies the org's own agreed practice into a repo that
// lacks it, through `applyPracticeToRepo` — the same writer, gate, audit row and adoption row as every
// other apply. The committed file says it is a copy and names the registry path it came from.
//
// NO PREVIEW STEP, deliberately. The generic starters are GENERATED per repo, so previewing is the only
// way to see what will land; a registry practice is a file the reader can already open in the registry,
// and a preview would show them the document they just clicked away from.

import { useState } from "react";
import { ConfirmAction } from "@/components/ConfirmAction";

export function RegistryPracticeApply({
  slug,
  title,
  repoOptions,
}: {
  /** The registry practice's slug — the id sent is `registry:<slug>`. */
  slug: string;
  title: string;
  /** Every repo in the org. Empty ⇒ nothing to apply to, so the control does not render. */
  repoOptions: string[];
}) {
  const [repo, setRepo] = useState(repoOptions[0] ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pr, setPr] = useState<{ url: string; reused: boolean } | null>(null);

  if (repoOptions.length === 0) return null;

  async function apply() {
    setBusy(true);
    setError(null);
    setPr(null);
    try {
      const res = await fetch("/api/practices/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, practiceId: `registry:${slug}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open the PR.");
      setPr({ url: data.url, reused: !!data.reused });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open the PR.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        value={repo}
        onChange={(e) => setRepo(e.target.value)}
        aria-label={`Repository to copy "${title}" into`}
        className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-300"
      >
        {repoOptions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy || !repo}
        className="rounded border border-accent/50 bg-accent/10 px-2.5 py-1 text-sm text-white hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Opening…" : "Copy into a repo →"}
      </button>
      {pr && (
        <a href={pr.url} target="_blank" rel="noreferrer" className="text-sm text-accent underline hover:text-white">
          {pr.reused ? "Existing draft PR" : "Draft PR opened"}
        </a>
      )}
      {error && <span className="text-sm text-orange-300">{error}</span>}

      <ConfirmAction
        open={confirming}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void apply();
        }}
        kicker="Registry practice"
        title={`Copy “${title}” into ${repo}?`}
        body={`This opens a draft pull request in ${repo} committing a COPY of your registry's practice at docs/practices/${slug}.md. The registry keeps the source of truth — this copy is for reference in that repo, and editing it there will not change the registry.`}
        confirmLabel="Open draft PR"
        tone="default"
      />
    </div>
  );
}
