// The Enforce-in-CI chain, end to end: describeGatePolicy's `ci` line -> an `action.yml` input -> the
// composite step's env var -> a `scripts/maturity-gate.mjs` flag -> a gate-URL param -> the policy
// explicitPolicyFromParams parses back. Every hop is a separate file, and this action runs in
// CUSTOMER CI, so a `ci` key the action does not declare is a snippet an owner pastes and GitHub
// rejects ("Unexpected input"), and an input the step forgets to forward is a floor that silently
// never reaches the gate. Backlog develop-2026-09-17 row 8 added min-d1..min-d8 to this chain.
//
// action.yml is scanned as TEXT (the repo has no YAML dependency). Full-line `#` comments are
// stripped before matching, so a mapping that survives only as a comment does not count; the
// "seeded" case below proves the matcher still bites.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { describeGatePolicy, explicitPolicyFromParams, type GatePolicy } from "@/lib/scoring/gate";
import { DIMENSION_BY_ID } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
// @ts-expect-error — a plain .mjs CLI with no type declarations; the shape is asserted below.
import { gateQueryFromArgv } from "../../../scripts/maturity-gate.mjs";

const RAW = readFileSync(new URL("../../../action.yml", import.meta.url), "utf8");

const stripComments = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

interface ActionShape {
  inputs: Map<string, string | undefined>; // input -> its default
  env: Map<string, string>; // INPUT_X -> input name
  valueFlags: Map<string, string>; // INPUT_X -> --flag (forwarded with its value when non-empty)
  boolFlags: Map<string, string>; // INPUT_X -> --flag (forwarded bare when "true")
  runBody: string;
}

function parseAction(text: string): ActionShape {
  const src = stripComments(text);
  const inputsBlock = src.slice(src.indexOf("\ninputs:\n"), src.indexOf("\noutputs:\n"));
  const inputs = new Map<string, string | undefined>();
  let current: string | null = null;
  for (const line of inputsBlock.split("\n")) {
    const name = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (name) {
      current = name[1];
      inputs.set(current, undefined);
      continue;
    }
    const def = /^ {4}default:\s*"(.*)"\s*$/.exec(line);
    if (def && current) inputs.set(current, def[1]);
  }
  const env = new Map<string, string>();
  for (const m of src.matchAll(/^\s+(INPUT_[A-Z0-9_]+): \$\{\{ inputs\.([a-z0-9-]+) \}\}\s*$/gm)) env.set(m[1], m[2]);
  const valueFlags = new Map<string, string>();
  for (const m of src.matchAll(/if \[ -n "\$(INPUT_[A-Z0-9_]+)" \]; then ARGS\+=\((--[a-z0-9-]+) "\$(INPUT_[A-Z0-9_]+)"\); fi/g)) {
    if (m[1] === m[3]) valueFlags.set(m[1], m[2]);
  }
  const boolFlags = new Map<string, string>();
  for (const m of src.matchAll(/if \[ "\$(INPUT_[A-Z0-9_]+)" = "true" \]; then ARGS\+=\((--[a-z0-9-]+)\); fi/g)) boolFlags.set(m[1], m[2]);
  const runBody = src.slice(src.indexOf("run: |"));
  return { inputs, env, valueFlags, boolFlags, runBody };
}

/** The argv the action's step would hand the CLI for one `with:` line, or a reason it cannot. */
function argvFor(shape: ActionShape, ciLine: string): string[] | string {
  const m = /^([a-z0-9-]+): '?([^']*)'?$/.exec(ciLine);
  if (!m) return `unparseable ci line ${ciLine}`;
  const [, key, value] = m;
  if (!shape.inputs.has(key)) return `action.yml declares no input "${key}"`;
  const envVar = [...shape.env].find(([, input]) => input === key)?.[0];
  if (!envVar) return `input "${key}" is never passed to the step through env:`;
  const vf = shape.valueFlags.get(envVar);
  if (vf) return ["owner/repo", vf, value];
  const bf = shape.boolFlags.get(envVar);
  if (bf && value === "true") return ["owner/repo", bf];
  return `${envVar} is never forwarded to the CLI`;
}

/** A policy with every field that has a CI projection set, including a floor on each of D1..D9. */
const EVERY_CI_FIELD: GatePolicy = {
  minLevel: "L3",
  minOverall: 60,
  minDimension: 30,
  minDimensionFor: { D1: 41, D2: 50, D3: 43, D4: 44, D5: 45, D6: 46, D7: 47, D8: 48, D9: 70 },
  forbidPostures: ["ungoverned"],
  requireProtectedBranch: true,
  minAiGovernedRate: 90,
};

