// THE CATALOG'S DERIVATIONS, PINNED.
//
// The failure this file exists to catch is not a crash — it is ASYMMETRY. A kind the prompt teaches
// and the validator rejects; a kind the validator accepts and no executor performs; a parameter the
// executor requires and the prompt never mentions. Each half is individually correct, so nothing
// throws and nothing logs; the model is simply blamed for hallucinating a capability it was taught.
//
// So the assertions here are about AGREEMENT rather than behaviour: SET EQUALITY between the wire
// catalog and the executor table, and the declared value sets checked against the stores that are the
// real authority on them.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";

// The executor table pulls in the db layer; the client is the one module that must not be real for an
// import to be cheap. Nothing below calls an executor — this file is about the catalog's shape.
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({}) }));

import {
  ATHENA_ACTIONS,
  ATHENA_ACTION_CONTRACT,
  ATHENA_ACTION_IDS,
  ATHENA_MAX_ACTIONS,
  athenaActionSpec,
  athenaActionSummary,
  athenaActionWire,
  coerceAthenaAction,
  parseAthenaActions,
} from "@/lib/athena/actions";
import { ATHENA_ACTION_EXECUTORS } from "@/lib/athena/actions-execute";
import { isDecisionModule, isDecisionStatus } from "@/lib/db/org-decisions";
import { isOrgRole } from "@/lib/db/members";

const F = "```";
const fence = (body: string) => `${F}athena:action\n${body}\n${F}`;

/** The doc section this catalog governs, found by marker so a file move cannot switch the check off. */
const DOC_MARKER = "<!-- athena-actions -->";
const CAPABILITY_HEADING = "### What this build carries";

const wireFor = (id: string) => athenaActionWire().find((a) => a.id === id)!;
const paramOf = (id: string, name: string) => wireFor(id).params.find((p) => p.name === name)!;

