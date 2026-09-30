"use client";

// OpenAI connect actions. The admin key starts empty and is cleared on save. Nothing reads it back.
import { useState } from "react";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { parseProjectIds, remedyFor, syncSummaryLine, type OpenAISyncBody } from "./openaiSetupModel";

type Busy = null | "save" | "sync" | "disconnect";
type Result = { ok: boolean; text: string; note?: string } | null;
const ENDPOINT = "/api/integrations/openai";

async function send(method: string, url: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
}

export function useOpenAIConnect(slug: string, initial: ProviderConnectionRow | null) {
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
      setKey("");
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

  return { conn, key, setKey, projects, setProjects, busy, result, connected, save, sync, disconnect };
}
