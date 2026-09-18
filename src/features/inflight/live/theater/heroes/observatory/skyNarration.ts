// THE NARRATED LINE — the whole sky as one sentence under it, for the glance that reads nothing else:
// "kp is editing src/scoring/claims.ts · systedo is checking the build · web waits for a slot".
//
// Pure. Clauses come in the sky's own order (a landing first, then the bodies at work in seat order,
// then who waits, then who is paused on a breaker the operator must lift). It FITS rather than wraps:
// if the sentence is too wide for the band at display size it steps down a size, then shortens paths
// to their file names, then folds the tail clauses into "+N more" — never an ellipsis mid-word.

import type { LanePhase } from "@/lib/local/runner-types";
import { fmtQuiet, laneQuietForMs } from "@/lib/local/lane-phase";
import type { SkyBody, SkyModel } from "./skyModel";

export interface Clause {
  /** The repo, rendered in the strong voice; null for a sentence about the runner itself. */
  subject: string | null;
  rest: string;
}

const verb = (phase: LanePhase, file: string | null, quiet: string | null): string => {
  switch (phase) {
    case "planning":
      return "is planning its next change";
    case "baseline":
      return "is checking the baseline";
    case "agent-reading":
      return file ? `is reading ${file}` : "is reading the code";
    case "agent-editing":
      return file ? `is editing ${file}` : "is editing";
    case "agent-thinking":
      return "is thinking";
    case "agent-quiet":
      return quiet ? `has been quiet for ${quiet}` : "is working quietly";
    case "verifying":
      return "is checking the build";
    case "installing":
      return "is installing dependencies";
    case "committing":
      return "is committing";
    case "landing":
      return "is landing its work";
    case "rescanning":
      return "is rescanning";
    default:
      return "is working";
  }
};

const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Every clause the sky can say right now, in order. `short` names files by basename. */
export function narrationClauses(model: SkyModel, now: number, justLanded: readonly string[], short = false): Clause[] {
  const out: Clause[] = [];
  const { core, bodies } = model;
  if (core.tone === "none") return [{ subject: null, rest: "No runner is reporting" }];
  if (core.tone === "hold") out.push({ subject: null, rest: `The runner is holding — ${core.why ?? "a breaker fired"}${core.sub ? ` ${core.sub}` : ""}` });
  if (core.tone === "stopped") out.push({ subject: null, rest: `The runner has ${core.title === "Stopped" ? "stopped" : "stopped on an error"}` });
  const atWork = bodies.filter((b) => b.ring === 0 && b.lane);
  const working = new Set(atWork.map((b) => b.name));
  // A landing is said first; a repo that landed and is already at work again says both in one clause.
  for (const name of justLanded) if (!working.has(name)) out.push({ subject: name, rest: "just landed verified work" });
  for (const b of atWork) {
    const lane = b.lane!;
    const quiet = lane.phase === "agent-quiet" ? laneQuietForMs(lane, now) : null;
    const file = b.file ? (short ? basename(b.file) : b.file) : null;
    const doing = verb(lane.phase, file, quiet != null ? fmtQuiet(quiet) : null);
    const landing = lane.phase === "landing" || lane.phase === "committing";
    out.push({ subject: b.name, rest: !justLanded.includes(b.name) ? doing : landing ? "just landed verified work" : `just landed and ${doing}` });
  }
  const waiting = bodies.filter((b) => b.ring === 1 && b.note === "waits for a slot").map((b) => b.name);
  if (waiting.length) out.push({ subject: joinNames(waiting), rest: waiting.length === 1 ? "waits for a slot" : "wait for a slot" });
  for (const b of bodies.filter((x) => x.ring === 1 && x.noteTone !== "calm")) out.push({ subject: b.name, rest: b.note === "failed" ? "failed this cycle" : `is ${b.note}` });
  const stuck = bodies.filter((b: SkyBody) => b.ring === 2 && b.noteTone === "attention");
  for (const b of stuck) out.push({ subject: b.name, rest: `is ${b.note?.replace(" · ", " — ") ?? "paused"}` });
  if (core.tone === "rest") {
    const wake = model.nextWake;
    const who = wake?.repo ? bodies.find((b) => b.repo === wake.repo)?.name ?? null : null;
    out.push({ subject: null, rest: "Every repo is resting" });
    if (wake && who) out.push({ subject: who, rest: `wakes at ${wake.at}` });
  }
  if (core.tone === "live" && atWork.length === 0 && out.length === 0) out.push({ subject: null, rest: core.title === "Between runs" ? "Between runs — the next run is being prepared" : "No lane is working right now" });
  if (core.tone === "hold" && atWork.length === 0 && out.length === 1) out.push({ subject: null, rest: "nothing dispatches while it holds" });
  return out;
}

export const SEPARATOR = " · ";

/** Estimated rendered width of a clause list at `size` user units (Geist sans averages ~0.47 em;
 *  measured against the rendered line at 1920 px, with a margin for wide glyphs). */
export function estimateWidth(clauses: readonly Clause[], size: number): number {
  const chars = clauses.reduce((n, c) => n + (c.subject ? c.subject.length + 1 : 0) + c.rest.length, 0) + SEPARATOR.length * Math.max(0, clauses.length - 1);
  return chars * size * 0.47;
}

export interface FittedNarration {
  clauses: Clause[];
  size: "display" | "heading";
  /** The full sentence, for the text alternative — never shortened. */
  full: string;
}

export const sentence = (clauses: readonly Clause[]): string =>
  clauses.map((c) => (c.subject ? `${c.subject} ${c.rest}` : c.rest)).join(SEPARATOR);

export const NARRATION_SIZES = { display: 31, heading: 25 } as const;

export function fitNarration(model: SkyModel, now: number, justLanded: readonly string[], width: number): FittedNarration {
  const full = narrationClauses(model, now, justLanded);
  const text = sentence(full);
  const attempts: [Clause[], FittedNarration["size"]][] = [
    [full, "display"],
    [full, "heading"],
    [narrationClauses(model, now, justLanded, true), "heading"],
  ];
  for (const [clauses, size] of attempts) if (estimateWidth(clauses, NARRATION_SIZES[size]) <= width) return { clauses, size, full: text };
  const short = attempts[2]![0];
  for (let keep = short.length - 1; keep >= 1; keep--) {
    const clauses = [...short.slice(0, keep), { subject: null, rest: `+${short.length - keep} more` }];
    if (estimateWidth(clauses, NARRATION_SIZES.heading) <= width) return { clauses, size: "heading", full: text };
  }
  return { clauses: short.slice(0, 1), size: "heading", full: text };
}
