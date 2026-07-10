"use client";

// The shared "practice detail" dialog — layer 2 of the redesign, opened from a table row in either
// variant. ONE brand Modal renders either a MINED practice's detail (exemplar / gaps / reusable shape /
// apply-to-repo) or an AUTHORED playbook's full interactive card (copy-for-LLM, adoption marking,
// open-PR, track-as-initiative), chosen by the row's source.

import { Modal, ModalHeader, ModalBody } from "@/components/ui";
import { PlaybookCard } from "@/components/org/practices/PlaybookCard";
import { MinedPracticeDetail } from "./MinedPracticeDetail";
import { categoryLabel, type PracticeRow } from "./practiceRows";

export function PracticeDetailModal({
  row,
  slug,
  dimLabels,
  repoOptions,
  onClose,
  onRemoveAuthored,
}: {
  row: PracticeRow | null;
  slug: string;
  dimLabels: Map<string, string>;
  repoOptions: string[];
  onClose: () => void;
  onRemoveAuthored: (id: string) => void;
}) {
  return (
    <Modal open={row != null} onClose={onClose} size="xl" ariaLabel={row ? row.label : "Practice detail"}>
      {row && (
        <>
          <ModalHeader
            kicker={`${row.source === "authored" ? "Authored playbook" : "Mined practice"} · ${categoryLabel(row.dimId)}`}
            title={row.label}
            context={row.what}
          />
          <ModalBody>
            {row.source === "mined" && row.mined ? (
              <MinedPracticeDetail p={row.mined} />
            ) : row.authored ? (
              <PlaybookCard
                playbook={row.authored.playbook}
                slug={slug}
                dimLabel={dimLabels.get(row.dimId) ?? row.dimId}
                adoption={row.authored.adoption}
                repoOptions={repoOptions}
                onRemove={() => onRemoveAuthored(row.id)}
              />
            ) : null}
          </ModalBody>
        </>
      )}
    </Modal>
  );
}
