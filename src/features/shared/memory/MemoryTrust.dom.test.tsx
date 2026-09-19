// @vitest-environment jsdom
//
// MemoryTrust used to draw only the confidence box. Citation votes already live on OrgMemory and now
// travel on MemoryRow; this pins that they render here when present, and that zero votes is silence
// (no evidence) rather than a pack parked at 0. The two counters are never netted.

import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { citationEvidence, MemoryTrust } from "./MemoryTrust";
import type { MemoryRow } from "@/lib/db";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
});

function row(over: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "m1",
    namespace: "",
    content: "x",
    kind: "semantic",
    visibility: "shared",
    source: "",
    confidence: 0.6,
    tags: [],
    supersededBy: null,
    version: 1,
    accessCount: 0,
    citedCount: 0,
    notUsefulCount: 0,
    expiresAt: null,
    origin: "hosted",
    registryPath: null,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("citationEvidence", () => {
  it("is null when no listed row carries a vote — no evidence, never a pair of zeros", () => {
    expect(citationEvidence([])).toBeNull();
    expect(citationEvidence([row(), row({ id: "m2", citedCount: 0, notUsefulCount: 0 })])).toBeNull();
    expect(citationEvidence([row({ citedCount: Number.NaN, notUsefulCount: -1 })])).toBeNull();
  });

  it("sums the two counters independently and never nets them", () => {
    expect(
      citationEvidence([
        row({ id: "a", citedCount: 3, notUsefulCount: 1 }),
        row({ id: "b", citedCount: 1, notUsefulCount: 2 }),
      ]),
    ).toEqual({ cited: 4, notUseful: 3 });
  });
});

describe("MemoryTrust", () => {
  it("renders nothing while loading or when the list is empty", () => {
    expect(render(<MemoryTrust memories={[]} />).container).toBeEmptyDOMElement();
    expect(render(<MemoryTrust memories={[row()]} loading />).container).toBeEmptyDOMElement();
  });

  it("draws the confidence box without a citation pack when no votes are present", () => {
    render(<MemoryTrust memories={[row({ confidence: 0.3 }), row({ id: "m2", confidence: 1 })]} />);
    expect(screen.getByRole("img", { name: /Confidence of the listed memories/ })).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Citation evidence/ })).toBeNull();
  });

  it("draws citation votes on the trust profile when they are present", () => {
    render(
      <MemoryTrust
        memories={[row({ citedCount: 4 }), row({ id: "m2", citedCount: 0, notUsefulCount: 2 })]}
      />,
    );
    const pack = screen.getByRole("img", { name: /Citation evidence on listed memories/ });
    const label = pack.getAttribute("aria-label") ?? "";
    expect(label).toContain("4 votes");
    expect(label).toContain("2 marked not useful");
    expect(screen.getByText("marked not useful")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Why: citation evidence" })).toBeTruthy();
  });
});
