"use client";

// Claude Code connect surface — the OTel push path. There's no secret for Ascent to store: the org's
// ingest token is stateless (HMAC of the slug, verified server-side), so "connecting" is the customer
// pointing their Claude Code telemetry at our endpoint with this token. The `git.repository` resource
// attribute in the snippet is what makes the attribution MEASURED (spend lands on the exact repo).
// A live "Test" round-trips the token against the ingest endpoint so the owner sees it works now.

import { useState, useSyncExternalStore } from "react";
import { Kicker } from "@/components/ui";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="focus-ring shrink-0 rounded border border-divider px-2 py-1 font-mono text-xs text-slate-400 transition hover:border-accent hover:text-white"
    >
      {/* aria-live so the Copy→Copied transition is announced to screen-reader users. */}
      <span aria-live="polite">{done ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Field({ label, value, mono = true, children }: { label: string; value: string; mono?: boolean; children?: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-divider bg-surface-strong/60 px-2.5 py-1.5">
        <code className={`flex-1 truncate text-slate-200 ${mono ? "font-mono text-xs" : "text-sm"}`}>{value}</code>
        {children}
        <CopyButton text={value} />
      </div>
    </div>
  );
}

export function ClaudeCodeSetup({ ingestToken, ingestPath }: { ingestToken: string; ingestPath: string }) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // Read the public origin without a setState-in-effect (and hydration-safe): "" on the server, the
  // real origin on the client, so the endpoint/snippet show the customer's actual host.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const endpoint = `${origin || "https://<your-ascent-host>"}${ingestPath}`;
  const maskedToken = revealed
    ? ingestToken
    : ingestToken.replace(/^(asc_otel\.[^.]+\.)(.+)$/, (_, p: string, mac: string) => p + "•".repeat(Math.min(mac.length, 24)));

  const snippet = [
    "export CLAUDE_CODE_ENABLE_TELEMETRY=1",
    "export OTEL_METRICS_EXPORTER=otlp",
    "export OTEL_LOGS_EXPORTER=otlp",
    "export OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    `export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
    `export OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ${ingestToken}`,
    "export OTEL_RESOURCE_ATTRIBUTES=git.repository=$(git remote get-url origin)",
  ].join("\n");

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      // Round-trip the token against the exact path the OTel exporter targets (…/v1/metrics), so the
      // check reflects the real receiver — which parses OTLP metrics and attributes spend per repo.
      const res = await fetch(`${ingestPath}/v1/metrics`, { method: "POST", headers: { Authorization: `Bearer ${ingestToken}` } });
      const data = (await res.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
      if (res.status === 202 && data.accepted) {
        setResult({ ok: true, text: "Token valid — the metrics endpoint accepted the request (202). Point Claude Code here and per-repo spend is attributed automatically." });
      } else {
        setResult({ ok: false, text: data.error ?? `Unexpected response (${res.status}).` });
      }
    } catch {
      setResult({ ok: false, text: "Request failed — is the app reachable?" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <Kicker tone="muted">Connect via OpenTelemetry</Kicker>
        <p className="mt-1 text-sm text-slate-400">
          Set these in the environment where your team runs Claude Code (shell profile, CI, or your OTel collector). The{" "}
          <code className="font-mono text-xs text-slate-300">git.repository</code> attribute is what attributes tokens to the exact repo.
          Keep <code className="font-mono text-xs text-slate-300">OTEL_EXPORTER_OTLP_PROTOCOL=http/json</code> — Ascent decodes OTLP over
          JSON only, and the exporter&apos;s default protobuf wire format is rejected (415).
        </p>
      </div>

      <Field label="Ingest endpoint" value={endpoint} />

      <Field label="Ingest token (org-scoped)" value={maskedToken}>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          className="focus-ring shrink-0 rounded border border-divider px-2 py-1 font-mono text-xs text-slate-400 transition hover:border-accent hover:text-white"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
      </Field>

      <div>
        <div className="flex items-center justify-between">
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">Environment</div>
          <CopyButton text={snippet} />
        </div>
        <pre className="mt-1 overflow-x-auto rounded-lg border border-divider bg-surface-strong/60 p-3 font-mono text-xs leading-relaxed text-slate-300">
          {snippet}
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={test}
          disabled={busy}
          className="focus-ring rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Testing…" : "Test ingest token"}
        </button>
        {result && (
          <p role="status" className={`text-sm ${result.ok ? "text-emerald-300" : "text-orange-300"}`}>
            {result.text}
          </p>
        )}
      </div>
    </div>
  );
}
