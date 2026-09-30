"use client";

// Press a row to open that memory as a level. The list and the level are the same rows: previous
// and next walk the filtered list, and a hash that no longer matches it says so.
import { HairlineList, ListRow } from "@/components/kit";
import { memoryKindLabel } from "@/lib/org/memory-kinds";
import type { MemoryRow } from "@/lib/db";
import { MemorySceneV2 } from "./MemoryScene.v2";
import { excerpt, trustWord } from "./memoryView";

export function MemoryRowsV2({
  memories,
  sceneId,
  onOpen,
  viewerLogin,
  isAdmin,
  onArchive,
  canWrite,
  onCorrect,
  registryBase,
}: {
  memories: MemoryRow[];
  sceneId: string | null;
  onOpen: (id: string | null) => void;
  viewerLogin: string | null;
  isAdmin: boolean;
  onArchive: (id: string) => void;
  canWrite: boolean;
  onCorrect: (row: MemoryRow) => void;
  registryBase: string | null;
}) {
  if (sceneId) {
    const idx = memories.findIndex((m) => m.id === sceneId);
    const memory = idx >= 0 ? memories[idx]! : null;
    const prev = idx > 0 ? memories[idx - 1] : undefined;
    const next = idx >= 0 && idx < memories.length - 1 ? memories[idx + 1] : undefined;
    return (
      <MemorySceneV2
        memory={memory}
        onBack={() => onOpen(null)}
        onPrev={prev ? () => onOpen(prev.id) : undefined}
        onNext={next ? () => onOpen(next.id) : undefined}
        prevLabel={prev ? excerpt(prev.content, 24) : undefined}
        nextLabel={next ? excerpt(next.content, 24) : undefined}
        viewerLogin={viewerLogin}
        canArchive={isAdmin}
        onArchive={() => memory && onArchive(memory.id)}
        canWrite={canWrite}
        onCorrect={onCorrect}
        registryBase={registryBase}
      />
    );
  }

  return (
    <HairlineList>
      {memories.map((m) => (
        <ListRow
          key={m.id}
          onPress={() => onOpen(m.id)}
          title={excerpt(m.content, 140)}
          detail={`${memoryKindLabel(m.kind)}, ${m.namespace || "org-wide"}, ${trustWord(m.confidence)}, ${m.accessCount} recall${m.accessCount === 1 ? "" : "s"}`}
          trailing={<span className="type-body-sm tabular-nums text-slate-400">{m.accessCount}</span>}
        />
      ))}
    </HairlineList>
  );
}
