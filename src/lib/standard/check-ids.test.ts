import { describe, expect, it } from "vitest";
import {
  CHECK_ID_MAX,
  checkId,
  isKnownCheckId,
  isValidCheckId,
  parseCheckId,
  slugSubject,
  worstLevel,
} from "./check-ids";

describe("slugSubject", () => {
  it("lower-cases and replaces everything outside the id charset", () => {
    expect(slugSubject("Next.js Build")).toBe("next.js-build");
    expect(slugSubject("scan-secrets")).toBe("scan-secrets");
    expect(slugSubject("src/generated/CONTEXT.md")).toBe("src/generated/context.md");
    expect(slugSubject("<your build manifest>")).toBe("-your-build-manifest-");
  });

  it("caps the subject so a hostile capability name cannot blow the column key", () => {
    expect(slugSubject("a".repeat(400))).toHaveLength(100);
    expect(checkId("capability.", "b".repeat(400), ".run").length).toBeLessThanOrEqual(CHECK_ID_MAX);
  });
});

describe("isValidCheckId", () => {
  it("accepts the vocabulary's real shapes", () => {
    for (const id of ["structure", "control.prepush.test", "capability.test.run", "pointer.contextindex", "context.src/a.md"])
      expect(isValidCheckId(id)).toBe(true);
  });

  it("rejects anything the ingest must 400 on", () => {
    for (const bad of ["", "Structure", "1structure", "a b", "control.PREPUSH.test", "x".repeat(121), "co ntrol"])
      expect(isValidCheckId(bad)).toBe(false);
  });

  it("is deliberately PERMISSIVE inside the charset — the guarantee is a safe key, not a taxonomy", () => {
    // A newer reporter may invent ids this build has never heard of (spec principle 3), so the wire
    // check only guarantees what storage and rendering need: lower-case, letter-initial, no
    // whitespace, bounded length. `isKnownCheckId` is the separate question of whether THIS build's
    // doctor could have produced it, and only grouping depends on that.
    expect(isValidCheckId("control..test")).toBe(true);
    expect(isKnownCheckId("control..test")).toBe(false);
  });
});

describe("parseCheckId", () => {
  it("gives a static id no subject, so 'the hook check' is not read as 'the check for hook'", () => {
    expect(parseCheckId("control.prepush")).toEqual({ family: "control", subject: null });
    expect(parseCheckId("structure")).toEqual({ family: "structure", subject: null });
    expect(parseCheckId("freshness.unchecked")).toEqual({ family: "freshness", subject: null });
    expect(parseCheckId("context.index")).toEqual({ family: "context", subject: null });
  });

  it("groups a capability's declaration and its RUN under one subject", () => {
    expect(parseCheckId("capability.test")).toEqual({ family: "capability", subject: "test" });
    expect(parseCheckId("capability.test.run")).toEqual({ family: "capability", subject: "test" });
    expect(parseCheckId("control.prepush.lint")).toEqual({ family: "control", subject: "lint" });
    expect(parseCheckId("control.prepush.lint.backing")).toEqual({ family: "control", subject: "lint" });
  });

  it("calls an id from a NEWER reporter unknown rather than mangling it", () => {
    // Spec principle 3: a reader ignores what it does not recognize. The row is still stored; only
    // the grouping declines to guess.
    expect(parseCheckId("evals.regression")).toEqual({ family: "unknown", subject: null });
    expect(isKnownCheckId("evals.regression")).toBe(false);
    expect(isKnownCheckId("capability.fuzz")).toBe(true);
  });
});

describe("worstLevel", () => {
  it("cannot manufacture a pass when one report repeats a check id", () => {
    expect(worstLevel("pass", "fail")).toBe("fail");
    expect(worstLevel("fail", "pass")).toBe("fail");
    expect(worstLevel("warn", "unchecked")).toBe("warn");
    expect(worstLevel("unchecked", "pass")).toBe("unchecked");
    expect(worstLevel("pass", "pass")).toBe("pass");
  });
});
