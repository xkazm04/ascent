"use client";

// GitLab connect actions. The token state starts empty and is cleared on save: the server never sends it back.
import { useState } from "react";
import type { ForgeInstallationRow } from "@/lib/db/forge-installations";

export function useForgeConnect(slug: string, initial: ForgeInstallationRow[]) {
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
      setRows((prev) => [...prev.filter((row) => row.id !== saved.id), saved]);
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
      setRows((prev) => prev.filter((item) => item.id !== row.id));
    } catch {
      setError("Request failed. Is the app reachable?");
    } finally {
      setBusy(false);
    }
  }

  return { rows, externalId, setExternalId, host, setHost, credential, setCredential, busy, error, save, disconnect };
}
