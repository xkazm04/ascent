"use client";

// FORGE-NEUTRAL INGESTION (moonshot #4) — connect a GitLab account so the scanner can read projects
// that do not live on GitHub.
//
// The card's honesty rules, which are why it exists rather than a generic "add token" form:
//  - The token input is `type="password"`, is NEVER populated from the server, and is cleared the
//    moment a save succeeds. What comes back is `hasCredential` — a boolean, not a masked secret — so
//    there is nothing on this page for a screenshot or a DOM dump to leak.
//  - The capability table lists what GitLab CANNOT be asked in the same breath as what it can, and
//    says out loud that the gaps read as unknown rather than zero. A connect flow that advertises
//    only capabilities teaches the reader that the missing signals ARE zero, which is the exact
//    misreading the honest-nulls doctrine exists to prevent.

import { useState } from "react";
import { SelectInput, TextInput } from "@/components/ui";
import { Card } from "@/components/org/shared/ui";
import type { ForgeInstallationRow } from "@/lib/db/forge-installations";
import { CAPABILITY_LABELS } from "./forgeCapabilityLabels";

const BTN =
  "focus-ring rounded-lg border border-divider px-3 py-1.5 type-body-sm text-slate-300 transition hover:border-accent/60 hover:text-white disabled:opacity-50";
const CHIP = "rounded-full border border-divider px-2 py-0.5 type-caption text-slate-400";

export function ForgeInstallationCard({
  slug,
  initial,
  encryptionConfigured,
}: {
  slug: string;
  initial: ForgeInstallationRow[];
  encryptionConfigured: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [externalId, setExternalId] = useState("");
  const [host, setHost] = useState("");
  const [credential, setCredential] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/forge/installation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org: slug,
          forge: "gitlab",
          externalId: externalId.trim(),
          host: host.trim() || null,
          credential: credential || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { installation?: ForgeInstallationRow; error?: string };
      if (!res.ok || !body.installation) {
        setError(body.error ?? `Could not save the connection (${res.status}).`);
        return;
      }
      const saved = body.installation;
      setRows((prev) => [...prev.filter((r) => r.id !== saved.id), saved]);
      // The secret leaves the browser's memory as soon as it is stored. Nothing ever reads it back.
      setCredential("");
    } catch {
      setError("Request failed. Is the app reachable?");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(row: ForgeInstallationRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/forge/installation", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, forge: row.forge, externalId: row.externalId }),
      });
      if (!res.ok) {
        setError(`Could not disconnect (${res.status}).`);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch {
      setError("Request failed. Is the app reachable?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-semibold text-white">GitLab</h3>
        <p className="mt-1 type-body-sm text-slate-400">
          Scan GitLab projects with the same rubric and the same report. Paste a group access token (or a personal
          access token) with <code className="type-mono-sm">read_api</code>; add a host for a self-managed instance.
        </p>
      </div>

      {!encryptionConfigured && (
        <p role="status" className="type-body-sm text-orange-300">
          This deployment cannot encrypt secrets (no <code className="type-mono-sm">ENCRYPTION_KEY</code>), so a token
          will not be stored. Set the key first — nothing here writes a credential in the clear.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <span className={CHIP}>{row.forge}</span>
              <span className="type-mono-sm text-slate-300">{row.externalId}</span>
              {row.host && <span className="type-caption text-slate-500">{row.host}</span>}
              <span className={CHIP}>{row.hasCredential ? "token stored" : "no token"}</span>
              <button type="button" className={BTN} onClick={() => void disconnect(row)} disabled={busy}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <SelectInput value="gitlab" aria-label="Forge" disabled onChange={() => {}}>
          <option value="gitlab">GitLab</option>
        </SelectInput>
        <TextInput
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="group path or project id"
          aria-label="Group path or project id"
        />
        <TextInput
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="https://gitlab.example.com (optional)"
          aria-label="Self-managed host"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          type="password"
          value={credential}
          onChange={(e) => setCredential(e.target.value)}
          placeholder="access token"
          aria-label="Access token"
          autoComplete="off"
          className="max-w-xs"
        />
        <button type="button" className={BTN} onClick={() => void save()} disabled={busy || !externalId.trim()}>
          {rows.length ? "Save / rotate" : "Connect"}
        </button>
      </div>
      {error && (
        <p role="status" className="type-body-sm text-orange-300">
          {error}
        </p>
      )}

      <ForgeCapabilityTable />
    </Card>
  );
}

/** The per-forge observability table, derived from the adapter's own manifest. */
function ForgeCapabilityTable() {
  return (
    <div className="border-t border-divider pt-4">
      <p className="type-caption text-slate-400">What Ascent can observe on GitLab</p>
      <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
        {CAPABILITY_LABELS.map((c) => (
          <li key={c.key} className="flex items-baseline gap-2 type-caption">
            <span aria-hidden className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${c.gitlab ? "bg-slate-400" : "bg-slate-700"}`} />
            <span className={c.gitlab ? "text-slate-300" : "text-slate-500"}>{c.gitlab ? "observed" : "not observable"}</span>
            <span className="text-slate-500">— {c.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 type-note text-slate-500">
        An unobservable signal is reported as unknown, never as zero, and no score is adjusted to compensate for it — so
        a GitLab repo is floored by what cannot be seen, not penalised for it.
      </p>
    </div>
  );
}
