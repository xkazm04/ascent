// The C3 share contract for the WHOLE care loop: what `POST /api/me/mentor/share` accepts beside the
// session shape (`care-shape-contract.ts` owns that section and is reused here unchanged).
//
// A share is a SNAPSHOT the mentor pushes from the developer's machine: profile, moves, journal,
// session shape and one setup flag. Each push replaces the previous one whole, so a section left out
// is "not shared this time", never a stale leftover.
//
// Four rules, each pinned in `care-share-contract.test.ts`:
//   NEVER SENT   a key naming a transcript, a prompt, a diff or file contents is refused ANYWHERE in the
//                payload, at any depth, with its own error. The privacy ledger's locked rows are a
//                promise the server keeps by refusing, not by ignoring.
//   NO IDENTITY  the payload never names whose data it is. Identity comes from the session the route
//                resolves; a `login`, `email` or `user` key anywhere is refused, so a body can never
//                point a write at someone else.
//   KNOWN ONLY   every object carries known keys only, every string has a length cap, every list has a
//                count cap. Refuses rather than repairs, like the shape validator.
//   ISO DATES    every date is parsed and re-emitted as an ISO string, so it crosses to the client as
//                the string the view model declares.
//
// PURE module, no db import: the Developer render is a client component.

import { validateCareShapePayload, type CareShapePayload } from "./care-shape-contract";
import type { CareMove, CareMoveCategory, CareMoveState, DeveloperView } from "./developer-view";

/** The raw request body cap. Checked on the text before it is parsed. */
export const CARE_SHARE_MAX_BYTES = 64 * 1024;

export const CARE_SHARE_CAPS = {
  goals: 10,
  goal: 200,
  role: 80,
  moves: 50,
  moveId: 80,
  title: 200,
  why: 500,
  droppedReason: 300,
  journal: 200,
  line: 280,
  /** Minutes per week: a whole week of working minutes is the ceiling of a plausible saving. */
  expectedSaving: 7 * 24 * 60,
  tryFor: 100,
} as const;

export const CARE_ARCHETYPES = ["explorer", "director", "verifier"] as const;
export type CareArchetype = (typeof CARE_ARCHETYPES)[number];

/** A move as the mentor sends it. `evidence` is absent on purpose: fleet evidence is ascent's to add. */
export type CareShareMove = Omit<CareMove, "evidence">;

export interface CareSharePayload {
  contract: 1;
  profile?: { role: string | null; archetypeHint: CareArchetype | null; goals: string[] };
  moves?: CareShareMove[];
  journal?: DeveloperView["journal"];
  shape?: CareShapePayload;
  setup?: { hookInstalled: boolean };
}

export type CareShareValidation = { ok: true; share: CareSharePayload } | { ok: false; errors: string[] };

/** Keys that name content which never leaves the machine. Compared lower-cased with separators removed. */
export const CARE_SHARE_NEVER_SENT_KEYS: ReadonlySet<string> = new Set([
  "transcript", "transcripts", "transcripttext", "prompt", "prompts", "diff", "diffs", "patch", "patches",
  "file", "files", "filecontent", "filecontents", "content", "contents", "messages", "conversation",
]);

/** Keys that would name whose data this is. Identity comes from the session, never the body. */
export const CARE_SHARE_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  "login", "githublogin", "user", "userid", "username", "email", "owner", "author", "viewer",
]);

const TOP = new Set(["contract", "profile", "moves", "journal", "shape", "setup"]);
const PROFILE = new Set(["role", "archetypeHint", "goals"]);
const MOVE = new Set(["id", "title", "state", "category", "why", "expectedSaving", "tryFor", "droppedReason", "registryPromotable", "at"]);
const ENTRY = new Set(["at", "line", "kind"]);
const SETUP = new Set(["hookInstalled"]);
const STATES: ReadonlySet<CareMoveState> = new Set(["proposed", "trying", "kept", "dropped"]);
const CATEGORIES: ReadonlySet<CareMoveCategory> = new Set(["session", "verification", "context", "tooling", "cost"]);
const KINDS = new Set(["retro", "weekly", "move"]);
const MOVE_ID = /^[a-z0-9][a-z0-9._-]*$/i;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fold = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Every key at any depth, with its path, so a never-sent key inside a move is found too. */
function walkKeys(value: unknown, path: string, out: Array<[string, string]>): void {
  if (Array.isArray(value)) value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, out));
  else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) {
      out.push([k, path ? `${path}.${k}` : k]);
      walkKeys(v, path ? `${path}.${k}` : k, out);
    }
  }
}

