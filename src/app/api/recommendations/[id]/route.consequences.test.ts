// PATCH /api/recommendations/:id hands every status change to the one consequences module
// (roadmap-0, challenge 2026-10-22b): the route no longer knows what a close or a dismissal means.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stripComments } from "@/lib/org/tab-link-graph";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const { applyEffects } = vi.hoisted(() => ({
  applyEffects: vi.fn(async () => ({ applied: [], failed: [] })),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(() => true),
  getRecommendationOrgSlug: vi.fn(async () => "acme"),
  updateRecommendation: vi.fn(),
}));
vi.mock("@/lib/db/rec-transition-effects", () => ({ applyRecTransitionEffects: applyEffects }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", isAuthConfigured: vi.fn(() => false), getSession: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));

import { PATCH } from "./route";
import { updateRecommendation } from "@/lib/db";

const mockUpdate = vi.mocked(updateRecommendation);

function patch(body: unknown) {
  return PATCH(
    new Request("http://localhost/api/recommendations/rec_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "rec_1" }) },
  );
}

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/recommendations/:id - status consequences", () => {
  it("a dismissal with a note hands {to:'dismissed', reason} to the effects module", async () => {
    mockUpdate.mockResolvedValue({ id: "rec_1", status: "dismissed", title: "T", dimension: "D1" } as never);
    const res = await patch({ status: "dismissed", note: "x" });
    expect(res.status).toBe(200);
    expect(applyEffects).toHaveBeenCalledTimes(1);
    expect(applyEffects).toHaveBeenCalledWith(
      { from: null, to: "dismissed", reason: "x", title: "T", dimension: "D1" },
      { recommendationId: "rec_1", actor: "alice" },
    );
  });

  it("a close hands {to:'done'} to the effects module", async () => {
    mockUpdate.mockResolvedValue({ id: "rec_1", status: "done", title: "T", dimension: "D1" } as never);
    await patch({ status: "done" });
    expect(applyEffects).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: "done" }), expect.objectContaining({ recommendationId: "rec_1" }));
  });

  it("a patch that does not touch status fires no consequence", async () => {
    mockUpdate.mockResolvedValue({ id: "rec_1", status: "open", title: "T", dimension: "D1" } as never);
    await patch({ assigneeLogin: "bob" });
    expect(applyEffects).not.toHaveBeenCalled();
  });

  it("the route source (comment-stripped) no longer calls the three writers itself", () => {
    const names = /recordRecommendationClose|recordRecommendationDismissal|clearRecommendationDismissal/;
    // Seeded violation: the matcher must still bite on a real call, and ignore one named only in prose.
    expect(names.test(stripComments("await recordRecommendationClose(id, rec);"))).toBe(true);
    expect(names.test(stripComments("// recordRecommendationClose used to live here"))).toBe(false);
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(names.test(stripComments(src))).toBe(false);
  });
});