describe("action.yml carries every `ci` line describeGatePolicy emits", () => {
  const shape = parseAction(RAW);
  const ciLines = describeGatePolicy(EVERY_CI_FIELD).flatMap((c) => (c.ci ? [c.ci] : []));

  // Governance's CI snippet drops require-protection / min-ai-governed (the token-less endpoint 503s on
  // them), but describeGatePolicy still emits them and the action keeps the inputs, so this pin holds.
  it("emits a ci line for all nine per-dimension floors", () => {
    for (let i = 1; i <= 8; i++) expect(ciLines).toContain(`min-d${i}: '${EVERY_CI_FIELD.minDimensionFor![`D${i}` as "D1"]}'`);
    expect(ciLines).toContain("min-security: '70'");
  });

  it.each(ciLines)("%s reaches the gate URL and parses back to the same condition", (ciLine) => {
    const argv = argvFor(shape, ciLine);
    expect(typeof argv === "string" ? argv : "ok").toBe("ok");
    const query: URLSearchParams = gateQueryFromArgv(argv as string[]);
    const back = describeGatePolicy(explicitPolicyFromParams(query)).map((c) => c.ci);
    expect(back).toContain(ciLine);
  });

  it("forwards the PR head SHA (then github.sha) when ref is empty, never the default branch", () => {
    // The step env, not the input default, resolves ref; an empty INPUT_REF would score the default branch.
    const refEnv = /^\s+INPUT_REF: (.*)$/m.exec(stripComments(RAW))?.[1] ?? "";
    expect(refEnv).toContain("inputs.ref");
    expect(refEnv).toContain("github.event.pull_request.head.sha");
    expect(refEnv).toContain("github.sha");
    expect(refEnv.indexOf("inputs.ref")).toBeLessThan(refEnv.indexOf("github.event.pull_request.head.sha"));
    expect(refEnv.indexOf("github.event.pull_request.head.sha")).toBeLessThan(refEnv.indexOf("github.sha }}"));
  });

  it("guard: every new floor input defaults to empty, so a workflow that omits it forwards nothing", () => {
    for (let i = 1; i <= 8; i++) expect(shape.inputs.get(`min-d${i}`)).toBe("");
  });

  it("names each min-d<N> input's dimension as the model does (the Marketplace page is the only help text)", () => {
    for (let i = 1; i <= 8; i++) {
      const dim = `D${i}` as DimensionId;
      expect(RAW).toContain(`Minimum ${dim} (${DIMENSION_BY_ID[dim].name}) dimension score.`);
    }
  });

  it("guard: no input is interpolated into the run: body (inputs reach the script only via env)", () => {
    expect(shape.runBody).not.toMatch(/\$\{\{\s*inputs\./);
  });

  it("seeded: a forward that survives only as a comment is not counted (the matcher still bites)", () => {
    const seeded = RAW.replace(
      /^(\s*)(if \[ -n "\$INPUT_MIN_D2" \].*)$/m,
      (_all, indent: string, line: string) => `${indent}# ${line}`,
    );
    expect(seeded).not.toBe(RAW);
    expect(argvFor(parseAction(seeded), "min-d2: '50'")).toBe("INPUT_MIN_D2 is never forwarded to the CLI");
  });
});

describe("maturity-gate CLI: flags to gate-URL params", () => {
  it("forwards --min-d<N> as min_d<N>", () => {
    const q: URLSearchParams = gateQueryFromArgv(["o/r", "--min-d2", "50", "--min-d8", "35"]);
    expect(q.get("min_d2")).toBe("50");
    expect(q.get("min_d8")).toBe("35");
    expect(explicitPolicyFromParams(q).minDimensionFor).toEqual({ D2: 50, D8: 35 });
  });

  it("does not invent a min_d9: D9 is min-security only", () => {
    expect(gateQueryFromArgv(["o/r", "--min-d9", "50"]).toString()).toBe("");
  });

  it("guard: an old caller's flags produce the byte-identical query they always did", () => {
    const argv = [
      "o/r", "--min-level", "L3", "--min-overall", "60", "--min-dimension", "40", "--min-security", "50",
      "--no-ungoverned", "--require-protection", "--min-ai-governed", "90", "--live", "--ref", "abc",
    ];
    expect(gateQueryFromArgv(argv).toString()).toBe(
      "min_level=L3&min_overall=60&min_dimension=40&min_security=50&no_ungoverned=1&require_protection=1&min_ai_governed=90&mock=0&ref=abc",
    );
    expect(gateQueryFromArgv(["o/r"]).toString()).toBe("");
    expect(gateQueryFromArgv(["o/r", "--no-ungoverned-ai"]).toString()).toBe("no_ungoverned_ai=1");
  });
});
