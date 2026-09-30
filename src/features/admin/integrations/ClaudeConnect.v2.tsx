"use client";

// Claude Code OTel setup. The token and the environment snippet share one mask until Reveal.
import { Caption, GhostAction, Input, MonoPath, PrimaryAction, SettingRow, Textarea } from "@/components/kit";
import { PROVIDERS } from "@/lib/integrations/providers";
import { CapabilityNotes } from "./CapabilityNotes.v2";
import { ConnectNotice, StatusSentence } from "./ConnectNotice";
import { CopyControl } from "./CopyControl";
import type { IngestWire } from "./integrationModel";
import { providerStatusLine } from "./providerStatusLine";
import { QuietField } from "./QuietField";
import { RegenerateTokenV2 } from "./RegenerateToken.v2";
import { useClaudeConnect } from "./useClaudeConnect";

export function ClaudeConnectV2({
  slug,
  ingestToken,
  ingestPath,
  status = null,
}: {
  slug: string;
  ingestToken: string;
  ingestPath: string;
  status?: IngestWire | null;
}) {
  if (!ingestToken) return <IngestMissing />;
  return <ClaudeConfigured slug={slug} ingestToken={ingestToken} ingestPath={ingestPath} status={status} />;
}

function IngestMissing() {
  return (
    <ConnectNotice
      ok={false}
      text="Ingest is not configured on this deployment."
      note="Set INTEGRATIONS_INGEST_SECRET on the server and restart. Until then no ingest token can be issued or verified, and pushes to this endpoint are refused."
    />
  );
}

function ClaudeConfigured({
  slug,
  ingestToken,
  ingestPath,
  status,
}: {
  slug: string;
  ingestToken: string;
  ingestPath: string;
  status: IngestWire | null;
}) {
  const claude = useClaudeConnect(ingestToken, ingestPath);
  const provider = PROVIDERS.find((item) => item.id === "claude-code")!;
  const line = providerStatusLine(provider, status);
  const revealLabel = claude.revealed ? "Hide ingest token and environment snippet" : "Reveal ingest token and environment snippet";
  return (
    <div className="space-y-4">
      <p className="type-body-sm text-slate-400">
        Set these in the environment where your team runs Claude Code (shell profile, CI, or your OTel collector). The{" "}
        <MonoPath>git.repository</MonoPath> attribute is what attributes tokens to the exact repo. Keep{" "}
        <MonoPath>OTEL_EXPORTER_OTLP_PROTOCOL=http/json</MonoPath>: Ascent decodes OTLP over JSON only, and the exporter&apos;s default protobuf wire format is rejected (415).
      </p>
      <StatusSentence line={line} />
      <SettingRow label="Ingest endpoint" description="Read only. The metrics URL Claude Code posts to." control={<span />} />
      <QuietField label="Ingest endpoint" htmlFor="claude-endpoint">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Input id="claude-endpoint" readOnly value={claude.endpoint} />
          </span>
          <CopyControl text={claude.endpoint} />
        </span>
      </QuietField>
      <SettingRow label="Ingest token (org-scoped)" description="Masked until you reveal it. Copy still copies the working token." control={<span />} />
      <QuietField label="Ingest token (org-scoped)" htmlFor="claude-token">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Input id="claude-token" readOnly spellCheck={false} autoComplete="off" value={claude.shownToken} />
          </span>
          <GhostAction onClick={() => claude.setRevealed((value) => !value)} aria-label={revealLabel}>
            {claude.revealed ? "Hide" : "Reveal"}
          </GhostAction>
          <CopyControl text={claude.token} />
        </span>
      </QuietField>
      <SettingRow label="Environment" description="Masked with the token. Copy puts the working token on the clipboard." control={<span />} />
      <QuietField label="Environment" htmlFor="claude-env" hint={claude.revealed ? undefined : "The token is hidden here too. Copy still copies the working value."}>
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1">
            <Textarea id="claude-env" readOnly rows={7} spellCheck={false} value={claude.shownSnippet} className="font-mono" />
          </span>
          <CopyControl text={claude.snippet} />
        </span>
      </QuietField>
      <PrimaryAction onClick={() => void claude.test()} disabled={claude.busy}>
        {claude.busy ? "Testing…" : "Test ingest token"}
      </PrimaryAction>
      {claude.result && <ConnectNotice ok={claude.result.ok} text={claude.result.text} />}
      <Caption>Leaked the token? Regenerating issues a new one and stops the old one being accepted (for this organization only).</Caption>
      <RegenerateTokenV2 slug={slug} onRotated={claude.acceptRotated} />
      {claude.rotated && (
        <ConnectNotice ok text="New token issued. The endpoint snippet above already uses it. Copy it into every exporter; the previous token is now rejected." />
      )}
      <CapabilityNotes items={provider.capabilities} note={provider.perRepo} />
    </div>
  );
}
