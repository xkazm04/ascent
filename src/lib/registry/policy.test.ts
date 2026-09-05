// The `lanes:` block of `.ascent/registry.yaml` — which lanes ascent indexes, and in what role.
//
// The root `registry.yaml` is the authority on which lanes a registry CARRIES; this overlay says
// what one consumer does with them. The fact worth pinning is the `usage/` one: ascent is a
// READER there and never a writer, because the installations that run skills each contribute one
// `usage/<contributor>.json` and two writers on one number is the failure that shape prevents.
//
// The second property under test is round-trip. `serializeRegistryYaml` is what seeds a customer's
// registry, and `layout.ts` states the contract that the seeded file matches the reference registry
// key-for-key — so a block added to one and not the other is a silent divergence, not a typo.

import { describe, expect, it } from "vitest";

import { DEFAULT_LANES, parseRegistryYaml, serializeRegistryYaml, writesLane } from "./policy";
import { FIXTURE_REGISTRY_YAML } from "./__fixtures__/registry-tree";

describe("lanes — the reference registry's declaration", () => {
  it("reads every lane as a reader, usage included", () => {
    const d = parseRegistryYaml(FIXTURE_REGISTRY_YAML);
    expect(d.lanes).toEqual({ skills: "reader", practices: "reader", memory: "reader", usage: "reader" });
  });

  it("says ascent may not write the usage lane", () => {
    // The counts are contributed; ascent sums them. This guard is the field's whole purpose.
    const d = parseRegistryYaml(FIXTURE_REGISTRY_YAML);
    expect(writesLane(d, "usage")).toBe(false);
    expect(writesLane(d, "skills")).toBe(false);
  });

  it("treats a lane it was never told about as not indexed", () => {
    const d = parseRegistryYaml(FIXTURE_REGISTRY_YAML);
    expect(d.lanes.somethingFuture).toBeUndefined();
    expect(writesLane(d, "somethingFuture")).toBe(false);
  });
});

describe("lanes — degrading rather than lying", () => {
  it("falls back to the lanes the indexer actually walks when the block is absent", () => {
    // Every overlay written before this block existed. Defaulting to what `index-walk.ts`
    // hardcodes keeps the declaration true of an old file instead of reporting zero lanes.
    const d = parseRegistryYaml("registry: 1\nmode: git-native\ntelemetry: api\n");
    expect(d.lanes).toEqual(DEFAULT_LANES);
  });

  it("drops an unrecognized role instead of coercing it to reader", () => {
    // Reading `mirror` as `reader` would invert the one fact the field states, so the lane is
    // omitted — and `writesLane` then answers false, which is the safe direction to be wrong in.
    const d = parseRegistryYaml("registry: 1\nlanes:\n  usage: reader\n  weird: mirror\n");
    expect(d.lanes).toEqual({ usage: "reader" });
    expect(writesLane(d, "weird")).toBe(false);
  });

  it("carries writer when a lane genuinely declares it", () => {
    const d = parseRegistryYaml("registry: 1\nlanes:\n  usage: writer\n");
    expect(writesLane(d, "usage")).toBe(true);
  });

  it("keeps the documented defaults when the block parses to nothing usable", () => {
    const d = parseRegistryYaml("registry: 1\nlanes:\n  usage: nonsense\n");
    expect(d.lanes).toEqual(DEFAULT_LANES);
  });

  it("is unaffected by garbage, like every other field here", () => {
    expect(parseRegistryYaml("::: not yaml :::\n\t\x00").lanes).toEqual(DEFAULT_LANES);
  });
});

describe("serializeRegistryYaml", () => {
  const declaration = parseRegistryYaml(FIXTURE_REGISTRY_YAML);

  it("round-trips the lanes block through its own parser", () => {
    // The seeded file and the reference file must stay key-for-key (layout.ts's stated contract).
    const reparsed = parseRegistryYaml(serializeRegistryYaml(declaration));
    expect(reparsed.lanes).toEqual(declaration.lanes);
    expect(reparsed.telemetry).toBe(declaration.telemetry);
    expect(reparsed.policies).toEqual(declaration.policies);
  });

  it("no longer points a reader at a telemetry/ folder that does not exist", () => {
    // The lane is `usage/`, specified in the registry's docs/usage-lane.md. The stale name was
    // duplicated into every scaffolded registry from here.
    const yaml = serializeRegistryYaml(declaration);
    expect(yaml).not.toMatch(/telemetry\/ folder/);
    expect(yaml).toMatch(/usage\/ lane/);
  });

  it("stays deterministic — same declaration, byte-identical output", () => {
    expect(serializeRegistryYaml(declaration)).toBe(serializeRegistryYaml(declaration));
  });
});
