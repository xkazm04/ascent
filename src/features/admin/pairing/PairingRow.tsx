"use client";

// One repo's pairing row: the path input, Check (verify only, persists nothing), Pair (verify +
// save), Unpair. The verdict renders inline under the row — origin mismatch is a WARNING, not a
// block (a local-only repo or renamed mirror is still honestly scannable; the operator typed the
// path themselves), mirroring verifyLocalPath's contract.

import { useState } from "react";
import type { PairingCheckView, PairingView } from "./pairingClient";
import { postPairing } from "./pairingClient";

export function PairingRow({ org, row, onChanged }: { org: string; row: PairingView; onChanged: () => void }) {
  const [path, setPath] = useState(row.localPath ?? "");
  const [busy, setBusy] = useState<"check" | "pair" | "unpair" | null>(null);
  const [check, setCheck] = useState<PairingCheckView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: "check" | "pair" | "unpair") => {
    setBusy(mode);
    setError(null);
    setCheck(null);
    try {
      const d = await postPairing({
        org,
        fullName: row.fullName,
        path: mode === "unpair" ? null : path.trim(),
        verifyOnly: mode === "check",
      });
      if (d.check) setCheck(d.check);
      if (d.error && !d.ok) setError(d.error);
      if (d.ok && mode !== "check") onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  };

  const paired = row.localPath != null;
  const btn =
    "focus-ring rounded-lg border border-divider px-3 py-1 font-mono text-xs text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50";

  return (
    <li className="border-t border-divider px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-48 font-mono text-sm text-slate-200">{row.fullName}</span>
        {paired ? (
          <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest text-success-soft">
            paired
          </span>
        ) : (
          <span className="rounded-full border border-divider px-2 py-0.5 font-mono text-[11px] uppercase tracking-widest text-slate-500">
            github only
          </span>
        )}
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Absolute path on this server, e.g. C:\Users\you\code\repo"
          aria-label={`Local path for ${row.fullName}`}
          className="focus-ring min-w-72 flex-1 rounded-lg border border-divider bg-ink px-3 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy !== null || !path.trim()} onClick={() => run("check")} className={btn}>
            {busy === "check" ? "Checking…" : "Check"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !path.trim()}
            onClick={() => run("pair")}
            className="focus-ring rounded-lg bg-accent px-3 py-1 font-mono text-xs font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50"
          >
            {busy === "pair" ? "Pairing…" : paired ? "Re-pair" : "Pair"}
          </button>
          {paired && (
            <button type="button" disabled={busy !== null} onClick={() => run("unpair")} className={btn}>
              {busy === "unpair" ? "…" : "Unpair"}
            </button>
          )}
        </div>
      </div>
      {(check || error) && (
        <div className="mt-2 pl-1 font-mono text-xs">
          {error && <p className="text-danger">{error}</p>}
          {check?.ok && (
            <p className="text-slate-400">
              <span className="text-success-soft">✓ Working copy verified</span>
              {check.branch && <> · branch <span className="text-slate-200">{check.branch}</span></>}
              {check.headSha && <> · HEAD <span className="text-slate-200">{check.headSha.slice(0, 8)}</span></>}
              {check.originMatch === "mismatch" && (
                <span className="text-amber-300"> · ⚠ origin points at {check.origin ?? "another repo"} — pairing anyway is allowed, but double-check the folder</span>
              )}
              {check.originMatch === "unknown" && <span className="text-slate-500"> · no origin remote (local-only repo)</span>}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
