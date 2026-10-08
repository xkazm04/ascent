// resolveHousePattern degrades a failed shape read to the generic starter (the documented choice), but
// never silently: council r2 robustness-2 found the catch swallowed the error, so an outage looked the
// same as a young org.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { reportHandledError } = vi.hoisted(() => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError }));
vi.mock("@/lib/db/org-practice-shapes", () => ({ getOrgPracticeShapes: vi.fn() }));

import { buildPracticeArtifact, resolveHousePattern } from "./artifact";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveHousePattern", () => {
  it("a thrown shape read returns null (generic starter), logged and reported", async () => {
    const boom = new Error("db down");
    vi.mocked(getOrgPracticeShapes).mockRejectedValue(boom);
    expect(await resolveHousePattern("acme", "agents-md")).toBeNull();
    expect(console.error).toHaveBeenCalledWith("[practices/artifact] house pattern read failed for acme/agents-md", boom);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.any(String) }));
  });

  it("an org with no shapes is the ordinary null, not a failure: nothing reported", async () => {
    vi.mocked(getOrgPracticeShapes).mockResolvedValue([] as never);
    expect(await resolveHousePattern("acme", "agents-md")).toBeNull();
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("the generation step still builds the generic starter when the read throws", async () => {
    vi.mocked(getOrgPracticeShapes).mockRejectedValue(new Error("db down"));
    const ctx = { fullName: "acme/web", name: "web", primaryLanguage: "TypeScript", defaultBranch: "main" };
    const { artifact, house } = await buildPracticeArtifact("agent-guidance", ctx, { orgSlug: "acme" });
    expect(house).toBeNull();
    expect(artifact).not.toBeNull();
    expect(reportHandledError).toHaveBeenCalledTimes(1);
  });
});
