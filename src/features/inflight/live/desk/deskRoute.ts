// The desk's inner-layer address — the URL hash, so a layer survives a reload, a shared link and the
// browser's back button. Pure: parse and format only. `#/` (or no hash) is the desk itself.

import type { WaitKey } from "./waitingModel";

export type DeskRoute =
  | { kind: "round"; runId: string }
  | { kind: "lane"; runId: string; laneId: string }
  | { kind: "log"; runId: string; laneId: string }
  | { kind: "wait"; key: WaitKey }
  | { kind: "arm"; key: string };

const WAIT_KEYS: readonly WaitKey[] = ["plans", "paused", "merge", "rejected", "lessons", "stale-plan"];

const dec = (s: string): string | null => {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
};

export function parseRoute(hash: string): DeskRoute | null {
  const h = hash.replace(/^#\/?/, "");
  const [kind, a, b] = h.split("/");
  const x = a != null ? dec(a) : null;
  const y = b != null ? dec(b) : null;
  if (!x) return null;
  if (kind === "round") return { kind, runId: x };
  if ((kind === "lane" || kind === "log") && y) return { kind, runId: x, laneId: y };
  if (kind === "w") return (WAIT_KEYS as readonly string[]).includes(x) ? { kind: "wait", key: x as WaitKey } : null;
  if (kind === "arm") return { kind, key: x };
  return null;
}

export function routeHash(r: DeskRoute): string {
  const e = encodeURIComponent;
  switch (r.kind) {
    case "round":
      return `#/round/${e(r.runId)}`;
    case "lane":
    case "log":
      return `#/${r.kind}/${e(r.runId)}/${e(r.laneId)}`;
    case "wait":
      return `#/w/${r.key}`;
    case "arm":
      return `#/arm/${e(r.key)}`;
  }
}