describe("ONE array, four derivations", () => {
  it("the wire catalog and the executors carry the EXACT same id set", () => {
    // Set equality, not a spot check. An executor with no spec is an action the prompt never teaches
    // and the validator always rejects; a spec with no executor is an Accept button that cannot work.
    const wire = new Set(athenaActionWire().map((a) => a.id));
    const executors = new Set(Object.keys(ATHENA_ACTION_EXECUTORS));
    expect([...wire].sort()).toEqual([...executors].sort());
    expect([...wire].sort()).toEqual([...ATHENA_ACTION_IDS].sort());
  });

  it("teaches every action it carries, with every declared parameter", () => {
    for (const a of athenaActionWire()) {
      expect(ATHENA_ACTION_CONTRACT).toContain(a.id);
      expect(ATHENA_ACTION_CONTRACT).toContain(a.doc);
      for (const p of a.params) {
        expect(ATHENA_ACTION_CONTRACT).toContain(p.name);
        expect(ATHENA_ACTION_CONTRACT).toContain(p.doc);
        // A closed value set the prompt does not state is a set the model can only guess at.
        for (const v of p.values ?? []) expect(ATHENA_ACTION_CONTRACT).toContain(v);
      }
    }
    expect(ATHENA_ACTION_CONTRACT).toContain(String(ATHENA_MAX_ACTIONS));
  });

  it("the worked example it teaches is one the validator actually accepts", () => {
    // The contract's one concrete illustration is the thing a model copies most literally. If it
    // does not round-trip through `coerceAthenaAction`, every reply that follows it is dropped —
    // and the drop is counted against the model rather than against the example that taught it.
    const parsed = parseAthenaActions(ATHENA_ACTION_CONTRACT);
    expect(parsed.actions).toHaveLength(1);
    expect(parsed.dropped).toBe(0);
    expect(ATHENA_ACTION_IDS).toContain(parsed.actions[0].id);
  });

  it("gates on a real role, from the spec and nowhere else", () => {
    for (const spec of ATHENA_ACTIONS) expect(isOrgRole(spec.requiredRole)).toBe(true);
    // requiredRole is deliberately NOT on the wire: a client restating it is a second gating list.
    for (const a of athenaActionWire()) expect(a).not.toHaveProperty("requiredRole");
  });

  it("the capability doc lists exactly the actions this build carries", () => {
    // The doc's capability table is CHECKED against the catalog rather than maintained beside it: a doc
    // that confidently asserts a limitation the code has since removed does more damage than no doc at
    // all (docs/DOC-DRIFT.md). The section is located by its MARKER rather than by filename, so this
    // check survives the prose being merged into another file in the same directory.
    const dir = join(process.cwd(), "docs", "features", "companion");
    const docs = readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((t) => t.includes(DOC_MARKER));
    expect(docs, `no companion doc carries ${DOC_MARKER}`).toHaveLength(1);

    // The capability table, and only it: from its heading to the next one.
    const section = docs[0].split(CAPABILITY_HEADING)[1] ?? "";
    const table = section.split(/^#{2,3} /m)[0] ?? "";
    const rows = table
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("| `"))
      .map((l) => l.split("|")[1].trim().replace(/`/g, ""));

    // Set equality in BOTH directions: an undocumented action fails, and so does a documented one the
    // catalog has retired — which is the half a periodic docs pass reliably misses.
    expect(rows.sort()).toEqual([...ATHENA_ACTION_IDS].sort());
  });

  it("declares only value sets the stores actually accept", () => {
    // The catalog is pure (it cannot import the decision store), so this is the join that keeps its
    // declared values and the store's own predicates from drifting apart unnoticed.
    for (const v of paramOf("rule_on_finding", "module").values ?? []) {
      expect(isDecisionModule(v)).toBe(true);
    }
    for (const v of paramOf("rule_on_finding", "ruling").values ?? []) {
      expect(isDecisionStatus(v)).toBe(true);
    }
    // Reopening is not something she offers.
    expect(paramOf("rule_on_finding", "ruling").values).not.toContain("open");
  });
});

describe("coerceAthenaAction — the validator derives from the declared params", () => {
  const ruling = {
    action: "rule_on_finding",
    params: { module: "security", itemKey: "acme/api::bp", ruling: "dismissed", rationale: "mirror" },
  };

  it("accepts a well-formed action", () => {
    const r = coerceAthenaAction(ruling);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action).toEqual({ id: "rule_on_finding", params: ruling.params });
  });

  it("REFUSES an unknown action id", () => {
    const r = coerceAthenaAction({ action: "delete_the_org", params: {} });
    expect(r).toMatchObject({ ok: false, reason: "unknown_action" });
  });

  it("REFUSES a missing required param", () => {
    const rest = { module: ruling.params.module, itemKey: ruling.params.itemKey, ruling: ruling.params.ruling };
    const r = coerceAthenaAction({ action: "rule_on_finding", params: rest });
    expect(r).toMatchObject({ ok: false, reason: "missing_param" });
    if (!r.ok) expect(r.detail).toContain("rationale");
  });

  it("REFUSES a required param that is present but empty", () => {
    const r = coerceAthenaAction({ action: "rule_on_finding", params: { ...ruling.params, itemKey: "   " } });
    expect(r).toMatchObject({ ok: false, reason: "missing_param" });
  });

  it("REFUSES a value outside the declared set", () => {
    const r = coerceAthenaAction({ action: "rule_on_finding", params: { ...ruling.params, ruling: "deleted" } });
    expect(r).toMatchObject({ ok: false, reason: "bad_param" });
  });

  it("DROPS an undeclared param — a field nothing reads cannot be validated", () => {
    const r = coerceAthenaAction({
      action: "rule_on_finding",
      params: { ...ruling.params, sudo: true, target: { org: "someone-else" } },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action.params).not.toHaveProperty("sudo");
      expect(r.action.params).not.toHaveProperty("target");
      expect(Object.keys(r.action.params).sort()).toEqual(["itemKey", "module", "rationale", "ruling"]);
    }
  });

  it("keeps an optional param when given and omits it when not", () => {
    const withTitle = coerceAthenaAction({
      action: "rule_on_finding",
      params: { ...ruling.params, title: "Branch protection" },
    });
    expect(withTitle.ok && withTitle.action.params.title).toBe("Branch protection");
    const without = coerceAthenaAction(ruling);
    expect(without.ok && without.action.params).not.toHaveProperty("title");
  });

  it("handles a list param: array kept, lone string normalized, object refused", () => {
    const arr = coerceAthenaAction({ action: "handoff_followups", params: { ids: ["a", "b"] } });
    expect(arr.ok && arr.action.params.ids).toEqual(["a", "b"]);
    const lone = coerceAthenaAction({ action: "handoff_followups", params: { ids: "a" } });
    expect(lone.ok && lone.action.params.ids).toEqual(["a"]);
    const bad = coerceAthenaAction({ action: "handoff_followups", params: { ids: { a: 1 } } });
    expect(bad).toMatchObject({ ok: false, reason: "bad_param" });
    const empty = coerceAthenaAction({ action: "handoff_followups", params: { ids: [] } });
    expect(empty).toMatchObject({ ok: false, reason: "missing_param" });
  });

  it("refuses anything that is not an object with an action name", () => {
    for (const raw of [null, "rule_on_finding", 7, [], {}, { action: "" }]) {
      expect(coerceAthenaAction(raw).ok).toBe(false);
    }
  });
});

describe("the summary is resolved from the spec, never stored", () => {
  it("renders a card line for each action", () => {
    expect(athenaActionSummary("handoff_followups", { ids: ["a", "b", "c"] })).toBe(
      "Claim 3 follow-up items as in progress",
    );
    expect(athenaActionSummary("handoff_followups", { ids: ["a"] })).toBe("Claim 1 follow-up item as in progress");
    expect(
      athenaActionSummary("rule_on_finding", { module: "security", itemKey: "k", ruling: "dismissed" }),
    ).toBe("Dismiss k (security)");
  });

  it("returns null for a retired action rather than inventing a line", () => {
    expect(athenaActionSummary("gone", {})).toBeNull();
    expect(athenaActionSpec("gone")).toBeNull();
  });
});

describe("parseAthenaActions — blocks.ts's discipline, applied to offers", () => {
  it("lifts a valid fence out of the prose and leaves the prose behind", () => {
    const body = JSON.stringify({ action: "handoff_followups", params: { ids: ["r1"] } });
    const r = parseAthenaActions(`Three gaps are worth taking on.\n\n${fence(body)}\n\nSay the word.`);
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toEqual({ id: "handoff_followups", params: { ids: ["r1"] } });
    expect(r.text).not.toContain("athena:action");
    expect(r.text).not.toContain("handoff_followups");
    expect(r.text).toContain("Three gaps are worth taking on.");
    expect(r.dropped).toBe(0);
  });

  it("DROPS a structurally wrong fence WHOLE and counts it — and never leaves its JSON in the prose", () => {
    const r = parseAthenaActions(`Here.\n\n${fence('{"action":"nope","params":{}}')}`);
    expect(r.actions).toHaveLength(0);
    expect(r.dropped).toBe(1);
    expect(r.text).not.toContain("nope");
  });

  it("drops unparseable JSON without throwing", () => {
    const r = parseAthenaActions(fence("{not json"));
    expect(r).toMatchObject({ actions: [], dropped: 1 });
  });

  it(`keeps at most ${ATHENA_MAX_ACTIONS} and counts the rest as overflow`, () => {
    const body = JSON.stringify({ action: "handoff_followups", params: { ids: ["r1"] } });
    const r = parseAthenaActions([fence(body), fence(body), fence(body)].join("\n\n"));
    expect(r.actions).toHaveLength(ATHENA_MAX_ACTIONS);
    expect(r.overflow).toBe(1);
    expect(r.dropped).toBe(0);
  });

  it("cuts an UNCLOSED fence and everything after it, and counts the drop", () => {
    const r = parseAthenaActions('Answer.\n\n```athena:action\n{"action":"handoff_followups"');
    expect(r.actions).toHaveLength(0);
    expect(r.dropped).toBe(1);
    expect(r.text.trim()).toBe("Answer.");
  });

  it("leaves table and chart fences entirely alone — they belong to blocks.ts", () => {
    const chart = `${F}athena:chart\n{"labels":["a"],"series":[{"name":"s","values":[1]}]}\n${F}`;
    const r = parseAthenaActions(`Prose.\n\n${chart}`);
    expect(r.text).toContain("athena:chart");
    expect(r.actions).toHaveLength(0);
    expect(r.dropped).toBe(0);
  });

  it("never throws on junk", () => {
    for (const junk of ["", "no fences here"]) {
      expect(() => parseAthenaActions(junk)).not.toThrow();
    }
    expect(parseAthenaActions(undefined as unknown as string)).toMatchObject({ actions: [], dropped: 0 });
  });
});
