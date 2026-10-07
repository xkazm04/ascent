// Sweep door: the unfurl metadata degrades to the neutral description when the summary read fails (the
// intent) but the failure is logged by name and reported.

import { describe, it, expect, vi } from "vitest";

const { report } = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: report }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/components/org/shell/OrgTabChunks", () => ({ OrgTabChunks: () => null }));
const boom = new Error("db down");
vi.mock("@/lib/db", () => ({ countInFlightPrs: vi.fn(), getOrgHeaderSummary: vi.fn(async () => { throw boom; }) }));
vi.mock("@/lib/authz", () => ({ canReadOrg: async () => true }));

import { generateMetadata } from "./page";

describe("org page metadata", () => {
  it("falls back to the neutral description, warns, and reports", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const meta = await generateMetadata({ params: Promise.resolve({ slug: "acme" }) });
    expect(String(meta.description)).toContain("AI-native engineering maturity");
    expect(String(warn.mock.calls[0]?.[0])).toContain("org metadata header summary failed");
    expect(report).toHaveBeenCalledWith(boom, expect.anything());
  });
});
