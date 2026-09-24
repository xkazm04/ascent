"use client";

// OpenAI Codex connect surface: the ADMIN-PULL path with a CUSTOMER key. Unlike CopilotSetup (which
// reads through the GitHub App Ascent already holds), this connector needs the org's OpenAI Admin key:
// the owner saves it once (PUT /api/integrations/openai, stored encrypted, never shown again), then
// Sync now pulls the Admin Costs API (POST /api/integrations/openai/sync).
//
// THE HONESTY THIS PANEL CARRIES: OpenAI reports cost by organization and project, not repository, so
// the AI delivery views show it as ALLOCATED. Without a project filter every OpenAI API cost in the
// organization counts, including spend that is not coding; the filter is offered and the consequence
// stated before the owner syncs. A partial sync (page cap, rate limit) says PARTIAL, never complete.

import { useState } from "react";
import { Kicker } from "@/components/ui";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { lastSyncLine, parseProjectIds, remedyFor, syncSummaryLine, type OpenAISyncBody } from "./openaiSetupModel";

type Busy = null | "save" | "sync" | "disconnect";
type Result = { ok: boolean; text: string; note?: string } | null;

const ENDPOINT = "/api/integrations/openai";
const INPUT =
  "focus-ring w-full rounded-lg border border-divider bg-surface-strong/60 px-2.5 py-1.5 type-caption text-slate-200 placeholder:text-slate-600";
const BUTTON =
  "focus-ring rounded-lg border px-3 py-1.5 type-body-sm font-medium transition disabled:opacity-50";

async function send(method: string, url: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

export function OpenAISetup({
  slug,
  initial,
  encryptionConfigured,
}: {
  slug: string;
  initial: ProviderConnectionRow | null;
  encryptionConfigured: boolean;
}) {
  const [conn, setConn] = useState<ProviderConnectionRow | null>(initial);
  const [key, setKey] = useState("");
  const [projects, setProjects] = useState((initial?.projectIds ?? []).join(", "));
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<Result>(null);
  const connected = Boolean(conn?.hasCredential);

  async function run(kind: Exclude<Busy, null>, act: () => Promise<Result>) {
    setBusy(kind);
    setResult(null);
    try {
      setResult(await act());
    } catch {
      setResult({ ok: false, text: "Request failed. Is the app reachable?" });
    } finally {
      setBusy(null);
    }
  }

  const fail = (status: number, data: Record<string, unknown>): Result => ({
    ok: false,
    text: typeof data.error === "string" ? data.error : `The request failed (${status}).`,
    note: remedyFor(status) ?? undefined,
  });

  const save = () =>
    run("save", async () => {
      const { status, data } = await send("PUT", ENDPOINT, {
        org: slug,
        ...(key.trim() ? { adminKey: key.trim() } : {}),
        projectIds: parseProjectIds(projects),
      });
      if (status !== 200) return fail(status, data);
      setConn(data.connection as ProviderConnectionRow);
      setKey(""); // the key leaves the page once it is stored
      return { ok: true, text: "Saved. The admin key is stored encrypted and will not be shown again." };
    });

  const sync = () =>
    run("sync", async () => {
      const { status, data } = await send("POST", `${ENDPOINT}/sync`, { org: slug });
      const refreshed = await send("GET", `${ENDPOINT}?org=${encodeURIComponent(slug)}`).catch(() => null);
      if (refreshed?.status === 200) setConn((refreshed.data.connection as ProviderConnectionRow | null) ?? null);
      const body = data as OpenAISyncBody;
      if (status !== 200 || !body.synced) return fail(status, data);
      const note = body.partial ? `PARTIAL: ${body.partialReason ?? "the pull stopped before the window was complete."}` : body.note;
      return { ok: !body.partial, text: syncSummaryLine(body), note };
    });

  const disconnect = () =>
    run("disconnect", async () => {
      const { status, data } = await send("DELETE", ENDPOINT, { org: slug });
      if (status !== 200) return fail(status, data);
      setConn(null);
      return { ok: true, text: "Disconnected. The stored key was deleted; past synced cost stays on AI delivery." };
    });

  const last = lastSyncLine(conn);
  const canStore = encryptionConfigured || connected;

  return (
    <div className="space-y-3" data-testid="openai-setup">
      <div>
        <Kicker tone="muted">Connect with an OpenAI Admin key</Kicker>
        <p className="mt-1 type-body-sm text-slate-400">
          Ascent reads your organization&apos;s daily spend from the OpenAI <span className="text-slate-300">Admin Costs API</span>. It
          needs an organization <span className="text-slate-300">Admin key</span> (it starts{" "}
          <code className="type-caption text-slate-300">sk-admin-</code>); project keys cannot read costs. The key is stored encrypted,
          is only ever sent to OpenAI, and is never shown again.
        </p>
      </div>

      {!canStore ? (
        <p className="type-body-sm text-orange-300">
          Secret encryption is not configured on this deployment, so no key can be stored. An operator has to set{" "}
          <code className="type-caption">ENCRYPTION_KEY</code> first.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="type-label tracking-widest text-slate-500">{connected ? "Replace admin key" : "Admin key"}</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={connected ? "Stored (encrypted). Paste a new key to replace it." : "sk-admin-..."}
              className={`mt-1 ${INPUT}`}
            />
          </label>
          <label className="block">
            <span className="type-label tracking-widest text-slate-500">Projects (optional)</span>
            <input
              value={projects}
              onChange={(e) => setProjects(e.target.value)}
              placeholder="proj_... , proj_..."
              className={`mt-1 ${INPUT}`}
            />
          </label>
        </div>
      )}

      <div className="rounded-lg border border-divider bg-surface-strong/60 p-3">
        <p className="type-body-sm text-slate-400">
          <span className="text-slate-200">This cost is allocated, not measured.</span> OpenAI reports spend by organization and project,
          not by repository, so the <span className="text-slate-300">AI delivery</span> views distribute the org total across repositories
          by git-attributed AI volume and mark those figures Allocated. With no project filter, every OpenAI API cost in the
          organization counts, including spend that is not coding: list the projects Codex bills to.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {canStore && (
          <button type="button" onClick={save} disabled={busy !== null} className={`${BUTTON} border-accent/50 bg-accent/10 text-white hover:bg-accent/20`}>
            {busy === "save" ? "Saving…" : connected ? "Save changes" : "Save key"}
          </button>
        )}
        {connected && (
          <>
            <button type="button" onClick={sync} disabled={busy !== null} className={`${BUTTON} border-accent/50 bg-accent/10 text-white hover:bg-accent/20`}>
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button type="button" onClick={disconnect} disabled={busy !== null} className={`${BUTTON} border-divider text-slate-400 hover:text-white`}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </>
        )}
        {result && (
          <div role="status" className="min-w-0 flex-1">
            <p className={`type-body-sm ${result.ok ? "text-emerald-300" : "text-orange-300"}`}>{result.text}</p>
            {result.note && <p className="mt-1 type-note text-slate-500">{result.note}</p>}
          </div>
        )}
      </div>

      {last && <p className={`type-note ${last.tone === "ok" ? "text-slate-500" : "text-orange-300"}`}>{last.text}</p>}
      <p className="type-note text-slate-500">
        Each sync reads the last 90 days. Re-syncing is safe: each day is OpenAI&apos;s total for that day, so an overlapping window
        overwrites those days rather than adding to them.
      </p>
    </div>
  );
}
