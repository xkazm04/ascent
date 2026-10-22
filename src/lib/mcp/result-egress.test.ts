import { describe, expect, it } from "vitest";
import { egressResult, redactLeaves } from "./result-egress";

const TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}abcdef`;

describe("redactLeaves - shape-preserving", () => {
  it("keeps every non-string value, every key and the nesting; only string leaves are masked", () => {
    const input = {
      count: 2,
      ratio: 0.5,
      ok: true,
      missing: null,
      [`key_${TOKEN}`]: "keys are not leaves",
      list: [1, false, null, `a ${TOKEN}`, ["nested", { deep: `postgres://u:p4ssword@h/x` }]],
      obj: { inner: { n: -1, s: "plain" } },
    };
    const before = JSON.parse(JSON.stringify(input));
    const { value, redactions } = redactLeaves(input);
    const out = value as typeof input;
    expect(Object.keys(out)).toEqual(Object.keys(input));
    expect(out.count).toBe(2);
    expect(out.ratio).toBe(0.5);
    expect(out.ok).toBe(true);
    expect(out.missing).toBeNull();
    expect(out[`key_${TOKEN}`]).toBe("keys are not leaves");
    expect(out.list.slice(0, 3)).toEqual([1, false, null]);
    expect(out.list[3]).toBe("a [REDACTED]");
    expect((out.list[4] as unknown[])[0]).toBe("nested");
    expect(((out.list[4] as unknown[])[1] as { deep: string }).deep).toBe("postgres://[REDACTED]@h/x");
    expect(out.obj).toEqual({ inner: { n: -1, s: "plain" } });
    expect(redactions).toBe(2);
    // Pure: the handler's own object is not mutated.
    expect(input).toEqual(before);
  });

  it("counts zero and returns equal values when nothing is credential-shaped", () => {
    const { value, redactions } = redactLeaves({ a: "hello", b: [1, "x"] });
    expect(value).toEqual({ a: "hello", b: [1, "x"] });
    expect(redactions).toBe(0);
  });

  it("does not count a marker the text already carried", () => {
    expect(redactLeaves("already [REDACTED] here").redactions).toBe(0);
  });
});

describe("egressResult", () => {
  it("is the identity for a computed tool - the same object back, no meta", () => {
    const result = { structuredContent: { note: `ref ${TOKEN}` } };
    const out = egressResult({ resultTrust: "computed" }, result);
    expect(out.result).toBe(result);
    expect(out.meta).toBeUndefined();
  });

  it("redacts structuredContent and an explicit text for an org-authored tool, with meta", () => {
    const out = egressResult(
      { resultTrust: "org-authored" },
      { structuredContent: { error: `bad ${TOKEN}` }, text: `bad ${TOKEN}`, isError: true },
    );
    expect(out.result.structuredContent).toEqual({ error: "bad [REDACTED]" });
    expect(out.result.text).toBe("bad [REDACTED]");
    expect(out.result.isError).toBe(true);
    // One secret rendered twice is one redaction, not two.
    expect(out.meta).toEqual({ "ascent.dev/provenance": "org-authored", "ascent.dev/redactions": 1 });
  });

  it("leaves text absent when the handler wrote none, so the JSON rendering is derived from the redacted payload", () => {
    const out = egressResult({ resultTrust: "org-authored" }, { structuredContent: { body: TOKEN } });
    expect(out.result).not.toHaveProperty("text");
    expect(out.meta?.["ascent.dev/redactions"]).toBe(1);
  });
});
