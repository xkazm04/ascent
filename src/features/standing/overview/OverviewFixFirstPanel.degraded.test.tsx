// Sweep doors: each failed read of the fix-first panel is named in a warn and reported. The movers read
// keeps its own `failed` flag; the others degrade to empty.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { report, fail } = vi.hoisted(() => {
  const boom = new Error("db down");
  return { report: vi.fn(), boom, fail: vi.fn(async () => { throw boom; }) };
});
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("@/lib/db/org-insights", () => ({ getOrgMovers: fail }));
vi.mock("@/lib/db", () => ({ listGoals: fail, resolvedKeys: fail }));
vi.mock("@/lib/org/nav-counts", () => ({ getOrgFindings: fail }));
vi.mock("./OverviewFixFirst", () => ({ OverviewFixFirst: () => null }));

import { OverviewFixFirstPanel } from "./OverviewFixFirstPanel";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("OverviewFixFirstPanel failed reads", () => {
  it("renders, warns naming each read, and reports each", async () => {
    const el = (await OverviewFixFirstPanel({ slug: "acme", win: { start: null, endExclusive: null } })) as { props: { items: unknown[] } };
    expect(Array.isArray(el.props.items)).toBe(true);
    const warned = vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join("\n");
    for (const read of ["movers", "goals", "findings", "resolved findings"]) expect(warned).toContain(`overview fix-first ${read} failed`);
    expect(report).toHaveBeenCalledTimes(4);
  });
});
