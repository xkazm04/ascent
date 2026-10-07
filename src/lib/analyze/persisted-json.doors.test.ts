// The four pure persisted-blob parsers each keep their documented degraded value AND log real damage.
//
//   parseContextHealthJson  (context-health-read.ts:43-52) → null       "unassessed"
//   parseGuidanceGraphJson  (guidance-graph.ts:536-555)    → null       "not assessed"
//   parsePlatformSignals    (platform-carry.ts:221-256)    → undefined  "unknown"
//   parseTechStackJson      (tech-extract.ts:276-289)      → null       "no tech"
//
// Every column these read was written by JSON.stringify, so text that is not JSON is DAMAGE — and the
// only thing that tells it apart from "never set" is the console.warn this pins. Two non-damage inputs
// must stay quiet: an empty column (never written) and valid JSON of the wrong shape (a legacy / older
// version — the shape guards' job, not an error). These modules are browser-safe and feed client
// projections, so their door is a LOG ONLY: they must never reach server telemetry (reportHandledError).

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  reportHandledError: vi.fn(),
}));

import { reportHandledError } from "@/lib/api/respond";
import { parseContextHealthJson } from "./context-health-read";
import { parseGuidanceGraphJson } from "./guidance-graph";
import { parsePlatformSignals } from "./platform-carry";
import { parseTechStackJson } from "./tech-extract";

type Parser = (raw: string | null | undefined) => unknown;

interface Case {
  name: string;
  parse: Parser;
  /** The documented degraded value (null or undefined). */
  degraded: null | undefined;
  /** The log prefix + column the warning must name. */
  tag: string;
  /** Valid JSON that the shape guard refuses — not damage, so no warning. */
  wrongShape: string[];
  /** A well-formed blob the parser accepts (control: a good read never warns). */
  valid: string;
}

const CASES: Case[] = [
  {
    name: "parseContextHealthJson",
    parse: parseContextHealthJson,
    degraded: null,
    tag: "[context-health] persisted contextHealthJson unreadable",
    wrongShape: ['{"a":1}', "[]", '{"version":"1","present":true,"score":500,"files":[]}'],
    valid: JSON.stringify({
      version: "1",
      present: true,
      score: 80,
      files: [{ path: "CLAUDE.md", sectionsScore: 70 }],
      freshness: { score: 90, ageDays: 3, commitsSinceEdit: 2, approximate: false },
      quality: { score: 75, signals: ["has-commands"] },
      drift: { score: 100, refsTotal: 4, deadRefs: [] },
    }),
  },
  {
    name: "parseGuidanceGraphJson",
    parse: parseGuidanceGraphJson,
    degraded: null,
    tag: "[guidance-graph] persisted guidanceGraphJson unreadable",
    wrongShape: ['{"version":"2","nodes":[]}', "null", '{"version":"1","nodes":{}}'],
    valid: JSON.stringify({ version: "1", nodes: [], edges: [] }),
  },
  {
    name: "parsePlatformSignals",
    parse: parsePlatformSignals,
    degraded: undefined,
    tag: "[platform-carry] persisted platform-signal record unreadable",
    wrongShape: ['{"source":"bogus"}', "5", "null"],
    valid: JSON.stringify({ source: "observed", observedAt: "2026-06-01T00:00:00.000Z", dims: [] }),
  },
  {
    name: "parseTechStackJson",
    parse: parseTechStackJson,
    degraded: null,
    tag: "[tech-extract] persisted techStackJson unreadable",
    wrongShape: ['{"languages":["TypeScript"]}', "[]", "null"],
    valid: JSON.stringify({ languages: ["TypeScript"], frameworks: [], roles: ["frontend"], confidence: 0.8 }),
  },
];

let warn: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe.each(CASES)("$name — persisted-blob door", (c) => {
  it("malformed JSON returns the documented degraded value AND warns naming the column", () => {
    for (const bad of ["{not json", '{"roles":["frontend"]', "undefined"]) {
      warn.mockClear();
      expect(c.parse(bad)).toBe(c.degraded);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(c.tag);
    }
  });

  it("the door is a LOG only — telemetry is never reached from a pure parser", () => {
    c.parse("{not json");
    expect(warn).toHaveBeenCalled();
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("valid JSON of the wrong shape degrades WITHOUT a warning (a guard's job, not damage)", () => {
    for (const shape of c.wrongShape) expect(c.parse(shape)).toBe(c.degraded);
    expect(warn).not.toHaveBeenCalled();
  });

  it("an empty / absent column degrades WITHOUT a warning (never written is not damage)", () => {
    for (const empty of ["", null, undefined]) expect(c.parse(empty)).toBe(c.degraded);
    expect(warn).not.toHaveBeenCalled();
  });

  it("control: a well-formed blob parses and does not warn", () => {
    expect(c.parse(c.valid)).not.toBe(c.degraded);
    expect(c.parse(c.valid)).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
  });
});
