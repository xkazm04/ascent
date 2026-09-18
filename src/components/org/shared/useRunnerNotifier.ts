"use client";

// The runner notifier's engine — see org/shell/RunnerNotifier.tsx for the why. It lives in org/shared (not
// beside the component) because the theater (a feature) arms the same engine from its own control, and
// features may import org/shared but not the shell.
//
// Two paths, and the second only exists after an explicit opt-in:
//   UNARMED — at most ONE read per mount, and only when the browser could still grant permission and
//             the viewer has not dismissed the offer: it learns whether this org has a runner (the
//             `runner` flag on the needs-you answer) so the offer chip appears only where it means
//             something. No timer is ever armed on this path.
//   ARMED   — preference on AND permission granted: a non-overlapping `setTimeout` chain every
//             `NOTIFIER_POLL_MS`, deliberately NOT visibility-gated (a hidden tab is exactly when an OS
//             notification matters). Each read goes through `decideNotify`: dedup per item id (persisted
//             in localStorage, so a reload never re-announces), at most one notification per
//             `NOTIFY_BATCH_MS`, summarising only what is new.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { NOTIFIER_POLL_MS } from "@/lib/local/runner-types";
import {
  decideNotify,
  ledgerHref,
  needsYouItems,
  parseNeedsYou,
  summarizeNeedsYou,
  type NeedsYouResponse,
  type NotifyState,
} from "@/lib/org/runner-needs-you";
import {
  RUNNER_NOTIFY_EVENT,
  notificationPermission,
  notifyStateKey,
  requestRunnerNotify,
  runnerNotifyArmed,
} from "@/lib/org/runner-notify";

const dismissKey = (slug: string) => `ascent-runner-notify-dismissed:${slug.toLowerCase()}`;

function loadState(slug: string): NotifyState | null {
  try {
    const raw = window.localStorage.getItem(notifyStateKey(slug));
    const v = raw ? (JSON.parse(raw) as Partial<NotifyState>) : null;
    return v && Array.isArray(v.seen) ? { seen: v.seen.filter((x) => typeof x === "string"), lastAt: typeof v.lastAt === "number" ? v.lastAt : null } : null;
  } catch {
    return null;
  }
}

function saveState(slug: string, state: NotifyState): void {
  try {
    window.localStorage.setItem(notifyStateKey(slug), JSON.stringify(state));
  } catch {
    /* storage unavailable — dedup lasts for this page's life (the in-memory copy) */
  }
}

function offerDismissed(slug: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(slug)) === "1";
  } catch {
    return false;
  }
}

async function readNeedsYou(slug: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<NeedsYouResponse | null> {
  try {
    const res = await fetchImpl(`/api/org/loop/needs-you?org=${encodeURIComponent(slug)}`, { cache: "no-store", signal });
    if (!res.ok) return null;
    return parseNeedsYou(await res.json().catch(() => null));
  } catch {
    return null;
  }
}

function show(slug: string, body: string): void {
  try {
    const n = new window.Notification("Ascent — the runner needs you", { body, tag: `ascent-runner-${slug.toLowerCase()}` });
    n.onclick = () => {
      window.focus();
      window.location.assign(ledgerHref(slug));
      n.close();
    };
  } catch {
    /* the platform refused (e.g. a service-worker-only browser) — the in-app surfaces still say it */
  }
}

export interface RunnerNotifierOptions {
  /** Show the notifier's own quiet offer chip (off on the theater, which has its own control). */
  offer?: boolean;
  pollMs?: number;
  batchMs?: number;
  fetchImpl?: typeof fetch;
}

export function useRunnerNotifier(slug: string, opts: RunnerNotifierOptions = {}) {
  const { offer = true, pollMs = NOTIFIER_POLL_MS, batchMs, fetchImpl } = opts;
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(RUNNER_NOTIFY_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(RUNNER_NOTIFY_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const armed = useSyncExternalStore(subscribe, () => runnerNotifyArmed(slug), () => false);
  const [hasRunner, setHasRunner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // UNARMED: one probe, so the offer only appears for an org with a runner. Never a timer.
  useEffect(() => {
    const perm = notificationPermission();
    if (armed || !offer || perm === "unsupported" || perm === "denied") return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      if (offerDismissed(slug)) return;
      const res = await readNeedsYou(slug, ctrl.signal, fetchImpl ?? fetch);
      if (!ctrl.signal.aborted && res && (res.runner || needsYouItems(res).length > 0)) setHasRunner(true);
    }, 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [armed, offer, slug, fetchImpl]);

  // ARMED: the poll. Not visibility-gated, on purpose.
  useEffect(() => {
    if (!armed) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let memory: NotifyState = { seen: [], lastAt: null };
    const tick = async () => {
      const res = await readNeedsYou(slug, ctrl.signal, fetchImpl ?? fetch);
      if (ctrl.signal.aborted) return;
      if (res && notificationPermission() === "granted") {
        const decided = decideNotify(loadState(slug) ?? memory, needsYouItems(res), Date.now(), batchMs);
        memory = decided.state;
        saveState(slug, decided.state);
        if (decided.notify) show(slug, summarizeNeedsYou(decided.notify));
      }
      timer = setTimeout(() => void tick(), pollMs);
    };
    timer = setTimeout(() => void tick(), 0);
    return () => {
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [armed, slug, pollMs, batchMs, fetchImpl]);

  const enable = useCallback(() => void requestRunnerNotify(slug), [slug]);
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(dismissKey(slug), "1");
    } catch {
      /* storage unavailable — dismissed for this page only */
    }
    setDismissed(true);
  }, [slug]);

  return { armed, offerVisible: offer && !armed && hasRunner && !dismissed, enable, dismiss };
}
