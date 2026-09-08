// Deterministic fixtures for the fleet desk. Seeded (mulberry32) repository names and a closed set of
// out-of-band events the desk can raise. Fiction — the scene says so on screen. No React, no clock.
//
// `volume` (the frame's data knob) sizes the fleet the desk stands for; the desk shows a window of
// FLEET_WINDOW repositories and states the total, because this subject is feedback, not data display.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";
import type { Severity } from "./severity";

export type EventKind = "scan-finished" | "regression" | "rescan-failed" | "credential-expired" | "credits-low" | "approval-request" | "engine-down" | "repo-unwatched" | "peer-joined" | "rescan-recovered" | "rescan-queued";
export type Surface = "scans" | "billing" | "access";

export interface DeskEvent {
  kind: EventKind;
  /** The subject half of the semantic key — a repository, a provider, a ledger. */
  subject: string;
  severity: Severity;
  /** The orthogonal bit: must the user do something? Decides transience, never severity. */
  actionRequired: boolean;
  title: string;
  /** The ONE action the toast offers, named by its verb; null for a dead-end-by-design awareness note. */
  verb: string | null;
  /** Completion of long-running, user-awaited work — the success/info admission exception. */
  awaited?: boolean;
  /** Blocks what the user is doing right now — the error grade's only route to `assertive`. */
  blocking?: boolean;
  /** Which in-app surface the message is about — the focus-awareness check compares against it. */
  surface: Surface;
}

export const semanticKey = (e: Pick<DeskEvent, "kind" | "subject">) => `${e.kind}:${e.subject}`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper"];
export const FLEET_WINDOW = 6;

/** The first FLEET_WINDOW repositories of a `volume`-sized fleet, seeded so every mount agrees. */
export function fleetFor(volume: SurfaceVolume): string[] {
  const rnd = mulberry32(volume);
  return Array.from({ length: Math.min(FLEET_WINDOW, volume) }, (_, i) => `${WORDS[Math.floor(rnd() * WORDS.length)]}-${String(i + 1).padStart(2, "0")}`);
}

/** Per kind: the label, the surface it is about, and whether it qualifies for the OS by default. */
export const KIND_META: Record<EventKind, { label: string; surface: Surface; osDefault: boolean; why: string }> = {
  "scan-finished": { label: "scan finished", surface: "scans", osDefault: true, why: "awaited work the user walked away from" },
  regression: { label: "regression", surface: "scans", osDefault: true, why: "failure of watched work" },
  "rescan-failed": { label: "rescan failed", surface: "scans", osDefault: true, why: "failure of user-initiated work" },
  "credential-expired": { label: "credential expired", surface: "access", osDefault: false, why: "the remedy waits for the natural return" },
  "credits-low": { label: "credits low", surface: "billing", osDefault: false, why: "degrades slowly; in-app + ledger suffice" },
  "approval-request": { label: "approval request", surface: "access", osDefault: true, why: "blocks another person" },
  "engine-down": { label: "engine unreachable", surface: "scans", osDefault: true, why: "critical" },
  "repo-unwatched": { label: "repo unwatched", surface: "scans", osDefault: false, why: "success of a foreground action" },
  "peer-joined": { label: "peer joined", surface: "access", osDefault: false, why: "info-class awareness" },
  "rescan-recovered": { label: "rescan recovered", surface: "scans", osDefault: false, why: "a recovery demotes to info" },
  "rescan-queued": { label: "rescan queued", surface: "scans", osDefault: false, why: "success of a foreground action" },
};

export const EVENTS = {
  scanFinished: (repo: string): DeskEvent => ({ kind: "scan-finished", subject: repo, severity: "success", actionRequired: false, title: `Scan of ${repo} finished — L3, +4 pts`, verb: "View", awaited: true, surface: "scans" }),
  regression: (repo: string): DeskEvent => ({ kind: "regression", subject: repo, severity: "error", actionRequired: true, title: `${repo} regressed: L4 → L3 (governance)`, verb: "Review", awaited: true, surface: "scans" }),
  rescanFailed: (repo: string): DeskEvent => ({ kind: "rescan-failed", subject: repo, severity: "error", actionRequired: false, title: `Rescan of ${repo} failed: provider timeout`, verb: "Retry", awaited: true, surface: "scans" }),
  rescanRecovered: (repo: string): DeskEvent => ({ kind: "rescan-recovered", subject: repo, severity: "info", actionRequired: false, title: `Rescan of ${repo} recovered on its own`, verb: null, surface: "scans" }),
  rescanQueued: (repo: string): DeskEvent => ({ kind: "rescan-queued", subject: repo, severity: "success", actionRequired: false, title: `Rescan of ${repo} queued`, verb: null, surface: "scans" }),
  credentialExpired: (): DeskEvent => ({ kind: "credential-expired", subject: "github-app", severity: "warning", actionRequired: true, title: "GitHub App credential expired overnight", verb: "Reconnect", surface: "access" }),
  creditsLow: (): DeskEvent => ({ kind: "credits-low", subject: "ledger", severity: "warning", actionRequired: false, title: "Scan credits below 20 — rescans pause at zero", verb: "Top up", surface: "billing" }),
  approvalRequest: (who: string): DeskEvent => ({ kind: "approval-request", subject: who, severity: "info", actionRequired: true, title: `${who} asked to join the org`, verb: "Review", surface: "access" }),
  engineDown: (): DeskEvent => ({ kind: "engine-down", subject: "engine", severity: "critical", actionRequired: true, title: "Scan engine unreachable — every rescan is blocked", verb: "Open status", blocking: true, surface: "scans" }),
  repoUnwatched: (repo: string): DeskEvent => ({ kind: "repo-unwatched", subject: repo, severity: "success", actionRequired: false, title: `${repo} unwatched`, verb: "Undo", surface: "scans" }),
  peerJoined: (who: string): DeskEvent => ({ kind: "peer-joined", subject: who, severity: "info", actionRequired: false, title: `${who} joined the org`, verb: null, surface: "access" }),
};

/** A failure storm: one dead provider, every watched repo failing its rescan in one frame. */
export const storm = (fleet: string[]): DeskEvent[] => fleet.flatMap((r) => [EVENTS.rescanFailed(r)]).concat([EVENTS.rescanFailed("orphan-07"), EVENTS.rescanFailed("orphan-08")]);

/** The undo window: the dwell IS the promise, so it is generous and its own constant. */
export const UNDO_WINDOW_MS = 8_000;
