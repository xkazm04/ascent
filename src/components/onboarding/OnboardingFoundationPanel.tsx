"use client";

// The wizard's done-phase install CTA (moonshot #35) — the step that turns "here are your scores" into
// "here is the standard, installed".
//
// The wizard used to hand off with nothing installable: the dashboard was where activation continued,
// and the `.ai/` foundation — the one artefact a scan can actually generate for a repo — sat behind
// several clicks the user had no reason to look for. This puts it at peak motivation, in the same
// place and shape as InvitePanel.
//
// TWO HONESTY RULES, both visible before anything is sent:
//  1. The disclosure names what a PR contains and that it is a DRAFT nobody merges for you.
//  2. Report-back (the two secrets, and the App permission they need) is DESCRIBED here but not
//     performed here: writing a credential into a repo needs a typed confirmation and the owner role,
//     which belong on the Repositories tab, not in a wizard step.
//
// Role is not prefetched: a non-admin gets the route's own 403, surfaced verbatim. A prefetched role
// would be a second home for the authorization answer, and the one that drifts.

import { useState } from "react";

export function FoundationPanel({
  org,
  repos,
  onInstalled,
}: {
  /** The org the just-scanned repos belong to. */
  org: string;
  /** "owner/name" for every repo that completed a scan in this run. */
  repos: string[];
  /** Called once at least one PR was opened, so the wizard can note the step is done. */
  onInstalled?: (opened: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  if (repos.length === 0 || skipped) return null;

  async function install() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/report/foundation/pr-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repos }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: Array<{ ok: boolean; error?: string }>;
      };
      if (!res.ok) throw new Error(d.error ?? "Couldn't open the foundation PRs.");
      const opened = (d.results ?? []).filter((r) => r.ok).length;
      const failed = (d.results ?? []).length - opened;
      if (opened === 0) {
        // Every repo failed. Say so, and say why for the first one — reporting "0 PRs opened" as a
        // success is exactly the kind of quiet non-event this panel exists to avoid.
        throw new Error(d.results?.find((r) => !r.ok)?.error ?? "No PRs could be opened.");
      }
      setDone(
        `Opened ${opened} draft PR${opened === 1 ? "" : "s"}` +
          (failed ? ` · ${failed} repo${failed === 1 ? "" : "s"} couldn't be installed` : ""),
      );
      onInstalled?.(opened);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open the foundation PRs.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <h2 className="type-body font-semibold text-white">Install the standard</h2>
      <p className="mt-1 type-body-sm text-slate-400">
        Open a <strong className="text-slate-300">draft</strong> PR in the {repos.length}{" "}
        {repos.length === 1 ? "repository" : "repositories"} you just scanned, seeding the{" "}
        <span className="font-mono text-slate-300">.ai/</span> foundation Ascent generated from each scan: the agent
        contract, the executable <span className="font-mono">doctor</span> check, its CI backstop, and the CONTEXT
        seed. Nothing merges without you.
      </p>
      <p className="mt-2 type-body-sm text-slate-500">
        Afterwards, the Repositories tab can provision two GitHub Actions secrets —{" "}
        <span className="font-mono">ASCENT_CONFORMANCE_URL</span> and{" "}
        <span className="font-mono">ASCENT_CONFORMANCE_TOKEN</span> — so each repo reports its own conformance back on
        every CI run. That needs the App&apos;s <strong className="text-slate-400">Secrets: write</strong> permission and
        a typed confirmation per repo.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={install}
          disabled={busy || done != null}
          className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Opening PRs…" : `Install the foundation in ${repos.length} repo${repos.length === 1 ? "" : "s"}`}
        </button>
        {done == null && (
          <button
            onClick={() => setSkipped(true)}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-3 py-1.5 type-body-sm text-slate-400 hover:border-slate-600 disabled:opacity-50"
          >
            Skip
          </button>
        )}
      </div>

      {done && (
        <p className="mt-2 type-mono-sm text-emerald-300">
          {done} · review them on GitHub, then merge when you&apos;re ready.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 type-mono-sm text-danger-soft">
          {error}
        </p>
      )}
    </div>
  );
}
