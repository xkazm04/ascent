// THE ACTION CATALOG — one array, four derivations.
//
// ONE ARRAY. `ATHENA_ACTIONS` below is the only place an action's name, its parameters, the role
// required to accept it and the sentence the operator reads are written down. Four things derive from
// it and NONE of them may restate it:
//
//   1. the TEACHING TEXT shipped to the model  — `ATHENA_ACTION_CONTRACT`, built from `athenaActionWire()`
//   2. the VALIDATOR                            — `coerceAthenaAction`, whose checks read `spec.params`
//   3. the EXECUTOR BINDING                     — `ATHENA_ACTION_EXECUTORS` (actions-execute.ts), a
//                                                 `Record<AthenaActionId, …>` so a missing or extra
//                                                 executor is a COMPILE error, not a runtime surprise
//   4. the CAPABILITY DOC                       — checked against the wire catalog, never hand-written
//
// WHAT THIS PREVENTS IS NOT A CRASH, IT IS ASYMMETRY. A kind the prompt teaches and the validator
// rejects; a kind the validator accepts and no executor performs; a field the executor requires and
// the prompt never mentions. In every one of those the model is blamed for hallucinating a capability
// it was, in fact, taught — and the bug is invisible because each half is individually correct.
//
// WHY `execute` IS NOT A FIELD ON THE SPEC. It is the one part of an action that needs the database,
// and this module is imported by `turn.ts`, which is documented as having NO database, NO network and
// NO Next.js so a whole turn can run against fakes in a plain node test. So the catalog is pure and
// the executors live in the sibling `actions-execute.ts`, bound by a `Record<AthenaActionId, …>`. That
// binding is STRICTER than a field would be: an optional `execute?` cannot detect an action nobody
// performs, whereas the Record makes it un-compilable. A set-equality test (actions.test.ts) pins the
// same fact at runtime, so the two halves cannot drift even through an `any`.
//
// NOTHING IN THIS MODULE THROWS. It sits between a model completion and a database write; the fence
// parser follows blocks.ts's discipline exactly — structurally wrong is DROPPED WHOLE and COUNTED,
// because a proposal that silently vanishes is indistinguishable from a model that never offered one,
// and only one of those is worth fixing.

import type { OrgRole } from "@/lib/db/members";

/** Most proposals one reply may raise. A panel that is mostly buttons has stopped being a conversation. */
export const ATHENA_MAX_ACTIONS = 2;

/** Longest a summary line is rendered at. Cut, never dropped. */
const SUMMARY_MAX_CHARS = 140;

/** Most ids one `handoff_followups` may carry — the same ceiling POST /api/org/followups/handoff sets. */
export const ATHENA_ACTION_MAX_IDS = 50;

/**
 * One declared parameter. The validator's presence and shape checks are derived from THESE FIELDS, so
 * adding a parameter extends the prompt, the validator and the executor's input in a single edit.
 */
export interface AthenaActionParam {
  readonly name: string;
  /** Absent or empty → the proposal is refused. */
  readonly required: boolean;
  /** One line, shipped to the model verbatim under the action it belongs to. */
  readonly doc: string;
  /** A list-valued parameter: the wire carries an array of strings. */
  readonly list?: boolean;
  /** A closed set of accepted values. Rendered INTO the prompt and enforced BY the validator. */
  readonly values?: readonly string[];
}

/** Every declared parameter, coerced. A list param is always an array; everything else is a string. */
export type AthenaActionParamValues = Record<string, string | string[]>;

/**
 * What came of running an action. MERGED INTO the proposal's `payloadJson` under `outcome` — there is
 * no outcome column and there must not be one (see athena-proposals.ts's header).
 *
 * `ok: false` is a REFUSAL, not a failure: the action ran, looked, and declined to act. It is still an
 * outcome and it is still stamped. An executor that THROWS is a different thing entirely — that is a
 * failure, and it releases the claim so the operator can try again.
 */
export interface AthenaActionOutcome {
  ok: boolean;
  /** Machine-readable. `handed_off` | `ruled` | `refused` | `retired` | `invalid` | `failed`. */
  kind: string;
  /** One line the operator reads on the resolved card. */
  detail: string;
  /** Kind-shaped extras. A handoff carries `marked`/`skipped`; a ruling carries the decision id. */
  data?: Record<string, unknown>;
}

