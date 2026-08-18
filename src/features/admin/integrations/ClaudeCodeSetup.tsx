"use client";

// Claude Code connect surface — the OTel push path. There's no secret for Ascent to store: the org's
// ingest token is an HMAC of (slug, revocation epoch), verified server-side, so "connecting" is the
// customer pointing their Claude Code telemetry at our endpoint with this token. The `git.repository`
// resource attribute in the snippet is what makes the attribution MEASURED (spend lands on the exact
// repo). A live "Test" round-trips the token against the ingest endpoint so the owner sees it works now.
//
// The token lives in component state, seeded from the server-rendered value: regenerating it returns
// the new token from the API and every derived surface (masked field, env snippet, the Test call)
// re-renders from that same state — so the owner copies the WORKING configuration without a reload.
//
// One reveal state governs BOTH surfaces. The env snippet used to interpolate the raw token while the
// field above it showed bullets, which made the mask decorative: an owner screen-sharing this page
// believed the credential was hidden and it was three lines below in clear text. Rendered strings are
// masked until `revealed`; the clipboard always gets the real token (see ./envSnippet).

import { useState, useSyncExternalStore } from "react";
import { Kicker } from "@/components/ui";
import { CopyButton, Field } from "./SetupField";
import { RegenerateTokenButton } from "./RegenerateTokenButton";
import { buildEnvSnippet, maskIngestToken } from "./envSnippet";

export function ClaudeCodeSetup({ slug, ingestToken, ingestPath }: { slug: string; ingestToken: string; ingestPath: string }) {
  const [token, setToken] = useState(ingestToken);
  const [rotated, setRotated] = useState(false);
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
  const shownToken = revealed ? token : maskIngestToken(token);
  // Two snippets from one builder: `snippet` is what the clipboard gets (always usable), `shownSnippet`
  // is what enters the DOM. They are the same string once revealed.
  const snippet = buildEnvSnippet(endpoint, token);
  const shownSnippet = revealed ? snippet : buildEnvSnippet(endpoint, shownToken);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      // Round-trip the token against the exact path the OTel exporter targets (…/v1/metrics), so the
      // check reflects the real receiver — which parses OTLP metrics and attributes spend per repo.
      const res = await fetch(`${ingestPath}/v1/metrics`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      const data = (await res.json().catch(() => ({}))) as { accepted?: boolean; error?: string; note?: string };
      if (res.status === 202 && data.accepted) {
        // The probe sends no body, so there is nothing to skip — but a real push reports its
        // received/stored/skipped breakdown in the same shape, and `note` carries the human summary.
        setResult({
          ok: true,
          text:
            data.note ??
            "Token valid. The metrics endpoint accepted the request (202). Point Claude Code here and per-repo spend is attributed automatically.",
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

  return (
    <div className="space-y-3">
      <div>
        <Kicker tone="muted">Connect via OpenTelemetry</Kicker>
        <p className="mt-1 text-sm text-slate-400">
          Set these in the environment where your team runs Claude Code (shell profile, CI, or your OTel collector). The{" "}
          <code className="font-mono text-xs text-slate-300">git.repository</code> attribute is what attributes tokens to the exact repo.
          Keep <code className="font-mono text-xs text-slate-300">OTEL_EXPORTER_OTLP_PROTOCOL=http/json</code>: Ascent decodes OTLP over
          JSON only, and the exporter&apos;s default protobuf wire format is rejected (415).
        </p>
      </div>

      <Field label="Ingest endpoint" value={endpoint} />

      <Field label="Ingest token (org-scoped)" value={shownToken} copyText={token}>
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-pressed={revealed}
          // Names the blast radius: the control governs the snippet below as well as this field.
          aria-label={revealed ? "Hide ingest token and environment snippet" : "Reveal ingest token and environment snippet"}
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
          {shownSnippet}
        </pre>
        {!revealed && (
          <p className="mt-1 text-xs text-slate-500">
            The token is hidden here too. Copy still copies the working value. Use Reveal above to show it.
          </p>
        )}
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

      <div className="space-y-2 border-t border-divider pt-3">
        <p className="text-xs text-slate-500">
          Leaked the token? Regenerating issues a new one and stops the old one being accepted (for this organization only).
        </p>
        <RegenerateTokenButton
          slug={slug}
          onRotated={(next) => {
            setToken(next);
            setRevealed(true); // brand new and stored nowhere else — show it so it can be copied
            setResult(null);
            setRotated(true);
          }}
        />
        {rotated && (
          <p role="status" className="text-sm text-emerald-300">
            New token issued. The endpoint snippet above already uses it. Copy it into every exporter; the previous token is now rejected.
          </p>
        )}
      </div>
    </div>
  );
}
