"use client";

// GitLab connection. The access token is password-only and starts empty; a save clears it.
import { CellMark, GhostAction, Input, PrimaryAction, Select, SettingRow } from "@/components/kit";
import type { ForgeInstallationRow } from "@/lib/db/forge-installations";
import { ConnectNotice } from "./ConnectNotice";
import { ForgeCapabilitiesV2 } from "./ForgeCapabilities.v2";
import { QuietField } from "./QuietField";
import { useForgeConnect } from "./useForgeConnect";

export function ForgeConnectV2({
  slug,
  initial,
  encryptionConfigured,
}: {
  slug: string;
  initial: ForgeInstallationRow[];
  encryptionConfigured: boolean;
}) {
  const forge = useForgeConnect(slug, initial);
  return (
    <div className="space-y-4">
      {!encryptionConfigured && (
        <ConnectNotice
          ok={false}
          text="This deployment cannot encrypt secrets (no ENCRYPTION_KEY), so a token will not be stored. Set the key first: nothing here writes a credential in the clear."
        />
      )}
      {forge.rows.map((row) => (
        <SettingRow
          key={row.id}
          label={row.externalId}
          description={row.host ?? "gitlab.com"}
          status={<CellMark state={row.hasCredential ? "met" : "unmeasured"}>{row.hasCredential ? "connected" : "not configured"}</CellMark>}
          control={
            <GhostAction onClick={() => void forge.disconnect(row)} disabled={forge.busy}>
              Disconnect
            </GhostAction>
          }
        />
      ))}
      <SettingRow label="Forge" description={forge.rows.length ? "Saved accounts are listed above. GitLab is the only forge this form connects." : "New connection. GitLab is the only forge this form connects."} control={<span />} />
      <QuietField label="Forge" htmlFor="gitlab-forge">
        <Select id="gitlab-forge" aria-label="Forge" value="gitlab" disabled onChange={() => {}}>
          <option value="gitlab">GitLab</option>
        </Select>
      </QuietField>
      <SettingRow label="Group path or project id" description="Required. The account the token can read." control={<span />} />
      <QuietField label="Group path or project id" htmlFor="gitlab-account">
        <Input id="gitlab-account" aria-label="Group path or project id" value={forge.externalId} placeholder="group path or project id" onChange={(e) => forge.setExternalId(e.target.value)} />
      </QuietField>
      <SettingRow label="Self-managed host" description="Optional. Leave blank for gitlab.com. Set it for a self-managed instance." control={<span />} />
      <QuietField label="Self-managed host" htmlFor="gitlab-host">
        <Input id="gitlab-host" aria-label="Self-managed host" value={forge.host} placeholder="https://gitlab.example.com (optional)" onChange={(e) => forge.setHost(e.target.value)} />
      </QuietField>
      <SettingRow label="Access token" description="Not echoed. A group or personal access token with read_api. The field starts empty, is cleared once stored, and is never shown again." control={<span />} />
      <QuietField label="Access token" htmlFor="gitlab-token">
        <Input id="gitlab-token" aria-label="Access token" type="password" autoComplete="off" value={forge.credential} placeholder="access token" onChange={(e) => forge.setCredential(e.target.value)} />
      </QuietField>
      <PrimaryAction onClick={() => void forge.save()} disabled={forge.busy || !forge.externalId.trim()}>
        {forge.rows.length ? "Save / rotate" : "Connect"}
      </PrimaryAction>
      {forge.error && <ConnectNotice ok={false} text={forge.error} />}
      <ForgeCapabilitiesV2 />
    </div>
  );
}