/** The kinds an outcome may carry that this module produces without an executor running. */
export const OUTCOME_RETIRED = "retired";
export const OUTCOME_INVALID = "invalid";
export const OUTCOME_DECLINED = "declined";

export interface AthenaActionSpec {
  readonly id: string;
  /** One line, shipped to the model verbatim. */
  readonly doc: string;
  readonly params: readonly AthenaActionParam[];
  /** The role an operator must hold to ACCEPT this. Gating is READ FROM HERE — never a parallel list. */
  readonly requiredRole: OrgRole;
  /** The sentence on the Accept card. Pure, resolved at render time, never stored. */
  readonly summary: (params: AthenaActionParamValues) => string;
  /**
   * A realistic worked example, rendered into the teaching text as a complete fence. It lives HERE
   * rather than in the contract prose for the same reason everything else does: an example written
   * beside the contract outlives the action it exemplifies, and then the prompt's one concrete
   * illustration teaches a capability that no longer exists.
   */
  readonly example?: Readonly<Record<string, string | readonly string[]>>;
}

// ── the array ────────────────────────────────────────────────────────────────────────────────────
//
// Both actions dispatch machinery that already exists. Neither reaches outside Ascent and neither
// spends money — the two properties that make a companion's Accept button safe to put in front of an
// operator at all.

/**
 * The decision modules a ruling may name. Declared here rather than imported so this module stays
 * pure (`org-decisions.ts` pulls in Prisma); `actions.test.ts` asserts every value satisfies
 * `isDecisionModule`, so the two can never drift apart unnoticed.
 */
const RULING_MODULES = ["security", "teams", "passports", "contributors", "athena"] as const;

/** The rulings a proposal may carry. `open` is deliberately absent: reopening is not something she offers. */
const RULINGS = ["accepted", "dismissed", "snoozed"] as const;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
const many = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []);

const clip = (s: string, max = SUMMARY_MAX_CHARS): string =>
  s.length <= max ? s : `${s.slice(0, max).trimEnd()}…`;

export const ATHENA_ACTIONS = [
  {
    id: "handoff_followups",
    doc:
      "Claim follow-up items for the team, flipping each from open to in progress. Propose this when " +
      "the operator has settled on which gaps they are taking on next. It records the claim only — the " +
      "fix itself is a prompt a human runs, so nothing is changed in any repository.",
    params: [
      {
        name: "ids",
        required: true,
        list: true,
        doc: "The follow-up item ids to claim, as an array of strings. All must belong to this organization.",
      },
      {
        name: "note",
        required: false,
        doc: "One line recorded on each item's timeline saying why it was claimed.",
      },
    ],
    requiredRole: "member",
    summary: (p) => {
      const n = many(p.ids).length;
      return clip(`Claim ${n} follow-up item${n === 1 ? "" : "s"} as in progress`);
    },
  },
  {
    id: "rule_on_finding",
    doc:
      "Record the team's ruling on one finding — accept it, dismiss it, or snooze it until a date — " +
      "together with the reasoning. The reasoning is the payload: it is published to the organization's " +
      "memory and reaches the next scan, so a dismissal teaches rather than merely silences.",
    params: [
      {
        name: "module",
        required: true,
        values: RULING_MODULES,
        doc: "Which surface the finding belongs to. Use \"athena\" only for a finding you raised yourself.",
      },
      {
        name: "itemKey",
        required: true,
        doc: "The finding's stable key within that module, exactly as the tool that reported it gave it.",
      },
      {
        name: "ruling",
        required: true,
        values: RULINGS,
        doc: "accepted = we will do it. dismissed = we will not, and here is why. snoozed = not now.",
      },
      {
        name: "rationale",
        required: true,
        doc: "Why. A ruling with no reason is a silent suppression and is not worth recording.",
      },
      {
        name: "title",
        required: false,
        doc: "The finding's title at ruling time, so the record still reads after the finding disappears.",
      },
      {
        name: "snoozedUntil",
        required: false,
        doc: "Required when ruling is \"snoozed\": an ISO date in the future. A snooze with no end is a dismissal wearing a friendlier word.",
      },
    ],
    requiredRole: "member",
    example: {
      module: "security",
      itemKey: "acme/api::branch-protection",
      ruling: "dismissed",
      rationale: "Mirror of an upstream repo; protection is enforced there.",
      title: "Branch protection (acme/api)",
    },
    summary: (p) => {
      const ruling = one(p.ruling);
      const what = one(p.title) || one(p.itemKey);
      const verb = ruling === "accepted" ? "Accept" : ruling === "snoozed" ? "Snooze" : "Dismiss";
      return clip(`${verb} ${what} (${one(p.module)})`);
    },
  },
] as const satisfies readonly AthenaActionSpec[];