/** The keys the payload must never carry, found anywhere in it. Empty when it is clean. */
export function careShareForbiddenKeys(input: unknown): { neverSent: string[]; identity: string[] } {
  const keys: Array<[string, string]> = [];
  walkKeys(input, "", keys);
  return {
    neverSent: keys.filter(([k]) => CARE_SHARE_NEVER_SENT_KEYS.has(fold(k))).map(([, p]) => p),
    identity: keys.filter(([k]) => CARE_SHARE_IDENTITY_KEYS.has(fold(k))).map(([, p]) => p),
  };
}

function unknownKeys(obj: Record<string, unknown>, known: ReadonlySet<string>, where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) if (!known.has(k)) errors.push(`${where}: unknown key ${k}`);
}

function text(v: unknown, max: number, where: string, errors: string[], nullable = false): string | null {
  if (v === null && nullable) return null;
  if (typeof v !== "string" || v.trim().length === 0) errors.push(`${where}: must be a non-empty string${nullable ? " or null" : ""}`);
  else if (v.length > max) errors.push(`${where}: longer than ${max} characters`);
  else return v.trim();
  return null;
}

function isoDate(v: unknown, where: string, errors: string[]): string {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) {
    errors.push(`${where}: must be an ISO date`);
    return "";
  }
  return new Date(t).toISOString();
}

function validateProfile(v: unknown, errors: string[]): CareSharePayload["profile"] {
  if (!isObject(v)) return void errors.push("profile: must be an object");
  unknownKeys(v, PROFILE, "profile", errors);
  const role = text(v.role ?? null, CARE_SHARE_CAPS.role, "profile.role", errors, true);
  const hint = v.archetypeHint ?? null;
  if (hint !== null && !(CARE_ARCHETYPES as readonly unknown[]).includes(hint)) errors.push(`profile.archetypeHint: one of ${CARE_ARCHETYPES.join(", ")} or null`);
  const goals: string[] = [];
  const raw: unknown = v.goals ?? [];
  if (!Array.isArray(raw)) errors.push("profile.goals: must be a list");
  else if (raw.length > CARE_SHARE_CAPS.goals) errors.push(`profile.goals: at most ${CARE_SHARE_CAPS.goals}`);
  else {
    raw.forEach((g: unknown, i) => {
      const s = text(g, CARE_SHARE_CAPS.goal, `profile.goals[${i}]`, errors);
      if (s) goals.push(s);
    });
  }
  return { role, archetypeHint: hint as CareArchetype | null, goals };
}

function validateMove(v: unknown, i: number, errors: string[]): CareShareMove | null {
  const at = `moves[${i}]`;
  if (!isObject(v)) return (errors.push(`${at}: must be an object`), null);
  unknownKeys(v, MOVE, at, errors);
  const id = text(v.id, CARE_SHARE_CAPS.moveId, `${at}.id`, errors);
  if (id && !MOVE_ID.test(id)) errors.push(`${at}.id: letters, digits, dot, dash and underscore only`);
  if (!STATES.has(v.state as CareMoveState)) errors.push(`${at}.state: unknown state`);
  if (!CATEGORIES.has(v.category as CareMoveCategory)) errors.push(`${at}.category: unknown category`);
  const saving = v.expectedSaving ?? null;
  if (saving !== null && (typeof saving !== "number" || !Number.isFinite(saving) || saving < 0 || saving > CARE_SHARE_CAPS.expectedSaving)) errors.push(`${at}.expectedSaving: minutes per week, 0 to ${CARE_SHARE_CAPS.expectedSaving}, or null`);
  const tryFor = v.tryFor ?? null;
  if (tryFor !== null && (!Number.isInteger(tryFor) || (tryFor as number) < 1 || (tryFor as number) > CARE_SHARE_CAPS.tryFor)) errors.push(`${at}.tryFor: sessions, 1 to ${CARE_SHARE_CAPS.tryFor}, or null`);
  if (v.registryPromotable !== undefined && typeof v.registryPromotable !== "boolean") errors.push(`${at}.registryPromotable: must be a boolean`);
  const move: CareShareMove = {
    id: id ?? "",
    title: text(v.title, CARE_SHARE_CAPS.title, `${at}.title`, errors) ?? "",
    state: v.state as CareMoveState,
    category: v.category as CareMoveCategory,
    why: text(v.why, CARE_SHARE_CAPS.why, `${at}.why`, errors) ?? "",
    expectedSaving: saving as number | null,
    tryFor: tryFor as number | null,
    at: isoDate(v.at, `${at}.at`, errors),
  };
  if (v.droppedReason !== undefined) move.droppedReason = text(v.droppedReason, CARE_SHARE_CAPS.droppedReason, `${at}.droppedReason`, errors) ?? "";
  if (v.registryPromotable !== undefined) move.registryPromotable = v.registryPromotable as boolean;
  return move;
}

