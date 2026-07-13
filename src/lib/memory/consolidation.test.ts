// Tests for the Shared Org Memory write-intelligence core. No CLI is ever spawned: `runPrompt` is
// injected, which is the point of keeping this module framework- and provider-free (design doc §5).
//
// The load-bearing guarantees pinned here:
//   - the overlap coefficient catches a SHORT correction of a LONG memory (where Jaccard would not);
//   - the shortlist bounds what reaches the model (floor + cap);
//   - parseVerdict DROPS an id the model invented — that id would otherwise flow into `supersedeId`
//     and aim a correction at an arbitrary row;
//   - a supersede/duplicate verdict with nothing left to act on is downgraded to "novel";
//   - every failure mode (no LLM, throw, timeout, prose instead of JSON) degrades to the deterministic
//     verdict and NEVER blocks the author.

import { describe, it, expect, vi } from "vitest";
import {
  analyzeWrite,
  buildConsolidationPrompt,
  heuristicVerdict,
  overlapScore,
  parseVerdict,
  shortlist,
  tokenize,
  type MemoryCandidate,
} from "@/lib/memory/consolidation";

const mem = (id: string, content: string, kind = "semantic", confidence = 1): MemoryCandidate => ({
  id,
  content,
  kind,
  confidence,
});

describe("tokenize", () => {
  it("lowercases, strips punctuation, drops stopwords and 1-char noise", () => {
    expect(tokenize("The auth flow, and a X!")).toEqual(["auth", "flow"]);
  });
  it("keeps hyphenated and numeric tokens", () => {
    expect(tokenize("claude-cli uses oauth2")).toEqual(["claude-cli", "uses", "oauth2"]);
  });
});

describe("overlapScore", () => {
  it("is 1 for identical content", () => {
    expect(overlapScore("we use supabase oauth", "we use supabase oauth")).toBe(1);
  });

  it("scores a SHORT correction highly against the LONG memory it corrects (why not Jaccard)", () => {
    const long =
      "The team decided to use a custom GitHub OAuth flow implemented by hand in the auth module, " +
      "with sessions persisted in Postgres and refreshed by the proxy on every request.";
    const short = "custom GitHub OAuth flow";
    // Every meaningful token of the short memory appears in the long one → overlap 1.0.
    expect(overlapScore(short, long)).toBe(1);
  });

  it("is 0 when either side has no meaningful tokens", () => {
    expect(overlapScore("the a of", "supabase oauth")).toBe(0);
    expect(overlapScore("", "anything")).toBe(0);
  });

  it("is near 0 for unrelated content", () => {
    expect(overlapScore("postgres vacuum tuning", "the kubernetes ingress cert")).toBe(0);
  });
});

