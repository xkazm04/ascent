// Pure tests for the Shared Org Memory taxonomy (Memory-as-a-Service MVP): kind + visibility
// validation/normalization, the label fallback that keeps a badge from rendering blank, and the
// confidence clamp that is the write-path guard on the 0..1 trust score.

import { describe, it, expect } from "vitest";
import {
  CONFIDENCE_BANDS,
  MEMORY_KINDS,
  MEMORY_VISIBILITIES,
  confidenceLabel,
  isMemoryKind,
  isMemoryVisibility,
  memoryKindLabel,
  normalizeConfidence,
  normalizeMemoryKind,
  normalizeMemoryVisibility,
} from "@/lib/org/memory-kinds";

describe("isMemoryKind", () => {
  it("accepts every declared kind", () => {
    for (const k of MEMORY_KINDS) expect(isMemoryKind(k)).toBe(true);
  });
  it("rejects unknown / blank / nullish", () => {
    expect(isMemoryKind("nope")).toBe(false);
    expect(isMemoryKind("")).toBe(false);
    expect(isMemoryKind(null)).toBe(false);
    expect(isMemoryKind(undefined)).toBe(false);
  });
});

describe("normalizeMemoryKind", () => {
  it("passes a valid kind through", () => {
    expect(normalizeMemoryKind("procedural")).toBe("procedural");
  });
  it("defaults unknown/blank to 'semantic' (the schema default)", () => {
    expect(normalizeMemoryKind("garbage")).toBe("semantic");
    expect(normalizeMemoryKind("")).toBe("semantic");
    expect(normalizeMemoryKind(undefined)).toBe("semantic");
  });
});

describe("memoryKindLabel", () => {
  it("uses the curated label for a known id", () => {
    expect(memoryKindLabel("episodic")).toBe("Episodic");
  });
  it("humanizes an unknown id instead of rendering blank", () => {
    expect(memoryKindLabel("working_set")).toBe("Working Set");
  });
  it("renders an em dash for nullish", () => {
    expect(memoryKindLabel(null)).toBe("—");
    expect(memoryKindLabel(undefined)).toBe("—");
  });
});

describe("visibility", () => {
  it("accepts every declared visibility", () => {
    for (const v of MEMORY_VISIBILITIES) expect(isMemoryVisibility(v)).toBe(true);
  });
  it("rejects unknown / nullish", () => {
    expect(isMemoryVisibility("world")).toBe(false);
    expect(isMemoryVisibility(null)).toBe(false);
  });
  it("defaults unknown/blank to 'shared' (the schema default)", () => {
    expect(normalizeMemoryVisibility("world")).toBe("shared");
    expect(normalizeMemoryVisibility(undefined)).toBe("shared");
    expect(normalizeMemoryVisibility("private")).toBe("private");
  });
});

describe("normalizeConfidence", () => {
  it("passes an in-range score through", () => {
    expect(normalizeConfidence(0.6)).toBe(0.6);
    expect(normalizeConfidence(0)).toBe(0);
    expect(normalizeConfidence(1)).toBe(1);
  });
  it("clamps out-of-range scores into 0..1", () => {
    expect(normalizeConfidence(4.2)).toBe(1);
    expect(normalizeConfidence(-3)).toBe(0);
  });
  it("defaults a non-finite / missing score to 1.0", () => {
    expect(normalizeConfidence(NaN)).toBe(1);
    expect(normalizeConfidence(Infinity)).toBe(1);
    expect(normalizeConfidence(null)).toBe(1);
    expect(normalizeConfidence(undefined)).toBe(1);
    // A string sneaking through an untyped API body must not become a NaN column value.
    expect(normalizeConfidence("0.5" as unknown as number)).toBe(1);
  });
});

describe("confidenceLabel", () => {
  it("labels each band's exact value with its own id", () => {
    for (const b of CONFIDENCE_BANDS) expect(confidenceLabel(b.value)).toBe(b.id);
  });
  it("snaps an off-band score (e.g. an API-written 0.55) to the nearest band", () => {
    expect(confidenceLabel(0.55)).toBe("medium");
    expect(confidenceLabel(0.95)).toBe("high");
    expect(confidenceLabel(0.1)).toBe("low");
  });
});
