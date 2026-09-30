"use client";

// One integration, full page: Back, Esc, prev/next, then its Frame. The list is not underneath it.
import { useEffect, useRef } from "react";
import { Caption, EscBack, Frame, Ladder, LevelNav, SectionHead } from "@/components/kit";
import { ClaudeConnectV2 } from "./ClaudeConnect.v2";
import { CopilotConnectV2 } from "./CopilotConnect.v2";
import { ForgeConnectV2 } from "./ForgeConnect.v2";
import { connectionLadder } from "./integrationLadder";
import { connectionWord, INTEGRATION_LEVELS, levelBlurb, statusFor, type IntegrationLevelId, type IntegrationsData } from "./integrationModel";
import { OpenAIConnectV2 } from "./OpenAIConnect.v2";

export function IntegrationLevelV2({
  data,
  id,
  onOpen,
  onClose,
}: {
  data: IntegrationsData;
  id: IntegrationLevelId;
  onOpen: (id: IntegrationLevelId) => void;
  onClose: () => void;
}) {
  const index = INTEGRATION_LEVELS.findIndex((level) => level.id === id);
  const level = INTEGRATION_LEVELS[index]!;
  const prev = INTEGRATION_LEVELS[index - 1];
  const next = INTEGRATION_LEVELS[index + 1];
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [id]);
  const word = connectionWord(data, id);

  return (
    <div data-role="integrations-v2" data-surface="level" className="space-y-6">
      <EscBack onBack={onClose} />
      <LevelNav
        trail={[{ label: "Integrations" }, { label: level.name }]}
        back={{ label: "Integrations", onClick: onClose }}
        prev={prev ? { label: prev.name, onClick: () => onOpen(prev.id) } : undefined}
        next={next ? { label: next.name, onClick: () => onOpen(next.id) } : undefined}
      />
      <Frame aria-label={level.name}>
        <div id="integration-level-title" ref={heading} tabIndex={-1} className="outline-none">
          <SectionHead eyebrow="Integration" title={level.name} named={word === "connected" ? "connected." : "not configured."} lede={levelBlurb(id)} />
        </div>
        <div className="mt-6">
          <Ladder label={`${level.name} connection`} steps={connectionLadder(data, id)} />
        </div>
        <div className="mt-6">
          {id === "gitlab" && <ForgeConnectV2 slug={data.slug} initial={data.forgeInstallations} encryptionConfigured={data.encryptionConfigured} />}
          {id === "claude-code" && <ClaudeConnectV2 slug={data.slug} ingestToken={data.ingestToken} ingestPath={data.ingestPath} status={statusFor(data, "claude-code")} />}
          {id === "copilot" && <CopilotConnectV2 slug={data.slug} status={statusFor(data, "copilot")} />}
          {id === "openai" && (
            <OpenAIConnectV2 slug={data.slug} initial={data.openai.connection} encryptionConfigured={data.openai.encryptionConfigured} status={statusFor(data, "openai")} />
          )}
        </div>
      </Frame>
      <Caption>Esc returns to the list.</Caption>
    </div>
  );
}
