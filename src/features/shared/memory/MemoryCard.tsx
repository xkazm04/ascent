"use client";

// One Org Memory: the body, its provenance (who/where it came from), its trust score, and the
// admin-only Archive. "Copy" counts as a recall (§3 access_count) — the signal a future consolidation
// job prunes on. The body is rendered as plain preformatted text (never dangerouslySetInnerHTML), so a
// member-authored memory can't inject markup. Mirrors SkillCard.

import { OpenInRegistry, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import { CopyForLlm } from "@/components/CopyForLlm";
import { confidenceLabel, isScanPipelineSource, memoryKindLabel } from "@/lib/org/memory-kinds";
import type { MemoryRow } from "@/lib/db";

const CONFIDENCE_TONE: Record<string, string> = {
  high: "border-emerald-500/40 text-emerald-300",
  medium: "border-amber-500/40 text-amber-300",
  low: "border-orange-500/40 text-orange-300",
};

export function MemoryCard({
  memory: m,
  viewerLogin,
  canArchive,
  onArchive,
  registryBase,
}: {
  memory: MemoryRow;
  viewerLogin: string | null;
  canArchive: boolean;
  onArchive: () => void;
  /** Blob-URL prefix of the mapped registry, or null. See MemoryPanel's prop doc. */
  registryBase: string | null;
}) {
  const band = confidenceLabel(m.confidence);
  const mine = Boolean(viewerLogin && m.createdBy === viewerLogin);
  // Machine-observed vs. human-claimed is the first thing a reader needs from provenance — an
  // auto-fed row has no author, so "by unknown" alone would read as a gap rather than a robot.
  const autoFed = isScanPipelineSource(m.source);

  // Count a "Copy for LLM" as a recall (best-effort, fire-and-forget — never block the copy).
  function countRecall() {
    fetch(`/api/org/memory/${m.id}/recall`, { method: "POST" }).catch(() => {});
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
            {memoryKindLabel(m.kind)}
          </span>
          {m.namespace && (
            <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-400">
              {m.namespace}
            </span>
          )}
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-xs ${CONFIDENCE_TONE[band] ?? "border-slate-700 text-slate-400"}`}
            title={`Trust score ${m.confidence.toFixed(2)}: drives ranking and pruning`}
          >
            {band} trust
          </span>
          {m.visibility === "private" && (
            <span
              className="rounded border border-slate-600 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-400"
              title={mine ? "Only you can see this memory." : "Private to its author."}
            >
              private
            </span>
          )}
          {autoFed && (
            <span
              className="rounded border border-sky-500/40 px-1.5 py-0.5 font-mono text-xs text-sky-300"
              title="Recorded automatically by the scan pipeline: an observed fact, not a human claim."
            >
              auto · scan
            </span>
          )}
          {m.version > 1 && (
            <span className="font-mono text-xs text-slate-500" title="This memory superseded an earlier one">
              v{m.version}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CopyForLlm
            text={m.content}
            label="Copy"
            ariaLabel="Copy this memory for an LLM"
            onCopied={countRecall}
          />
          {/* A registry-origin note mirrors a file in a repo the customer owns: archiving it here would
              be undone by the next index pass, so the affordance is the file itself. */}
          {m.origin === "registry" ? (
            <OpenInRegistry href={registryBlobHref(registryBase, m.registryPath)} />
          ) : (
            canArchive && (
              <button
                onClick={onArchive}
                className="font-mono text-sm text-slate-600 hover:text-orange-300"
                title="Archive this memory (admins only)"
              >
                archive
              </button>
            )
          )}
        </div>
      </div>

      <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs whitespace-pre-wrap text-slate-300">
        {m.content}
      </pre>

      {m.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {m.tags.map((t) => (
            <span
              key={t}
              className="rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 font-mono text-xs text-slate-400"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-800 pt-3 font-mono text-sm text-slate-500">
        {/* Provenance — the design doc's answer to memory poisoning: always show who/what wrote this. */}
        <span title="Who recorded this memory">
          by <span className="text-slate-300">{m.createdBy ?? (autoFed ? "the scan pipeline" : "unknown")}</span>
          {mine && <span className="ml-1 text-slate-600">(you)</span>}
        </span>
        {m.source && (
          <span title="Where this memory came from">
            from <span className="text-slate-300">{m.source}</span>
          </span>
        )}
        <span title="Times this memory was copied/recalled">
          {m.accessCount} recall{m.accessCount === 1 ? "" : "s"}
        </span>
        <span title={`Last updated ${m.updatedAt}`}>{m.updatedAt.slice(0, 10)}</span>
        {m.expiresAt && (
          <span className="text-amber-300/80" title="This memory expires (TTL)">
            expires {m.expiresAt.slice(0, 10)}
          </span>
        )}
      </div>
    </div>
  );
}
