import type { LevelId } from "@/lib/types";

// Abort an import if no SSE event arrives within this window — turns a server stall into a
// recoverable error instead of an indefinite "Scanning…" hang.
const STALL_MS = 45_000;

/** Watch schedule the onboarding import commits every scanned repo to (sent with watch:true).
 *  Exported so the select step can DISCLOSE the recurring-cost commitment before the user scans —
 *  the copy and the POST body must never drift apart. */
export const IMPORT_WATCH_SCHEDULE = "weekly";

export interface ImportScanRequest {
  org: string;
  repos: string[];
  /** Installation id (when the source came from the GitHub App) so the server mints a token. */
  installationId?: string;
}

export interface ImportScanCallbacks {
  /** A repo result landed: update its row. */
  onRepo: (data: {
    repo: string;
    level?: LevelId;
    overall?: number;
    error?: string;
  }) => void;
  /** The stream finished successfully (terminal `result` event). */
  onResult: () => void;
  /** The stream reported an error event. */
  onError: (message: string) => void;
}

/**
 * POST the import request and fold the streamed SSE events into the caller's state via callbacks.
 * Owns the stall watchdog (re-armed on every chunk) and aborts through the supplied controller.
 * Resolves with `{ ok: true }` when the stream completes, or `{ ok: false, ... }` with a reason so
 * the caller can surface the right message (server failure, stall, or user cancel).
 */
export async function runImportScan(
  request: ImportScanRequest,
  controller: AbortController,
  cb: ImportScanCallbacks,
): Promise<{ ok: true } | { ok: false; aborted: boolean; stalled: boolean; message?: string }> {
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  const armStall = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, STALL_MS);
  };

  try {
    armStall();
    const res = await fetch("/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org: request.org,
        repos: request.repos,
        installationId: request.installationId ?? undefined,
        mock: true,
        watch: true,
        schedule: IMPORT_WATCH_SCHEDULE,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Import failed (${res.status}).`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      armStall(); // progress arrived — reset the stall window
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        const lines = block.split("\n");
        let event = "message";
        let dataStr = "";
        for (const raw of lines) {
          const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataStr);
        } catch {
          continue;
        }
        if (event === "repo") {
          cb.onRepo({
            repo: String(data.repo),
            level: data.level as LevelId | undefined,
            overall: typeof data.overall === "number" ? data.overall : undefined,
            error: typeof data.error === "string" ? data.error : undefined,
          });
        } else if (event === "result") {
          cb.onResult();
        } else if (event === "error") {
          cb.onError(String(data.error ?? "Scan failed."));
        }
      }
    }
    return { ok: true };
  } catch (err) {
    if (controller.signal.aborted) {
      return { ok: false, aborted: true, stalled };
    }
    return { ok: false, aborted: false, stalled, message: err instanceof Error ? err.message : "Scan failed." };
  } finally {
    if (stallTimer) clearTimeout(stallTimer);
  }
}