describe("shortlist — bounds what reaches the model", () => {
  it("drops candidates under the noise floor and ranks the rest strongest-first", () => {
    const out = shortlist("supabase oauth login wall", [
      mem("m1", "kubernetes ingress certificate rotation"), // unrelated → filtered
      mem("m2", "supabase oauth login wall"), //                identical  → 1.0
      mem("m3", "the oauth login flow"), //                     partial
    ]);
    expect(out.map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(out[0]!.similarity).toBe(1);
    expect(out[0]!.similarity).toBeGreaterThan(out[1]!.similarity);
  });

  it("caps the shortlist at 6 no matter how large the store is", () => {
    const many = Array.from({ length: 40 }, (_, i) => mem(`m${i}`, "supabase oauth login wall"));
    expect(shortlist("supabase oauth login wall", many)).toHaveLength(6);
  });

  it("returns [] when nothing clears the floor", () => {
    expect(shortlist("postgres vacuum", [mem("m1", "kubernetes ingress")])).toEqual([]);
  });
});

describe("buildConsolidationPrompt", () => {
  const input = {
    content: "We moved to Supabase OAuth.",
    kind: "semantic",
    namespace: "auth",
    candidates: [mem("m1", "x".repeat(2000))],
  };

  it("includes only the shortlisted ids and truncates long excerpts", () => {
    const matches = [{ id: "m1", similarity: 0.9, relation: "refines" as const, reason: "r" }];
    const p = buildConsolidationPrompt(input, matches);
    expect(p).toContain("id=m1");
    expect(p).toContain("…[truncated]");
    expect(p).toContain("Never invent an id.");
    expect(p).toContain("namespace: auth");
  });

  it("labels a blank namespace as org-wide", () => {
    const p = buildConsolidationPrompt({ ...input, namespace: undefined }, [
      { id: "m1", similarity: 0.9, relation: "refines", reason: "r" },
    ]);
    expect(p).toContain("namespace: (org-wide)");
  });
});

describe("parseVerdict — hardening the model's answer", () => {
  const matches = [
    { id: "m1", similarity: 0.4, relation: "unrelated" as const, reason: "overlap" },
    { id: "m2", similarity: 0.2, relation: "unrelated" as const, reason: "overlap" },
  ];

  it("accepts a well-formed verdict and sorts duplicates strongest-first", () => {
    const raw = JSON.stringify({
      recommendation: "supersede",
      duplicates: [
        { id: "m2", similarity: 0.3, relation: "refines", reason: "b" },
        { id: "m1", similarity: 0.95, relation: "contradicts", reason: "a" },
      ],
      summary: "Auth moved to Supabase.",
    });
    const v = parseVerdict(raw, matches);
    expect(v.recommendation).toBe("supersede");
    expect(v.duplicates.map((d) => d.id)).toEqual(["m1", "m2"]);
    expect(v.duplicates[0]!.relation).toBe("contradicts");
    expect(v.summary).toBe("Auth moved to Supabase.");
    expect(v.llmUnavailable).toBe(false);
    expect(v.engine).toBe("claude-cli");
  });

  it("DROPS an id the model invented (the supersedeId guard)", () => {
    const raw = JSON.stringify({
      recommendation: "supersede",
      duplicates: [
        { id: "mem_from_another_org", similarity: 0.99, relation: "duplicate", reason: "x" },
        { id: "m1", similarity: 0.8, relation: "refines", reason: "ok" },
      ],
    });
    const v = parseVerdict(raw, matches);
    expect(v.duplicates.map((d) => d.id)).toEqual(["m1"]);
  });

  it("downgrades to 'novel' when every duplicate was invented (nothing left to supersede)", () => {
    const raw = JSON.stringify({
      recommendation: "duplicate",
      duplicates: [{ id: "ghost", similarity: 1, relation: "duplicate", reason: "x" }],
    });
    const v = parseVerdict(raw, matches);
    expect(v.recommendation).toBe("novel");
    expect(v.duplicates).toEqual([]);
  });

  it("clamps similarity and falls back to the deterministic score when it's garbage", () => {
    const raw = JSON.stringify({
      recommendation: "supersede",
      duplicates: [
        { id: "m1", similarity: 42, relation: "refines", reason: "a" },
        { id: "m2", similarity: "high", relation: "refines", reason: "b" },
      ],
    });
    const v = parseVerdict(raw, matches);
    expect(v.duplicates.find((d) => d.id === "m1")!.similarity).toBe(1); // clamped from 42
    expect(v.duplicates.find((d) => d.id === "m2")!.similarity).toBe(0.2); // fell back to overlap
  });

  it("coerces an unknown relation / recommendation instead of trusting it", () => {
    const raw = JSON.stringify({
      recommendation: "obliterate",
      duplicates: [{ id: "m1", similarity: 0.5, relation: "vibes", reason: "" }],
    });
    const v = parseVerdict(raw, matches);
    expect(v.recommendation).toBe("novel");
    expect(v.duplicates[0]!.relation).toBe("unrelated");
    expect(v.duplicates[0]!.reason).toBe("Related to an existing memory.");
  });

  it("tolerates a fenced / chatty JSON body (parseJsonLoose)", () => {
    const raw = 'Sure!\n```json\n{"recommendation":"novel","duplicates":[]}\n```';
    expect(parseVerdict(raw, matches).recommendation).toBe("novel");
  });
});

describe("heuristicVerdict", () => {
  it("calls a near-identical match a duplicate", () => {
    const v = heuristicVerdict([{ id: "m1", similarity: 0.9, relation: "unrelated", reason: "" }]);
    expect(v.recommendation).toBe("duplicate");
    expect(v.llmUnavailable).toBe(true);
    expect(v.engine).toBe("heuristic");
  });
  it("suggests supersede for a moderate match, novel for a weak one", () => {
    expect(heuristicVerdict([{ id: "m1", similarity: 0.5, relation: "unrelated", reason: "" }]).recommendation).toBe("supersede");
    expect(heuristicVerdict([{ id: "m1", similarity: 0.2, relation: "unrelated", reason: "" }]).recommendation).toBe("novel");
  });
});

describe("analyzeWrite — always returns a usable verdict", () => {
  const input = { content: "supabase oauth login wall", kind: "semantic", candidates: [mem("m1", "supabase oauth login wall")] };

  it("short-circuits to 'novel' with no candidates, without calling the model", async () => {
    const runPrompt = vi.fn();
    const v = await analyzeWrite({ ...input, candidates: [] }, runPrompt);
    expect(v.recommendation).toBe("novel");
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it("uses the heuristic when no model is reachable (runPrompt === null)", async () => {
    const v = await analyzeWrite(input, null);
    expect(v.engine).toBe("heuristic");
    expect(v.llmUnavailable).toBe(true);
    expect(v.duplicates[0]!.id).toBe("m1");
  });

  it("uses the model's verdict when it answers", async () => {
    const runPrompt = vi.fn(async () =>
      JSON.stringify({ recommendation: "duplicate", duplicates: [{ id: "m1", similarity: 1, relation: "duplicate", reason: "same" }] }),
    );
    const v = await analyzeWrite(input, runPrompt);
    expect(v.recommendation).toBe("duplicate");
    expect(v.engine).toBe("claude-cli");
    expect(v.llmUnavailable).toBe(false);
  });

  it("degrades to the heuristic when the model THROWS (timeout / no binary)", async () => {
    const runPrompt = vi.fn(async () => {
      throw new Error("Claude CLI timed out.");
    });
    const v = await analyzeWrite(input, runPrompt);
    expect(v.engine).toBe("heuristic");
    expect(v.duplicates[0]!.id).toBe("m1");
  });

  it("degrades to the heuristic when the model returns prose instead of JSON", async () => {
    const runPrompt = vi.fn(async () => "I think this is probably fine to save!");
    const v = await analyzeWrite(input, runPrompt);
    expect(v.engine).toBe("heuristic");
    expect(v.recommendation).toBe("duplicate"); // overlap 1.0 → heuristic says duplicate
  });

  it("passes the abort signal through to the runner", async () => {
    const ac = new AbortController();
    const runPrompt = vi.fn(async () => JSON.stringify({ recommendation: "novel", duplicates: [] }));
    await analyzeWrite(input, runPrompt, ac.signal);
    expect(runPrompt).toHaveBeenCalledWith(expect.any(String), ac.signal);
  });
});
