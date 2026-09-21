// The runner notifier's PERMISSION-FIRST preference — browser-only helpers, no React.
//
// A user who never asked is never prompted and never polled: the notifier does nothing until this
// org's preference is on AND the browser granted Notification permission. The only way in is an
// explicit click ("Notify me when the runner needs me" — on the theater or in the notifier's own quiet
// chip), because `Notification.requestPermission()` must run inside that gesture and a prompt on page
// load is the pattern every browser now punishes.
//
// Every storage access is wrapped: storage can be absent (private windows, blocked site data) and a
// throw here would take the org shell down for a convenience.

export const RUNNER_NOTIFY_EVENT = "ascent:runner-notify";

const prefKey = (slug: string) => `ascent-runner-notify:${slug.toLowerCase()}`;
export const notifyStateKey = (slug: string) => `ascent-runner-notify-state:${slug.toLowerCase()}`;

export type NotifyPermission = NotificationPermission | "unsupported";

export function notificationPermission(): NotifyPermission {
  if (typeof window === "undefined" || typeof window.Notification === "undefined") return "unsupported";
  return window.Notification.permission;
}

export function runnerNotifyWanted(slug: string): boolean {
  try {
    return window.localStorage.getItem(prefKey(slug)) === "1";
  } catch {
    return false;
  }
}

/** Record the preference and tell every notifier on this page (other tabs hear the `storage` event). */
export function setRunnerNotifyWanted(slug: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(prefKey(slug), "1");
    else window.localStorage.removeItem(prefKey(slug));
  } catch {
    /* storage unavailable — the preference lasts for this page only */
  }
  try {
    window.dispatchEvent(new CustomEvent(RUNNER_NOTIFY_EVENT, { detail: { slug: slug.toLowerCase(), on } }));
  } catch {
    /* no window */
  }
}

/** Ask (inside a click) and, when granted, switch the org's notifier on. Returns the permission. */
export async function requestRunnerNotify(slug: string): Promise<NotifyPermission> {
  if (notificationPermission() === "unsupported") return "unsupported";
  let permission: NotificationPermission;
  try {
    permission = await window.Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
  if (permission === "granted") setRunnerNotifyWanted(slug, true);
  return permission;
}

/** Is the notifier armed for this org right now (preference on AND permission granted)? */
export function runnerNotifyArmed(slug: string): boolean {
  return notificationPermission() === "granted" && runnerNotifyWanted(slug);
}
