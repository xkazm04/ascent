// THE PLAN CONTRACT'S READER — fail closed on everything that is not exactly the contract, because
// null classifies the whole plan major-unreadable and anything else lets a malformed plan through.

import { describe, expect, it } from "vitest";
import { PLAN_BOUNDS, lastJsonBlock, parsePlan } from "./lane-plan-parse";

const base = () => ({
  v: 1,
  intent: "Wire the retry budget into the fetch layer.",
  items: [{ recommendationId: "rec-1", approach: "Add a bounded retry.", files: ["src/lib/fetch.ts"], moves: [] as unknown[] }],
  modules: ["src/lib/"],
  check: "npm test -- fetch",
  risks: ["retry storms"],
  notDoing: ["no circuit breaker"],
});
const fenced = (v: unknown) => `Here is my plan.\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\`\n`;
const withMoves = (moves: unknown[]) => {
  const p = base();
  p.items[0]!.moves = moves;
  return fenced(p);
};

describe("parsePlan — accepts exactly the contract", () => {
  it("parses a well-formed plan, trimming strings", () => {
    const p = base();
    p.intent = "  padded intent  ";
    expect(parsePlan(fenced(p))).toEqual({ ...base(), intent: "padded intent" });
  });

  it("reads the LAST json block, never an earlier draft", () => {
    const draft = { ...base(), intent: "draft" };
    const final = { ...base(), intent: "final" };
    expect(parsePlan(`${fenced(draft)}\nOn reflection:\n${fenced(final)}`)?.intent).toBe("final");
    expect(lastJsonBlock("```ts\nnot json\n```")).toBeNull();
  });

  it("accepts every move kind with the endpoints it needs, and absent risks/notDoing as empty", () => {
    const moves = [
      { kind: "module-created", from: null, to: "src/lib/new/" },
      { kind: "module-removed", from: "src/lib/old/", to: null },
      { kind: "module-split", from: "src/lib/big/", to: "src/lib/a/" },
      { kind: "module-merged", from: "src/lib/x/", to: "src/lib/xy/" },
      { kind: "cross-module-move", from: "src/lib/db/", to: "src/lib/local/" },
    ];
    expect(parsePlan(withMoves(moves))?.items[0]!.moves).toEqual(moves);
    const p: Record<string, unknown> = base();
    delete p.risks;
    delete p.notDoing;
    expect(parsePlan(fenced(p))).toMatchObject({ risks: [], notDoing: [] });
  });

  it("caps string lengths instead of refusing a verbose plan", () => {
    const p = base();
    p.intent = "x".repeat(900);
    expect(parsePlan(fenced(p))?.intent).toHaveLength(PLAN_BOUNDS.intent);
  });
});

describe("parsePlan — null on anything else", () => {
  const over = (n: number, mk: (i: number) => unknown) => Array.from({ length: n }, (_, i) => mk(i));
  const cases: [string, string][] = [
    ["no text", ""],
    ["no fenced block", JSON.stringify(base())],
    ["an unclosed block", "```json\n{\"v\":1"],
    ["invalid JSON", "```json\n{v:1}\n```"],
    ["the wrong version", fenced({ ...base(), v: 2 })],
    ["a string version", fenced({ ...base(), v: "1" })],
    ["an empty intent", fenced({ ...base(), intent: "   " })],
    ["no check", fenced({ ...base(), check: undefined })],
    ["no items", fenced({ ...base(), items: [] })],
    ["items not an array", fenced({ ...base(), items: { a: 1 } })],
    ["too many items", fenced({ ...base(), items: over(21, (i) => ({ recommendationId: `r${i}`, approach: "a", files: [], moves: [] })) })],
    ["a duplicate item id", fenced({ ...base(), items: [base().items[0], base().items[0]] })],
    ["an item without moves", fenced({ ...base(), items: [{ recommendationId: "r", approach: "a", files: [] }] })],
    ["too many files", fenced({ ...base(), items: [{ recommendationId: "r", approach: "a", files: over(41, (i) => `f${i}.ts`), moves: [] }] })],
    ["too many moves", withMoves(over(11, (i) => ({ kind: "module-created", from: null, to: `m${i}/` })))],
    ["an UNKNOWN move kind (never silently dropped)", withMoves([{ kind: "module-created", to: "a/" }, { kind: "module-renamed", from: "a/", to: "b/" }])],
    ["a move missing its required end", withMoves([{ kind: "cross-module-move", from: "a/", to: null }])],
    ["a created move with no target", withMoves([{ kind: "module-created", from: "a/" }])],
    ["a path escaping the repo", withMoves([{ kind: "module-created", to: "../outside/" }])],
    ["a file escaping the repo", fenced({ ...base(), items: [{ recommendationId: "r", approach: "a", files: ["src/../../etc/passwd"], moves: [] }] })],
    ["a non-string module", fenced({ ...base(), modules: ["src/", 7] })],
    ["too many modules", fenced({ ...base(), modules: over(41, (i) => `m${i}/`) })],
    ["risks of the wrong type", fenced({ ...base(), risks: "none" })],
    ["a top-level array", "```json\n[1,2]\n```"],
    ["a JSON null", "```json\nnull\n```"],
    ["an oversize block", `\`\`\`json\n{"v":1,"pad":"${"x".repeat(PLAN_BOUNDS.block)}"}\n\`\`\``],
  ];
  it.each(cases)("%s", (_name, text) => {
    expect(parsePlan(text)).toBeNull();
  });

  it("strips control characters from strings", () => {
    const p = base();
    p.intent = `evil${String.fromCharCode(0, 27)}[31m intent`;
    expect(parsePlan(fenced(p))?.intent).toBe("evil[31m intent");
  });
});
