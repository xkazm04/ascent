// The version constants the standard emits. `MANIFEST_SCHEMA_VERSION` is defined by the spec itself as
// "Semver of this spec", and the generated manifest's `spec` field points at the very SPEC.md this
// build writes — so the two are one number in two places, and the only safe place for that is a test.
// The pair silently drifted once (spec minor-bumped to 0.2.0, the constant left at 0.1.0), and nothing
// failed: the doctor compares only the MAJOR and the versioning policy makes 0.x additive.

import { describe, expect, it } from "vitest";
import { SPEC_MD } from "./spec";
import { GUARDRAILS_SCHEMA_VERSION, MANIFEST_SCHEMA_VERSION } from "./types";

/** The version in the SPEC's own title line: `# … (spec v0.2.0)`. */
function specHeaderVersion(): string {
  const m = /\(spec v(\d+\.\d+\.\d+)\)/.exec(SPEC_MD.split("\n")[0] ?? "");
  return m?.[1] ?? "";
}

describe("standard version constants", () => {
  it("MANIFEST_SCHEMA_VERSION equals the version SPEC.md declares in its header", () => {
    expect(specHeaderVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(MANIFEST_SCHEMA_VERSION).toBe(specHeaderVersion());
  });

  it("GUARDRAILS_SCHEMA_VERSION is versioned independently and is NOT pinned to the spec", () => {
    // Documented as independent of the spine, so it must not be dragged along by a spec bump. This
    // asserts the shape (a semver), never equality with the spec — equality here would be the bug.
    expect(GUARDRAILS_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
