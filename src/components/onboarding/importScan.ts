import type { LevelId } from "@/lib/types";
import { readSSE } from "@/lib/sse";

// Abort an import if no SSE event arrives within this window — turns a server stall into a
// recoverable error instead of an indefinite "Scanning…" hang. Sized for a REAL LLM scan: a single
// large repo can take well over a minute between per-repo `repo` events, so a tighter window
// false-aborts a perfectly healthy scan as "stalled". Kept generous (the watchdog only guards against
// a truly dead stream) until the server emits periodic heartbeat frames the watchdog can track.
const STALL_MS = 120_000;

/** Watch schedule the onboarding import commits every scanned repo to (sent with watch:true).
 *  Exported so the select step can DISCLOSE the recurring-cost commitment before the user scans —
 *  the copy and the POST body must never drift apart. */
export const IMPORT_WATCH_SCHEDULE = "weekly";

export interface ImportScanRequest {
  org: string;
  repos: string[];
  /** Installation id (when the source came from the GitHub App) so the server mints a token. */
  installationId?: string;
  /** Run a deterministic PREVIEW (mock) scan vs. a real LLM scan. Onboarding runs a real scan on the
   *  App path when the org has credits (the route meters + refunds); otherwise a disclosed preview. */
  mock?: boolean;
  /** Enroll every scanned repo in the recurring WEEKLY autoscan watch. Defaults to the App path ONLY
   *  (an installationId is present) — the sole surface where the select step DISCLOSES the recurring
   *  commitment ("Scanning also watches these repos… ≈N credits/month"). The public "free preview"
   *  funnel (no installationId, shown "no prepaid credits are used") must never be silently subscribed
   *  to weekly work it did not opt into. Failure mode this replaces: the body hardcoded watch:true for
   *  EVERY scan, so anonymous preview users were auto-enrolled in weekly autoscans on repos they don't
   *  own. Left overridable so a future disclosed opt-in can request it explicitly. */
  watch?: boolean;
}

export interface ImportScanCallbacks {
  /** A repo result landed: update its row. `skipped` is set (e.g. "insufficient_credits") when the
   *  server deferred this repo rather than scanning it — a terminal row state, not a failure. */
  onRepo: (data: {
    repo: string;
    level?: LevelId;
    overall?: number;
    error?: string;
    skipped?: string;
  }) => void;
  /** The stream finished successfully (terminal `result` event). */
  onResult: () => void;
  /** The stream reported an error event. */
  onError: (message: string) => void;
  /** A non-fatal `notice` (e.g. a credit shortfall capped the batch) — optional so existing callers
   *  needn't handle it. Forwarded so the reason isn't silently swallowed. */
  onNotice?: (data: { reason: string; scanning: number; skipped: number }) => void;
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

  // Enroll the weekly watch ONLY on the App path (installationId present) — exactly where the select
  // step discloses the recurring commitment. The public "free preview" funnel sends no installationId,
  // so it now requests watch:false instead of silently subscribing anonymous users to weekly autoscans.
  // NOTE: the server still writes the watchlist/schedule behind `if (watch)` (api/org/import/route.ts:249)
  // and DEFAULTS the field to true (route.ts:93), so the preview path must send watch:false EXPLICITLY —
  // omission would re-enable the silent enrollment. That server code is intentionally left untouched.
  const watch = request.watch ?? Boolean(request.installationId);
  try {
    armStall();
    const res = await fetch("/api/org/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org: request.org,
        repos: request.repos,
        installationId: request.installationId ?? undefined,
        // Default to preview (mock) when the caller doesn't specify — the public-handle funnel can't
        // meter credits. The App path passes mock:false explicitly when the org has credits.
        mock: request.mock ?? true,
        watch,
        // Send the cadence only when actually watching, so the body never implies a schedule the
        // server won't set (it ignores `schedule` under watch:false anyway).
        schedule: watch ? IMPORT_WATCH_SCHEDULE : undefined,
      }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? `Import failed (${res.status}).`);
    }

    // Drain the SSE stream through the shared reader (src/lib/sse.ts) rather than a third hand-rolled
    // copy of the getReader/decoder/buffer/indexOf("\n\n") loop. The stall watchdog stays LOCAL: readSSE's
    // `onChunk` re-arms it on every chunk of progress, exactly as the old inline `armStall()` did. A frame
    // whose data is absent or unparseable yields data:null — skip it, matching the old `continue` behavior.
    await readSSE(
      res.body,
      ({ event, data }) => {
        if (!data) return;
        if (event === "repo") {
          cb.onRepo({
            repo: String(data.repo),
            level: data.level as LevelId | undefined,
            overall: typeof data.overall === "number" ? data.overall : undefined,
            error: typeof data.error === "string" ? data.error : undefined,
            skipped: typeof data.skipped === "string" ? data.skipped : undefined,
          });
        } else if (event === "notice") {
          cb.onNotice?.({
            reason: String(data.reason ?? ""),
            scanning: typeof data.scanning === "number" ? data.scanning : 0,
            skipped: typeof data.skipped === "number" ? data.skipped : 0,
          });
        } else if (event === "result") {
          cb.onResult();
        } else if (event === "error") {
          cb.onError(String(data.error ?? "Scan failed."));
        }
      },
      armStall, // progress arrived — reset the stall window
    );
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
