"use client";

// One memory, as a level: back, previous, next, Esc. Copy still counts a recall. Correct still
// fills the author form. Archive still deletes. A registry row opens in the registry instead.
import { Caption, Chip, ChipRow, EscBack, GhostAction, KeyValue, Ladder, LevelNav, Panel } from "@/components/kit";
import { CopyForLlm } from "@/components/CopyForLlm";
import { OpenInRegistry, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import { canCorrectMemory } from "./memoryCorrectionModel";
import { MemoryLineageV2 } from "./MemoryLineage.v2";
import { isRepoMemorySource, isScanPipelineSource, memoryKindLabel } from "@/lib/org/memory-kinds";
import type { MemoryRow } from "@/lib/db";
import { excerpt, memoryByline, trustLadder, trustWord } from "./memoryView";

function focusNode(node: HTMLDivElement | null) {
  node?.focus();
}

export function MemorySceneV2({
  memory,
  onBack,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  viewerLogin,
  canArchive,
  onArchive,
  canWrite,
  onCorrect,
  registryBase,
}: {
  memory: MemoryRow | null;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  viewerLogin: string | null;
  canArchive: boolean;
  onArchive: () => void;
  canWrite: boolean;
  onCorrect: (row: MemoryRow) => void;
  registryBase: string | null;
}) {
  return (
    <div data-role="memory-scene">
      <EscBack onBack={onBack} />
      <LevelNav
        trail={[{ label: "Memory" }, { label: memory ? excerpt(memory.content, 48) : "Not in this list" }]}
        back={{ label: "All memories", onClick: onBack }}
        prev={onPrev && prevLabel ? { label: prevLabel, onClick: onPrev } : undefined}
        next={onNext && nextLabel ? { label: nextLabel, onClick: onNext } : undefined}
      />
      {!memory ? (
        <div className="mt-4">
          <p className="type-body text-slate-400">This memory is not in the current list. It may be filtered out or archived.</p>
        </div>
      ) : (
        <SceneBody
          memory={memory}
          viewerLogin={viewerLogin}
          canArchive={canArchive}
          onArchive={onArchive}
          canWrite={canWrite}
          onCorrect={onCorrect}
          registryBase={registryBase}
        />
      )}
    </div>
  );
}

function SceneBody({
  memory: m,
  viewerLogin,
  canArchive,
  onArchive,
  canWrite,
  onCorrect,
  registryBase,
}: {
  memory: MemoryRow;
  viewerLogin: string | null;
  canArchive: boolean;
  onArchive: () => void;
  canWrite: boolean;
  onCorrect: (row: MemoryRow) => void;
  registryBase: string | null;
}) {
  const mine = Boolean(viewerLogin && m.createdBy === viewerLogin);
  const fromScan = isScanPipelineSource(m.source);
  const fromRepo = isRepoMemorySource(m.source);
  function countRecall() {
    fetch(`/api/org/memory/${m.id}/recall`, { method: "POST" }).catch(() => {});
  }

  return (
    <div key={m.id} ref={focusNode} tabIndex={-1} className="mt-4 outline-none">
      <Panel aria-label="Memory">
        <ChipRow>
          <Chip tone="neutral">{memoryKindLabel(m.kind)}</Chip>
          {m.namespace && <Chip tone="neutral">{m.namespace}</Chip>}
          <Chip tone="neutral">{trustWord(m.confidence)}</Chip>
          {m.visibility === "private" && <Chip tone="neutral" title={mine ? "Only you can see this memory." : "Private to its author."}>private</Chip>}
          {fromScan && <Chip tone="neutral" title="Recorded automatically by the scan pipeline: an observed fact, not a human claim.">auto, scan</Chip>}
          {fromRepo && (
            <Chip tone="neutral" title="Mirrored from this repository's own .ai/memory. A claim from the repo, recorded at medium trust.">
              auto, repo
            </Chip>
          )}
          {registryBase && <Chip tone="neutral">{m.origin === "registry" ? "registry" : "hosted"}</Chip>}
          {m.version > 1 && <Chip tone="neutral">v{m.version}</Chip>}
        </ChipRow>
        <div className="mt-4">
          <Ladder label="Trust band" steps={trustLadder(m.confidence)} />
        </div>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap border-t border-divider pt-3 type-body-sm text-slate-200">{m.content}</pre>
        {m.tags.length > 0 && (
          <ChipRow className="mt-3">
            {m.tags.map((t) => (
              <Chip key={t} tone="neutral">#{t}</Chip>
            ))}
          </ChipRow>
        )}
        <KeyValue
          className="mt-3"
          items={[
            { key: "By", value: `${memoryByline(m)}${mine ? " (you)" : ""}` },
            ...(m.source ? [{ key: "From", value: m.source }] : []),
            { key: "Recalls", value: String(m.accessCount) },
            { key: "Updated", value: m.updatedAt.slice(0, 10) },
            ...(m.expiresAt ? [{ key: "Expires", value: m.expiresAt.slice(0, 10) }] : []),
          ]}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CopyForLlm text={m.content} label="Copy" ariaLabel="Copy this memory for an LLM" onCopied={countRecall} />
          {canCorrectMemory(m, canWrite) && (
            <GhostAction onClick={() => onCorrect(m)}>Correct</GhostAction>
          )}
          {m.origin === "registry" ? (
            <OpenInRegistry href={registryBlobHref(registryBase, m.registryPath)} />
          ) : (
            canArchive && <GhostAction onClick={onArchive}>Archive</GhostAction>
          )}
        </div>
        {m.version > 1 && <MemoryLineageV2 id={m.id} />}
        <Caption className="mt-3">Trust score {m.confidence.toFixed(2)}. It drives ranking and pruning.</Caption>
      </Panel>
    </div>
  );
}
