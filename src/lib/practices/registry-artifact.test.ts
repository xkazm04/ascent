// MOONSHOT #33 — the registry starter builder.
//
// The two refusals are the point: an ARCHIVED practice must not be re-distributed (the org withdrew
// it), and an EMPTY body must never be committed as a file. Both are `null`, which the apply path
// already maps to `unknown-practice` — no PR opened.

import { describe, expect, it } from "vitest";
import { buildRegistryArtifact, registryArtifactPath, registrySlugOf, type RegistryPracticeSource } from "./registry-artifact";

const source = (over: Partial<RegistryPracticeSource> = {}): RegistryPracticeSource => ({
  slug: "pr-review",
  title: "PR review",
  appliesWhen: "every pull request",
  dimension: "D7",
  content: "## What good looks like\n\nTwo approvals.\n",
  registryPath: "practices/pr-review/PRACTICE.md",
  archived: false,
  ...over,
});

describe("registrySlugOf", () => {
  it("recognizes the registry id space and nothing else", () => {
    expect(registrySlugOf("registry:pr-review")).toBe("pr-review");
    expect(registrySlugOf("agent-guidance")).toBeNull();
    expect(registrySlugOf("playbook:abc")).toBeNull();
    expect(registrySlugOf("registry:")).toBeNull();
  });
});

describe("buildRegistryArtifact", () => {
  it("names the registry path in the committed body — provenance, not decoration", () => {
    const spec = buildRegistryArtifact(source())!;
    expect(spec.body).toContain("practices/pr-review/PRACTICE.md");
    expect(spec.body).toContain("Two approvals.");
    expect(spec.prBody).toContain("practices/pr-review/PRACTICE.md");
  });

  // The ledger keys on artifactPath, so the path a slug lands at must be a pure function of the slug.
  it("commits at a deterministic path derived from the slug alone", () => {
    expect(buildRegistryArtifact(source())!.path).toBe("docs/practices/pr-review.md");
    expect(registryArtifactPath("pr-review")).toBe("docs/practices/pr-review.md");
    // Same input, same path, twice — nothing about the call carries into it.
    expect(buildRegistryArtifact(source())!.path).toBe(buildRegistryArtifact(source())!.path);
  });

  it("keeps the registry: id on the spec, so the adoption row is namespaced", () => {
    expect(buildRegistryArtifact(source())!.practiceId).toBe("registry:pr-review");
  });

  it("returns null for an archived row — a withdrawn practice is not redistributed", () => {
    expect(buildRegistryArtifact(source({ archived: true }))).toBeNull();
  });

  it("returns null for empty content — never commits an empty file", () => {
    expect(buildRegistryArtifact(source({ content: "" }))).toBeNull();
    expect(buildRegistryArtifact(source({ content: "   \n\n " }))).toBeNull();
  });

  it("still builds when the registry path is unknown, without inventing one", () => {
    const spec = buildRegistryArtifact(source({ registryPath: null }))!;
    expect(spec.body).toContain("From your organization's registry");
    expect(spec.body).not.toContain("undefined");
    expect(spec.body).not.toContain("null");
  });

  // The same sanitizer the catalog generator uses: a registry title is user text and lands in a file
  // ascent commits into a customer repository.
  it("neutralizes markup in registry-supplied text", () => {
    const spec = buildRegistryArtifact(source({ title: "PR `review` <img>", registryPath: "a`b`.md" }))!;
    expect(spec.body).not.toContain("<img>");
    expect(spec.prTitle).not.toContain("`");
  });
});
