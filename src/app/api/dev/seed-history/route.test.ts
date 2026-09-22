import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ persist: vi.fn(), reports: vi.fn() }));
vi.mock("@/lib/dev/seed-auth", () => ({ seedRequestAuthorized: () => true, seedForbiddenMessage: () => "forbidden" }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    organization: { findUnique: async () => ({ id: "org-1" }) },
    repository: { findMany: async () => ["one", "two"].map((name) => ({
      owner: "acme", name, primaryLanguage: "TypeScript", stars: 0, isPrivate: false,
      scans: [{ overallScore: 60 }],
    })) },
  }),
  persistScanReport: h.persist,
}));
vi.mock("@/lib/dev/fleet-seed", () => ({ reportsForRepo: h.reports }));

import { POST } from "./route";

describe("POST /api/dev/seed-history", () => {
  it("streams a repo result before the next repository finishes", async () => {
    let releaseSecond!: () => void;
    const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
    h.reports.mockImplementation((spec: { name: string }) => [{ name: spec.name }]);
    h.persist.mockImplementation(async (report: { name: string }) => {
      if (report.name === "two") await second;
      return { deduped: false };
    });
    const req = new Request("http://localhost/api/dev/seed-history", {
      method: "POST", body: JSON.stringify({ org: "acme" }),
    }) as NextRequest;
    const response = await POST(req);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(JSON.parse(new TextDecoder().decode(first.value))).toEqual({ repo: "acme/one", inserted: 1, deduped: 0 });
    releaseSecond();
    const rest: string[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      rest.push(new TextDecoder().decode(chunk.value));
    }
    expect(rest.map((line) => JSON.parse(line))).toEqual([
      { repo: "acme/two", inserted: 1, deduped: 0 },
      { ok: true, org: "acme", repos: 2, scansPersisted: 2, scansPerRepo: 6, weeksBack: 10 },
    ]);
  });
});
