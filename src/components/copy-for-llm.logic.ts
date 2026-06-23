// Pure, DOM-free core of the CopyForLlm button: the clipboard-with-fallback decision and the
// copied/failed state machine. Extracted so the fallback path and the transitions can be unit-tested
// under the project's node (no-jsdom) Vitest env by injecting the clipboard API + legacy copy fn.
// Behavior here is verbatim with the original inline component closure (see CopyForLlm.tsx).

/** The Clipboard surface CopyForLlm relies on (a subset of the real `navigator.clipboard`). */
export interface ClipboardLike {
  writeText?: (text: string) => Promise<void>;
}

/**
 * Try the async Clipboard API, falling back to `legacy` (execCommand textarea) when the API is
 * absent OR when `writeText` rejects (insecure-context / older-browser path). Returns whether the
 * copy ultimately succeeded.
 *
 * - clipboard present + resolves   -> true, `legacy` NOT called
 * - clipboard present + rejects    -> falls through to `legacy`, returns its result
 * - clipboard absent (no writeText)-> `legacy` invoked with the exact `text`
 * - both fail                      -> false
 */
export async function attemptCopy(
  text: string,
  clipboard: ClipboardLike | undefined,
  legacy: (text: string) => boolean,
): Promise<boolean> {
  let ok = false;
  try {
    if (clipboard?.writeText) {
      await clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = legacy(text); // insecure-context / older-browser fallback
  return ok;
}

/** The three visual states of the button. */
type CopyState = "idle" | "copied" | "failed";

/** How long each terminal state shows before auto-resetting to idle (ms). */
export const COPIED_RESET_MS = 2000;
export const FAILED_RESET_MS = 2500;

export interface CopyTransition {
  /** State to show immediately after the copy attempt. */
  next: CopyState;
  /** Delay (ms) after which the state should auto-reset back to "idle". */
  resetMs: number;
}

/**
 * Map a copy-attempt outcome to the next state + its auto-reset delay. The reset always returns to
 * "idle", so the full machine is idle -> copied -> idle (success) or idle -> failed -> idle (error).
 */
export function nextCopyState(ok: boolean): CopyTransition {
  return ok
    ? { next: "copied", resetMs: COPIED_RESET_MS }
    : { next: "failed", resetMs: FAILED_RESET_MS };
}
