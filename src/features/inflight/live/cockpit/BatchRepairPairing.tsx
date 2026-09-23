"use client";

// RE-PAIR A MOVED CHECKOUT WITHOUT LEAVING THE BATCH (challenge-2026-09-23b).
//
// The ledger's `broken` row: a repo that IS paired, but whose stored path no longer verifies. It used
// to be invisible until Run answered 409 for the first such repo, and the only fix was Admin → Pairing,
// one row at a time. Here the verifier's sentence is the row, and an OWNER can paste the new path and
// press Re-pair in place: the same owner-gated route the admin tab posts (verify, then persist), so the
// cockpit gains a door, not a second rule. On success the ledger refetches (`onRepaired`) and the row
// becomes that repo's real batch; a refused path keeps what was typed and shows why, inline.
//
// A non-owner sees the sentence and nothing they cannot act on: the route would 403 them anyway.

import { useState } from "react";
import { repairPairing } from "./loopClient";

export interface BatchRepairPairingProps {
  slug: string;
  repo: string;
  /** The verifier's sentence, from the proposal's pairing verdict. */
  error: string;
  /** Owner only: the pairing route is owner-gated. */
  canRepair: boolean;
  onRepaired: () => void;
}

export function BatchRepairPairing({ slug, repo, error, canRepair, onRepaired }: BatchRepairPairingProps) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setRefused(null);
    try {
      await repairPairing(slug, repo, path.trim());
      onRepaired();
    } catch (e) {
      setRefused(e instanceof Error ? e.message : "Could not re-pair that repository.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="block min-w-0">
      <span className="type-caption text-warn">pairing broken: {error}</span>
      <span className="ml-2 type-caption text-slate-600">skipped</span>
      {canRepair && (
        <form
          className="mt-1.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && path.trim()) void submit();
          }}
        >
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="New absolute path on this server"
            aria-label={`New path for ${repo}`}
            className="focus-ring min-w-56 flex-1 rounded-lg border border-divider bg-ink px-2.5 py-1 type-caption text-slate-200 placeholder:text-slate-600"
          />
          <button
            type="submit"
            disabled={busy || !path.trim()}
            className="focus-ring rounded-lg bg-accent px-3 py-1 type-caption font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {busy ? "Re-pairing…" : "Re-pair"}
          </button>
        </form>
      )}
      {refused && (
        <span role="alert" className="mt-1 block type-caption text-warn">
          {refused}
        </span>
      )}
    </span>
  );
}
