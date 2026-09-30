"use client";

// Mint, list and revoke org API tokens. Same requests as the Altimeter panel. The secret is shown once.
import { useState } from "react";
import { Caption, Chip, ChipRow, FormField, Frame, GhostAction, HairlineList, Input, Panel, PrimaryAction, SectionHead } from "@/components/kit";
import type { ApiTokenSummary, SkillTokenScope } from "@/lib/db";
import { DEFAULT_PICKED_SCOPES } from "./apiTokenDefaults";

const SCOPE_LABEL: Record<SkillTokenScope, string> = {
  "skills:read": "Read / download hosted skills (a registry-linked org needs no token for this)",
  "skills:write": "Push / update a hosted skill from a CLI",
  "telemetry:write": "Report per-repo usage (sink A); registry counters need no token",
  "memory:read": "Recall org memory",
  "mcp:read": "Agent door (MCP): read org standing",
  "followups:write": "Agent door (MCP): claim follow-ups and report attempts",
};

function scopeId(scope: string): string {
  return `skill-token-scope-${scope.replaceAll(":", "-")}`;
}

export function ApiTokensPanelV2({
  slug,
  initial,
  scopes,
}: {
  slug: string;
  initial: ApiTokenSummary[];
  scopes: readonly SkillTokenScope[];
}) {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>(initial);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<SkillTokenScope>>(new Set<SkillTokenScope>(DEFAULT_PICKED_SCOPES));
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(scope: SkillTokenScope) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  async function create() {
    if (!name.trim() || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, name: name.trim(), scopes: [...picked] }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to create token.");
      setRevealed(json.token);
      setTokens((t) => [json.summary, ...t]);
      setName("");
      setPicked(new Set<SkillTokenScope>(DEFAULT_PICKED_SCOPES));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const prev = tokens;
    setError(null);
    setTokens((t) => t.filter((x) => x.id !== id));
    const res = await fetch(`/api/org/tokens/${id}?org=${encodeURIComponent(slug)}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      setTokens(prev);
      setError((await res?.json().catch(() => ({})))?.error ?? "Couldn't revoke the token.");
    }
  }

  return (
    <Frame aria-label="API tokens" className="mt-2">
      <SectionHead
        eyebrow="Machine access"
        title="API"
        named="tokens"
        lede="For machine callers that need this org itself: the MCP agent door, memory recall, per-repo telemetry. Skills and their use counters travel through the registry checkout and need no token. A token is shown once; store it as ASCENT_TOKEN."
      />
      {revealed && (
        <Panel aria-label="New token" className="mt-4" pad="sm">
          <p className="type-body-sm text-slate-100">Copy this token now. It will not be shown again.</p>
          <p className="mt-2 overflow-x-auto font-mono type-caption text-slate-100">{revealed}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <GhostAction onClick={() => navigator.clipboard?.writeText(revealed)}>Copy</GhostAction>
            <GhostAction onClick={() => setRevealed(null)}>Done</GhostAction>
          </div>
        </Panel>
      )}
      <div className="mt-4">
        {tokens.length === 0 ? (
          <p className="type-body-sm text-slate-400">
            No tokens. None is needed for skills or their counters; mint one only for the MCP door, memory recall or per-repo telemetry.
          </p>
        ) : (
          <HairlineList>
            {tokens.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-white">{t.name}</p>
                  <Caption>
                    {t.tokenPrefix}… {t.lastUsedAt ? `Used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "Never used"}
                  </Caption>
                  <ChipRow className="mt-1">
                    {t.scopes.map((scope) => (
                      <Chip key={scope} tone="neutral">
                        {scope}
                      </Chip>
                    ))}
                  </ChipRow>
                </div>
                <GhostAction onClick={() => revoke(t.id)}>Revoke</GhostAction>
              </li>
            ))}
          </HairlineList>
        )}
      </div>
      <div className="mt-6 border-t border-divider pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Token name" htmlFor="skill-token-name" className="min-w-[16rem] flex-1" hint="Shown in the list. The secret is shown once.">
            <Input
              id="skill-token-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Token name (e.g. CI, laptop)"
            />
          </FormField>
          <PrimaryAction onClick={create} disabled={busy || !name.trim() || picked.size === 0}>
            {busy ? "Creating…" : "Create token"}
          </PrimaryAction>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {scopes.map((scope) => (
            <FormField key={scope} label={SCOPE_LABEL[scope] ?? scope} htmlFor={scopeId(scope)}>
              <Input
                id={scopeId(scope)}
                type="checkbox"
                checked={picked.has(scope)}
                onChange={() => toggle(scope)}
              />
            </FormField>
          ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {error}
        </p>
      )}
    </Frame>
  );
}
