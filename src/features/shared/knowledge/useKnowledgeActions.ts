"use client";

// The one client-side call path for the Knowledge base tab's three mutations — sweep the fleet,
// compose a brief, run a dispatch locally. Same three rules as the Registry tab's mutation hook: a
// call in flight disables its own control and names itself in `pending`; a failure is stated INLINE
// as a sentence; a success calls `router.refresh()` so the server view re-reads. In preview (the
// dev-only shaped fleet) every call is inert and says so — the shaped fleet must never reach GitHub.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { RegistryDispatchStage } from "@/lib/org/knowledge-shape";

export interface KnowledgeActionState {
  /** The action in flight: `sweep` | `brief` | `local` | null. */
  pending: string | null;
  error: string | null;
  notice: string | null;
  /** The brief the server composed for the current selection, ready to copy. */
  brief: string | null;
}

const errorSentence = (data: Record<string, unknown>, status: number): string => {
  const text = [data.message, data.error].find((v): v is string => typeof v === "string" && v.length > 0);
  const msg = text ?? `The request failed (HTTP ${status}).`;
  return msg.endsWith(".") ? msg : `${msg}.`;
};

export function useKnowledgeActions(slug: string, preview: boolean) {
  const router = useRouter();
  const [state, setState] = useState<KnowledgeActionState>({ pending: null, error: null, notice: null, brief: null });

  const post = useCallback(
    async (action: string, path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
      if (state.pending) return null;
      if (preview) {
        setState((s) => ({ ...s, notice: "Preview — nothing was sent. On a mapped registry this control does the real thing.", error: null }));
        return null;
      }
      setState((s) => ({ ...s, pending: action, error: null, notice: null }));
      try {
        const res = await fetch(`/api/org/${encodeURIComponent(slug)}/registry/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setState((s) => ({ ...s, pending: null, error: errorSentence(data, res.status) }));
          return null;
        }
        setState((s) => ({ ...s, pending: null }));
        router.refresh();
        return data;
      } catch {
        setState((s) => ({ ...s, pending: null, error: "The request could not be sent. Check your connection and try again." }));
        return null;
      }
    },
    [preview, router, slug, state.pending],
  );

  /** Sweep the whole fleet, or one repo. */
  const sweep = useCallback(
    async (repositoryId?: string) => {
      const data = await post("sweep", "conformance", repositoryId ? { repositoryId } : {});
      if (data) setState((s) => ({ ...s, notice: `Swept ${String(data.scanned ?? "the fleet")} repo${data.scanned === 1 ? "" : "s"}.` }));
    },
    [post],
  );

  /** Compose (and record) a brief for one repo's next act; the text lands in `state.brief`. */
  const composeBrief = useCallback(
    async (repositoryId: string, stage: RegistryDispatchStage, subjects: string[]) => {
      const data = await post("brief", "dispatch", { repositoryId, stage, subjects, mode: "brief" });
      if (data && typeof data.brief === "string") {
        setState((s) => ({ ...s, brief: data.brief as string, notice: "Brief recorded. Copy it into a local agent session; the next sweep closes the hand-off when the map lands." }));
      }
    },
    [post],
  );

  /** Self-hosted only: spawn the local agent on the paired working copy. */
  const runLocal = useCallback(
    async (repositoryId: string, stage: RegistryDispatchStage, subjects: string[]) => {
      const data = await post("local", "dispatch", { repositoryId, stage, subjects, mode: "local" });
      if (data) setState((s) => ({ ...s, notice: "Dispatched to the local agent. It works on a branch and opens a PR; the sweep closes the hand-off after merge." }));
    },
    [post],
  );

  const copyBrief = useCallback(async () => {
    if (!state.brief) return;
    try {
      await navigator.clipboard.writeText(state.brief);
      setState((s) => ({ ...s, notice: "Brief copied." }));
    } catch {
      setState((s) => ({ ...s, notice: "Clipboard unavailable — select the brief and copy it by hand." }));
    }
  }, [state.brief]);

  const clearBrief = useCallback(() => setState((s) => ({ ...s, brief: null, notice: null, error: null })), []);

  return { state, sweep, composeBrief, runLocal, copyBrief, clearBrief };
}

export type KnowledgeActionsApi = ReturnType<typeof useKnowledgeActions>;