/** Every action id this build carries. A proposal naming anything else is retired, never runnable. */
export type AthenaActionId = (typeof ATHENA_ACTIONS)[number]["id"];

export const ATHENA_ACTION_IDS: readonly AthenaActionId[] = ATHENA_ACTIONS.map((a) => a.id);

/**
 * The same array, widened to the interface. `as const` above narrows every field to its literal — which
 * is what gives us `AthenaActionId` — but it also erases the OPTIONAL keys from specs that omit them,
 * so `p.list` is not even a readable property on a param that has no `list`. The `satisfies` clause has
 * already proved the assignment is sound; this is the widened view everything that READS the catalog
 * uses, while the narrow one stays available for the id type.
 */
const SPECS: readonly AthenaActionSpec[] = ATHENA_ACTIONS;

/** The spec for an id, or null. THE authority on whether this build still carries an action. */
export function athenaActionSpec(id: string): AthenaActionSpec | null {
  return SPECS.find((a) => a.id === id) ?? null;
}

export function isAthenaActionId(v: unknown): v is AthenaActionId {
  return typeof v === "string" && ATHENA_ACTIONS.some((a) => a.id === v);
}

// ── derivation 1: the wire catalog, and the teaching text built from it ─────────────────────────

export interface AthenaActionWireParam {
  name: string;
  required: boolean;
  doc: string;
  list: boolean;
  values: string[] | null;
}

export interface AthenaActionWire {
  id: string;
  doc: string;
  params: AthenaActionWireParam[];
}

/**
 * The catalog as anything outside this module sees it — the prompt builder, the capability doc, and a
 * client that wants to explain what an Accept button will do. `summary` and `requiredRole` are NOT on
 * the wire: the first is a function, and the second is a server-side gate that a client restating
 * would turn into a second, drifting gating list.
 */
export function athenaActionWire(): AthenaActionWire[] {
  return SPECS.map((a) => ({
    id: a.id,
    doc: a.doc,
    params: a.params.map((p) => ({
      name: p.name,
      required: p.required,
      doc: p.doc,
      list: p.list === true,
      values: p.values ? [...p.values] : null,
    })),
  }));
}

/**
 * The one concrete illustration in the contract, built from the first spec that carries an example.
 * A generic placeholder fence would be safe but would teach nothing about what a good offer looks
 * like; taking a real one from the catalog keeps the teaching concrete AND keeps it true.
 */
function workedExample(): string {
  const withExample = SPECS.find((a) => a.example);
  if (!withExample) return "";
  const body = JSON.stringify({ action: withExample.id, params: withExample.example });
  return ["```athena:action", body, "```"].join("\n");
}

function paramLine(p: AthenaActionWireParam): string {
  const bits = [p.required ? "required" : "optional"];
  if (p.list) bits.push("array of strings");
  if (p.values) bits.push(`one of ${p.values.join(" | ")}`);
  return `    ${p.name} (${bits.join(", ")}) — ${p.doc}`;
}

/**
 * What the model is told it may propose. GENERATED from the array above, so an action that exists is
 * always taught and an action that is retired stops being taught in the same edit that retires it.
 *
 * Computed once at module load and byte-identical across turns, which is also what keeps a provider's
 * prompt cache warm — the same reason prompt.ts puts the identity and the contracts first.
 */
export const ATHENA_ACTION_CONTRACT = [
  `ACTIONS YOU MAY PROPOSE. You cannot change anything yourself. What you can do is OFFER an action, which appears to the operator as a card with an Accept and a Decline on it; nothing happens until a human clicks Accept. Propose one only when the conversation has actually arrived at it — an unasked-for card is noise, and a reply that is mostly buttons has stopped being a conversation. At most ${ATHENA_MAX_ACTIONS} per reply.`,
  `Emit a fenced JSON block, in the place the offer belongs:\n\n${workedExample()}`,
  `The actions this build carries:`,
  ...athenaActionWire().map((a) => `  ${a.id} — ${a.doc}\n${a.params.map(paramLine).join("\n")}`),
  `A block whose action is unknown, or which is missing a required parameter, is discarded rather than shown wrong — so say what you are offering in the prose above it, and never describe an action that is not in this list.`,
].join("\n\n");

