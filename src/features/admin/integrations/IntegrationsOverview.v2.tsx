"use client";

// Prism overview: masthead, spend ladder, and one row per integration. A row opens that integration's level.
import Link from "next/link";
import { Caption, CellMark, Frame, HairlineList, Ladder, ListRow, Masthead, SectionHead } from "@/components/kit";
import { FIDELITY_META, type Fidelity } from "@/lib/integrations/providers";
import { orgTabHref } from "@/lib/org/orgTabs";
import {
  connectionCell,
  connectionCounts,
  connectionWord,
  fidelityCell,
  INTEGRATION_LEVELS,
  levelBlurb,
  providerByLevel,
  type IntegrationLevelId,
  type IntegrationsData,
} from "./integrationModel";
import { spendLadder } from "./integrationLadder";

const FIDELITIES: Fidelity[] = ["measured", "allocated", "seats-only"];

export function IntegrationsOverviewV2({
  data,
  onOpen,
  selectedId = null,
}: {
  data: IntegrationsData;
  onOpen: (id: IntegrationLevelId) => void;
  selectedId?: IntegrationLevelId | null;
}) {
  const counts = connectionCounts(data);
  return (
    <div data-role="integrations-v2" data-surface="overview" className="space-y-10">
      <Masthead
        eyebrow="Integrations"
        statement="Spend reaches a repository"
        named={
          <>
            <br />
            only when a provider reports it.
          </>
        }
        pattern="spectral"
        lede={
          <>
            Connect your AI coding providers so{" "}
            <Link href={orgTabHref(data.slug, "delivery")} className="text-slate-100 underline underline-offset-4">
              AI delivery
            </Link>{" "}
            has a spend layer at all. Until one that reports cost is connected, its money columns are empty rather than estimated.
          </>
        }
        figures={[
          { label: "Connected", value: String(counts.connected), tone: counts.connected > 0 ? "good" : "watch", detail: "A stored credential, or data that has landed." },
          { label: "Not configured", value: String(counts.notConfigured), tone: counts.notConfigured > 0 ? "watch" : "good", detail: "Nothing stored and nothing received." },
          { label: "Cost sources", value: String(counts.costSources), tone: counts.costSources > 0 ? "good" : "watch", detail: "Claude Code or OpenAI. Copilot reports no cost." },
        ]}
      />
      <Frame aria-label="How spend is read">
        <SectionHead
          eyebrow="Spend"
          title="How a figure is earned,"
          named="and what it can claim."
          lede="Measured, allocated, and seats-only are different facts. Seats-only is not a weaker allocated, and an unknown cost is not zero."
        />
        <div className="mt-6">
          <Ladder label="Whether spend can reach a repository" steps={spendLadder(data)} />
        </div>
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {FIDELITIES.map((fidelity) => {
            const cell = fidelityCell(fidelity);
            return (
              <li key={fidelity}>
                <CellMark state={cell.state}>{cell.word}</CellMark>
                <Caption>{FIDELITY_META[fidelity].note}</Caption>
              </li>
            );
          })}
        </ul>
      </Frame>
      <Frame aria-label="Connections">
        <SectionHead eyebrow="Connections" title="Each integration," named="opened on its own." lede="Open one to configure it. Esc or Back returns here." />
        <HairlineList className="mt-6">
          {INTEGRATION_LEVELS.map((level) => {
            const word = connectionCell(connectionWord(data, level.id));
            const provider = providerByLevel(level.id);
            const fidelity = provider ? fidelityCell(provider.fidelity) : null;
            return (
              <ListRow
                key={level.id}
                onPress={() => onOpen(level.id)}
                selected={selectedId === level.id}
                title={<span data-provider={level.id}>{level.name}</span>}
                detail={
                  <>
                    {fidelity ? <CellMark state={fidelity.state}>{fidelity.word}</CellMark> : <span className="text-slate-400">Code host</span>}
                    <span className="text-slate-500"> · </span>
                    {levelBlurb(level.id)}
                  </>
                }
                trailing={<CellMark state={word.state}>{word.word}</CellMark>}
              />
            );
          })}
        </HairlineList>
      </Frame>
    </div>
  );
}
