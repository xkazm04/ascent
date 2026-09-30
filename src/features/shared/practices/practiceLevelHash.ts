// Hash for the Prism practice level. Mined rows keep `#practice-<id>` (the deep link four other
// surfaces already emit). Authored rows use `#playbook-<id>` so Back has a URL without colliding
// with that contract. Pure aside from the two window writers.
import type { PracticeRow } from "./practiceRows";
import { practiceIdFromHash } from "./usePracticeHash";

export function practiceLevelHash(row: Pick<PracticeRow, "source" | "id">): string {
  const prefix = row.source === "authored" ? "playbook-" : "practice-";
  return `#${prefix}${encodeURIComponent(row.id)}`;
}

export function rowForLevelHash(rows: readonly PracticeRow[], hash: string): PracticeRow | null {
  const minedId = practiceIdFromHash(hash);
  if (minedId) return rows.find((r) => r.source === "mined" && r.id === minedId) ?? null;
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith("playbook-")) return null;
  const id = decodeURIComponent(raw.slice("playbook-".length));
  return id ? rows.find((r) => r.source === "authored" && r.id === id) ?? null : null;
}

function sameHash(current: string, desired: string): boolean {
  if (current === desired) return true;
  try {
    return decodeURIComponent(current) === decodeURIComponent(desired);
  } catch {
    return false;
  }
}

export function publishPracticeHash(row: Pick<PracticeRow, "source" | "id">): void {
  if (typeof window === "undefined") return;
  const desired = practiceLevelHash(row);
  // The browser may encode the fragment differently from encodeURIComponent. Republishing then
  // would dispatch hashchange and open the row again.
  if (sameHash(window.location.hash, desired)) return;
  window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${desired}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function clearPracticeHash(): void {
  if (typeof window === "undefined" || !window.location.hash) return;
  window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
