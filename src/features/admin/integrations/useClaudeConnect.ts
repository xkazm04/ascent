"use client";

// Claude Code connect state. One reveal flag covers the token field and the environment snippet.
import { useState, useSyncExternalStore } from "react";
import { buildEnvSnippet, maskIngestToken } from "./envSnippet";

export function useClaudeConnect(ingestToken: string, ingestPath: string) {
  const [token, setToken] = useState(ingestToken);
  const [rotated, setRotated] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );
  const endpoint = `${origin || "https://<your-ascent-host>"}${ingestPath}`;
  const shownToken = revealed ? token : maskIngestToken(token);
  const snippet = buildEnvSnippet(endpoint, token);
  const shownSnippet = revealed ? snippet : buildEnvSnippet(endpoint, shownToken);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`${ingestPath}/v1/metrics`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json().catch(() => ({}))) as { accepted?: boolean; error?: string; note?: string };
      if (res.status === 202 && data.accepted) {
        setResult({
          ok: true,
          text: data.note ?? "Token valid. The metrics endpoint accepted the request (202). Point Claude Code here and per-repo spend is attributed automatically.",
        });
      } else {
        setResult({ ok: false, text: data.error ?? `Unexpected response (${res.status}).` });
      }
    } catch {
      setResult({ ok: false, text: "Request failed. Is the app reachable?" });
    } finally {
      setBusy(false);
    }
  }

  function acceptRotated(next: string) {
    setToken(next);
    setRevealed(true);
    setResult(null);
    setRotated(true);
  }

  return { endpoint, shownToken, token, snippet, shownSnippet, revealed, setRevealed, busy, result, rotated, test, acceptRotated };
}