// ── derivation 2: the validator ─────────────────────────────────────────────────────────────────

export interface AthenaAction {
  id: AthenaActionId;
  /** ONLY declared parameters. An undeclared key is dropped, never carried. */
  params: AthenaActionParamValues;
}

export type AthenaActionRefusal =
  | "malformed" // not a JSON object of the expected shape
  | "unknown_action" // this build does not carry that action
  | "missing_param" // a declared, required parameter was absent or empty
  | "bad_param"; // a declared parameter was the wrong shape or outside its declared value set

export type AthenaActionCoercion =
  | { ok: true; action: AthenaAction }
  | { ok: false; reason: AthenaActionRefusal; detail: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A scalar parameter is whatever the model put there, as text — the same latitude blocks.ts gives a
 *  cell. An object or an array where a scalar was declared is not text, and refuses the proposal. */
function scalarText(v: unknown): string | null {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  return null;
}

/**
 * THE VALIDATOR. Every presence and shape check below reads `spec.params` — there is no per-action
 * branch in this function, which is exactly what makes "adding a parameter extends prompt, validator
 * and executor in one edit" true rather than aspirational.
 *
 * UNDECLARED KEYS ARE DROPPED. A parameter nothing reads is a parameter that cannot be validated, and
 * carrying one into `payloadJson` would let a later executor start reading a field that was never
 * checked, never taught and never documented. It does not survive the door.
 *
 * Semantic validity is NOT checked here — that a snooze date is in the future, that a follow-up id
 * exists in this tenant. Those are execution-time facts (see the resolve route's header): a
 * proposal-time check is a claim, and everything interesting can change between the reply and the click.
 */
export function coerceAthenaAction(raw: unknown): AthenaActionCoercion {
  if (!isRecord(raw)) return { ok: false, reason: "malformed", detail: "Not a JSON object." };
  const id = raw.action;
  if (typeof id !== "string" || !id.trim()) {
    return { ok: false, reason: "malformed", detail: "No 'action' name." };
  }
  const spec = athenaActionSpec(id.trim());
  if (!spec) {
    return { ok: false, reason: "unknown_action", detail: `This build does not carry "${id.trim()}".` };
  }
  const given = isRecord(raw.params) ? raw.params : {};

  const params: AthenaActionParamValues = {};
  for (const p of spec.params) {
    const v = given[p.name];
    if (p.list) {
      // A lone string where a list was declared is unambiguous, so it is normalized rather than
      // refused — the one leniency here. Anything that is not a string or an array of them is not.
      const arr = typeof v === "string" ? [v] : Array.isArray(v) ? v : null;
      if (arr === null) {
        if (v === undefined || v === null) {
          if (p.required) return { ok: false, reason: "missing_param", detail: `Missing "${p.name}".` };
          continue;
        }
        return { ok: false, reason: "bad_param", detail: `"${p.name}" must be an array of strings.` };
      }
      const items: string[] = [];
      for (const item of arr) {
        const t = scalarText(item);
        if (t === null) return { ok: false, reason: "bad_param", detail: `"${p.name}" must be an array of strings.` };
        if (t) items.push(t);
      }
      if (items.length === 0) {
        if (p.required) return { ok: false, reason: "missing_param", detail: `"${p.name}" is empty.` };
        continue;
      }
      params[p.name] = items;
      continue;
    }

    if (v === undefined || v === null) {
      if (p.required) return { ok: false, reason: "missing_param", detail: `Missing "${p.name}".` };
      continue;
    }
    const t = scalarText(v);
    if (t === null) return { ok: false, reason: "bad_param", detail: `"${p.name}" must be text.` };
    if (!t) {
      if (p.required) return { ok: false, reason: "missing_param", detail: `"${p.name}" is empty.` };
      continue;
    }
    if (p.values && !p.values.includes(t)) {
      return { ok: false, reason: "bad_param", detail: `"${p.name}" must be one of ${p.values.join(", ")}.` };
    }
    params[p.name] = t;
  }

  return { ok: true, action: { id: spec.id as AthenaActionId, params } };
}

/** The sentence on the card, resolved at render time from the spec. Null when the action is retired. */
export function athenaActionSummary(id: string, params: AthenaActionParamValues): string | null {
  const spec = athenaActionSpec(id);
  if (!spec) return null;
  try {
    return clip(spec.summary(params).trim());
  } catch {
    return null;
  }
}

// ── the fence parser ────────────────────────────────────────────────────────────────────────────

/** Recognised, CLOSED fence. Anchored per-line, exactly as blocks.ts anchors its two. */
const ACTION_FENCE_RE = /^[ \t]*```athena:action[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
/** An OPENED fence with no close — what a completion cut off mid-block looks like. */
const OPEN_ACTION_FENCE_RE = /^[ \t]*```athena:action[ \t]*$/m;

export interface ParsedActions {
  /** The completion with every `athena:action` fence removed. Hand this to `parseAthenaBlocks`. */
  text: string;
  actions: AthenaAction[];
  /** Fences removed WHOLE because they did not validate — unknown action, bad shape, missing param. */
  dropped: number;
  /** Valid actions removed because the reply already carried {@link ATHENA_MAX_ACTIONS}. */
  overflow: number;
}

/**
 * Pull the action fences out of a completion.
 *
 * RUN THIS BEFORE `parseAthenaBlocks`. blocks.ts only consumes `athena:table` and `athena:chart`
 * fences; an action fence left in place would survive into the prose and be shown to the operator as
 * raw JSON. Both parsers then apply the same discipline to what they own, and the prose budget is
 * still applied last, by blocks.ts, over text that has no fences of either kind left in it.
 *
 * Never throws. A completion this cannot make sense of comes back unchanged, with no actions.
 */
export function parseAthenaActions(completion: string): ParsedActions {
  try {
    if (typeof completion !== "string" || completion.length === 0) {
      return { text: typeof completion === "string" ? completion : "", actions: [], dropped: 0, overflow: 0 };
    }

    const actions: AthenaAction[] = [];
    let dropped = 0;
    let overflow = 0;

    // Every CLOSED fence is consumed, valid or not — an invalid proposal must not survive as raw JSON
    // in the prose. Rebuilt rather than `.replace()`d so the parse result and the removal can never
    // disagree about which spans were fences. (blocks.ts, same reasoning, same shape.)
    ACTION_FENCE_RE.lastIndex = 0;
    let cursor = 0;
    let rest = "";
    for (let m = ACTION_FENCE_RE.exec(completion); m; m = ACTION_FENCE_RE.exec(completion)) {
      rest += completion.slice(cursor, m.index);
      cursor = m.index + m[0].length;
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(m[1] ?? "");
      } catch {
        dropped += 1;
        continue;
      }
      const coerced = coerceAthenaAction(parsedBody);
      if (!coerced.ok) {
        dropped += 1;
        continue;
      }
      if (actions.length >= ATHENA_MAX_ACTIONS) {
        overflow += 1;
        continue;
      }
      actions.push(coerced.action);
    }
    rest += completion.slice(cursor);

    // An OPEN fence with no close is what a completion truncated mid-block looks like. Everything from
    // it to the end is debris, not prose, so it is cut and counted as a drop.
    const open = OPEN_ACTION_FENCE_RE.exec(rest);
    if (open) {
      rest = rest.slice(0, open.index);
      dropped += 1;
    }

    return { text: rest, actions, dropped, overflow };
  } catch {
    // Losing the proposals is a degraded answer; losing the prose is no answer at all.
    return { text: typeof completion === "string" ? completion : "", actions: [], dropped: 0, overflow: 0 };
  }
}

/** The payload a raised proposal carries. `summary` is NOT stored — it is resolved from the spec at
 *  render time, so a wording change reaches every card ever raised rather than only the next one. */
export function athenaActionPayload(action: AthenaAction): Record<string, unknown> {
  return { params: action.params };
}

/** The params back out of a stored payload, for re-validation at resolve time. */
export function payloadParams(payload: Record<string, unknown>): unknown {
  return isRecord(payload.params) ? payload.params : {};
}
