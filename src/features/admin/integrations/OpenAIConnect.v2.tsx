"use client";

// OpenAI admin-key pull. The key field starts empty, stays type=password, and is cleared on save.
import { GhostAction, Input, MonoPath, PrimaryAction, SettingRow } from "@/components/kit";
import type { ProviderConnectionRow } from "@/lib/db/provider-credentials";
import { PROVIDERS } from "@/lib/integrations/providers";
import { CapabilityNotes } from "./CapabilityNotes.v2";
import { ConnectNotice, StatusSentence } from "./ConnectNotice";
import type { IngestWire } from "./integrationModel";
import { lastSyncLine } from "./openaiSetupModel";
import { providerStatusLine } from "./providerStatusLine";
import { QuietField } from "./QuietField";
import { useOpenAIConnect } from "./useOpenAIConnect";

export function OpenAIConnectV2({
  slug,
  initial,
  encryptionConfigured,
  status = null,
}: {
  slug: string;
  initial: ProviderConnectionRow | null;
  encryptionConfigured: boolean;
  status?: IngestWire | null;
}) {
  const openai = useOpenAIConnect(slug, initial);
  const canStore = encryptionConfigured || openai.connected;
  const provider = PROVIDERS.find((item) => item.id === "openai")!;
  const last = lastSyncLine(openai.conn);
  const keyLabel = openai.connected ? "Replace admin key" : "Admin key";
  return (
    <div className="space-y-4" data-testid="openai-setup">
      <p className="type-body-sm text-slate-400">
        Ascent reads your organization&apos;s daily spend from the OpenAI Admin Costs API. It needs an organization Admin key (it starts <MonoPath>sk-admin-</MonoPath>); project keys cannot read costs. The key is stored encrypted, is only ever sent to OpenAI, and is never shown again.
      </p>
      <StatusSentence line={providerStatusLine(provider, status)} />
      {!canStore ? (
        <ConnectNotice ok={false} text="Secret encryption is not configured on this deployment, so no key can be stored. An operator has to set ENCRYPTION_KEY first." />
      ) : (
        <>
          <SettingRow label={keyLabel} description="Not echoed. Paste a new key to replace the stored one. The field is always empty: the saved key is never shown again." control={<span />} />
          <QuietField label={keyLabel} htmlFor="openai-admin-key">
            <Input
              id="openai-admin-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={openai.key}
              placeholder={openai.connected ? "Stored (encrypted). Paste a new key to replace it." : "sk-admin-..."}
              onChange={(event) => openai.setKey(event.target.value)}
            />
          </QuietField>
          <SettingRow label="Projects (optional)" description="Optional. Limit the pull to the projects Codex bills to. With no filter, every OpenAI API cost in the organization counts." control={<span />} />
          <QuietField label="Projects (optional)" htmlFor="openai-projects">
            <Input id="openai-projects" value={openai.projects} placeholder="proj_... , proj_..." onChange={(event) => openai.setProjects(event.target.value)} />
          </QuietField>
        </>
      )}
      <p className="type-body-sm text-slate-400">
        <span className="text-slate-100">This cost is allocated, not measured.</span> OpenAI reports spend by organization and project, not by repository, so the AI delivery views distribute the org total across repositories by git-attributed AI volume and mark those figures Allocated. With no project filter, every OpenAI API cost in the organization counts, including spend that is not coding: list the projects Codex bills to.
      </p>
      <div className="flex flex-wrap gap-2">
        {canStore && (
          <PrimaryAction onClick={() => void openai.save()} disabled={openai.busy !== null}>
            {openai.busy === "save" ? "Saving…" : openai.connected ? "Save changes" : "Save key"}
          </PrimaryAction>
        )}
        {openai.connected && (
          <>
            <PrimaryAction onClick={() => void openai.sync()} disabled={openai.busy !== null}>
              {openai.busy === "sync" ? "Syncing…" : "Sync now"}
            </PrimaryAction>
            <GhostAction onClick={() => void openai.disconnect()} disabled={openai.busy !== null}>
              {openai.busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </GhostAction>
          </>
        )}
      </div>
      {openai.result && <ConnectNotice ok={openai.result.ok} text={openai.result.text} note={openai.result.note} />}
      {last && (
        <p className="type-body-sm text-slate-100">
          {last.tone === "warn" && <span aria-hidden>! </span>}
          {last.text}
        </p>
      )}
      <p className="type-body-sm text-slate-400">
        Each sync reads the last 90 days. Re-syncing is safe: each day is OpenAI&apos;s total for that day, so an overlapping window overwrites those days rather than adding to them.
      </p>
      <CapabilityNotes items={provider.capabilities} note={provider.perRepo} />
    </div>
  );
}
