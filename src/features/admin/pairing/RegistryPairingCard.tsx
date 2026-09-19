"use client";

// Step 1 of Pairing: the org's REGISTRY, paired to its working copy on this machine. Local first — a
// paired checkout is a complete read source for every registry module (index, skill trace, the fleet
// conformance sweep, local dispatch), so nothing here asks for a GitHub App. Connecting GitHub is the
// optional step rendered beneath this card (RegistryGithubStep).
//
// One endpoint, three verbs: Check (verify, persist nothing), Pair / Re-index (verify + save + index —
// re-pairing the same path IS the local re-index), Unpair (the row and its last index stay readable).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postRegistryPairing, type RegistryCheckView, type RegistryPairingView } from "./pairingClient";

const BTN =
  "focus-ring rounded-lg border border-divider px-3 py-1 type-caption text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50";
const PRIMARY =
  "focus-ring rounded-lg bg-accent px-3 py-1 type-caption font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50";

function Verdict({ check }: { check: RegistryCheckView }) {
  if (!check.ok) return <p className="text-danger">{check.error}</p>;
  return (
    <p className="text-slate-400">
      <span className="text-success-soft">✓ Registry checkout verified</span>
      {check.fullName && <> · <span className="text-slate-200">{check.fullName}</span></>}
      {check.branch && <> · branch <span className="text-slate-200">{check.branch}</span></>}
      {check.headSha && <> · HEAD <span className="text-slate-200">{check.headSha.slice(0, 8)}</span></>}
      {check.lanes.length > 0 && <> · lanes {check.lanes.join(", ")}</>}
      {check.originMatch === "mismatch" && (
        <span className="text-amber-300"> · ⚠ origin differs from this app&apos;s registry.remote — pairing is still allowed</span>
      )}
    </p>
  );
}

export function RegistryPairingCard({ org, view }: { org: string; view: RegistryPairingView }) {
  const router = useRouter();
  const [path, setPath] = useState(view.localPath ?? view.suggestedPath ?? "");
  const [busy, setBusy] = useState<"check" | "pair" | "unpair" | null>(null);
  const [check, setCheck] = useState<RegistryCheckView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paired = view.localPath !== null;

  const run = async (mode: "check" | "pair" | "unpair") => {
    setBusy(mode);
    setError(null);
    setMessage(null);
    setCheck(null);
    try {
      const d = await postRegistryPairing(org, { path: mode === "unpair" ? null : path.trim(), verifyOnly: mode === "check" });
      if (d.check) setCheck(d.check);
      if (d.error) setError(d.error);
      if (mode === "pair" && d.paired && d.counts) {
        const c = d.counts;
        const warned = d.warnings?.length ? ` · ${d.warnings.length} warning${d.warnings.length === 1 ? "" : "s"}` : "";
        setMessage(`Indexed ${d.fullName ?? "the registry"} at ${d.headSha?.slice(0, 7) ?? "HEAD"} — ${c.skills ?? 0} skills · ${c.practices ?? 0} practices · ${c.memory ?? 0} notes · ${c.lessons ?? 0} lessons${warned}`);
      }
      if (mode === "unpair" && d.ok) setMessage("Unpaired. The last index stays readable; reads fall back to GitHub if it is connected.");
      if (mode !== "check" && (d.ok || d.paired)) router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="type-mono-sm text-accent">01</span>
        <h3 className="type-body font-medium text-slate-100">Registry · local checkout</h3>
        <span
          className={`rounded-full border px-2 py-0.5 font-mono type-micro uppercase tracking-widest ${
            paired ? "border-success/30 bg-success/10 text-success-soft" : "border-divider text-slate-500"
          }`}
        >
          {paired ? "paired" : "not paired"}
        </span>
        {paired && view.lastIndexSha && (
          <span className="type-caption text-slate-500">
            {view.fullName} · indexed at {view.lastIndexSha.slice(0, 7)} · {view.counts.skills} skills · {view.counts.practices} practices ·{" "}
            {view.counts.memory} notes
          </span>
        )}
      </div>
      <p className="max-w-3xl type-body-sm text-slate-400">
        Skills, Practices, Memory and the Knowledge base read from this checkout — its committed HEAD, re-indexed whenever it moves. No
        GitHub App or token is needed.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Absolute path of the registry checkout, e.g. C:\Users\you\code\ai-registry"
          aria-label="Local path of the registry checkout"
          className="focus-ring min-w-72 flex-1 rounded-lg border border-divider bg-ink px-3 py-1.5 type-caption text-slate-200 placeholder:text-slate-600"
        />
        <button type="button" disabled={busy !== null || !path.trim()} onClick={() => run("check")} className={BTN}>
          {busy === "check" ? "Checking…" : "Check"}
        </button>
        <button type="button" disabled={busy !== null || !path.trim()} onClick={() => run("pair")} className={PRIMARY}>
          {busy === "pair" ? "Indexing…" : paired ? "Re-index" : "Pair & index"}
        </button>
        {paired && (
          <button type="button" disabled={busy !== null} onClick={() => run("unpair")} className={BTN}>
            {busy === "unpair" ? "…" : "Unpair"}
          </button>
        )}
      </div>
      {!paired && view.suggestedPath && path === view.suggestedPath && (
        <p className="type-caption text-slate-500">Prefilled from this app&apos;s .ai/manifest.yaml (registry.local).</p>
      )}
      {(check || error || message || view.lastError) && (
        <div className="space-y-1 type-caption">
          {check && <Verdict check={check} />}
          {error && !check?.error && <p className="text-danger">{error}</p>}
          {message && <p className="text-success-soft">{message}</p>}
          {!check && !error && !message && view.lastError && <p className="text-warn">Last index failed: {view.lastError}</p>}
        </div>
      )}
    </section>
  );
}