function validateEntry(v: unknown, i: number, errors: string[]): DeveloperView["journal"][number] | null {
  const at = `journal[${i}]`;
  if (!isObject(v)) return (errors.push(`${at}: must be an object`), null);
  unknownKeys(v, ENTRY, at, errors);
  if (v.kind !== undefined && !KINDS.has(v.kind as string)) errors.push(`${at}.kind: retro, weekly or move`);
  const entry: DeveloperView["journal"][number] = { at: isoDate(v.at, `${at}.at`, errors), line: text(v.line, CARE_SHARE_CAPS.line, `${at}.line`, errors) ?? "" };
  if (v.kind !== undefined) entry.kind = v.kind as "retro" | "weekly" | "move";
  return entry;
}

/** Validate a share body. Refuses anything it does not recognise; never trims a payload into shape. */
export function validateCareShare(input: unknown): CareShareValidation {
  if (!isObject(input)) return { ok: false, errors: ["payload is not an object"] };
  const forbidden = careShareForbiddenKeys(input);
  if (forbidden.neverSent.length) return { ok: false, errors: forbidden.neverSent.map((p) => `never-sent field: ${p} (transcripts, prompts, diffs and file contents never leave your machine)`) };
  if (forbidden.identity.length) return { ok: false, errors: forbidden.identity.map((p) => `identity field: ${p} (a share never names whose data it is)`) };

  const errors: string[] = [];
  unknownKeys(input, TOP, "payload", errors);
  if (input.contract !== 1) errors.push("contract must be 1");
  const share: CareSharePayload = { contract: 1 };
  if (input.profile !== undefined) share.profile = validateProfile(input.profile, errors);
  if (input.moves !== undefined) {
    if (!Array.isArray(input.moves) || input.moves.length > CARE_SHARE_CAPS.moves) errors.push(`moves: a list of at most ${CARE_SHARE_CAPS.moves}`);
    else {
      share.moves = input.moves.map((m, i) => validateMove(m, i, errors)).filter((m): m is CareShareMove => m !== null);
      if (new Set(share.moves.map((m) => m.id)).size !== share.moves.length) errors.push("moves: every id must be unique");
    }
  }
  if (input.journal !== undefined) {
    if (!Array.isArray(input.journal) || input.journal.length > CARE_SHARE_CAPS.journal) errors.push(`journal: a list of at most ${CARE_SHARE_CAPS.journal}`);
    else share.journal = input.journal.map((e, i) => validateEntry(e, i, errors)).filter((e) => e !== null).sort((a, b) => b.at.localeCompare(a.at));
  }
  if (input.shape !== undefined) {
    const shape = validateCareShapePayload(input.shape);
    if (!shape.ok) errors.push(...shape.errors.map((e) => `shape: ${e}`));
    else share.shape = input.shape as CareShapePayload;
  }
  if (input.setup !== undefined) {
    if (!isObject(input.setup)) errors.push("setup: must be an object");
    else {
      unknownKeys(input.setup, SETUP, "setup", errors);
      if (typeof input.setup.hookInstalled !== "boolean") errors.push("setup.hookInstalled: must be a boolean");
      else share.setup = { hookInstalled: input.setup.hookInstalled };
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, share };
}
