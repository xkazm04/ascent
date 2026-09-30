"use client";

// The open practice is a level: the rest of the tab unmounts, Esc and Back return, prev/next walk
// the library. Authored playbooks use the kit fields.
import { useEffect, useRef } from "react";
import { Display, EscBack, Eyebrow, Lede, LevelNav, Panel } from "@/components/kit";
import { PlaybookCardV2 } from "./PlaybookCard.v2";
import { MinedPracticeDetailV2 } from "./MinedPracticeDetail.v2";
import { categoryLabel, type PracticeRow } from "./practiceRows";
import type { OrgPractice } from "@/lib/db";

export function PracticeDetailV2({
  row,
  rows,
  slug,
  dimLabels,
  repoOptions,
  onOpen,
  onClose,
  onRemoveAuthored,
  onPromoteMined,
}: {
  row: PracticeRow;
  rows: readonly PracticeRow[];
  slug: string;
  dimLabels: Map<string, string>;
  repoOptions: string[];
  onOpen: (row: PracticeRow) => void;
  onClose: () => void;
  onRemoveAuthored: (id: string) => void;
  onPromoteMined: (p: OrgPractice) => void;
}) {
  const index = rows.findIndex((r) => r.key === row.key);
  const prev = index > 0 ? rows[index - 1] : undefined;
  const next = index >= 0 && index < rows.length - 1 ? rows[index + 1] : undefined;
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [row.key]);

  return (
    <div data-role="practice-level" className="space-y-6">
      <EscBack onBack={onClose} />
      <LevelNav
        trail={[{ label: "Practices" }, { label: row.label }]}
        back={{ label: "Library", onClick: onClose }}
        prev={prev ? { label: prev.label, onClick: () => onOpen(prev) } : undefined}
        next={next ? { label: next.label, onClick: () => onOpen(next) } : undefined}
      />
      <header>
        <Eyebrow>{row.source === "authored" ? "Authored playbook" : "Mined practice"}</Eyebrow>
        <div id="practice-level-title" ref={heading} tabIndex={-1} className="mt-3 scroll-mt-24 outline-none">
          <Display as="h2" level="section" named={row.label}>
            {categoryLabel(row.dimId)}
          </Display>
        </div>
        <Lede className="mt-3">{row.what}</Lede>
      </header>
      {row.source === "mined" && row.mined ? (
        <MinedPracticeDetailV2 p={row.mined} onPromote={() => onPromoteMined(row.mined!)} />
      ) : row.authored ? (
        <Panel aria-label={row.label}>
          <PlaybookCardV2
            playbook={row.authored.playbook}
            slug={slug}
            dimLabel={dimLabels.get(row.dimId) ?? row.dimId}
            adoption={row.authored.adoption}
            repoOptions={repoOptions}
            onRemove={() => onRemoveAuthored(row.id)}
          />
        </Panel>
      ) : null}
    </div>
  );
}
