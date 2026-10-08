// A house-shaped apply stamps the adoption row with the org's pattern version. When that read fails the
// row is still written (patternVersion null) but the failure is logged and reported: council r2
// robustness-2 found `.catch(() => null)` here, so the row read as not-version-tracked with no trace.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { reportHandledError } = vi.hoisted(() => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError }));
vi.mock("@/lib/github/source", () => ({ fetchRepoContext: vi.fn() }));
vi.mock("@/lib/github/host", () => ({ ghFetch: vi.fn(), githubApiBase: () => "https://api.github.test" }));
vi.mock("@/lib/practices/artifact", () => ({ buildPracticeArtifact: vi.fn() }));
vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn() }));
vi.mock("@/lib/db", () => ({ recordAudit: vi.fn(), recordPracticePr: vi.fn() }));
vi.mock("@/lib/db/org-practice-shapes", () => ({ getRegistryPracticeSource: vi.fn() }));
vi.mock("@/lib/db/house-pattern-versions", () => ({ getLatestHousePattern: vi.fn() }));
vi.mock("@/lib/db/practice-adoption", () => ({ recordProposedAdoption: vi.fn() }));

import { applyPracticeToRepo } from "./apply";
import { fetchRepoContext } from "@/lib/github/source";
import { buildPracticeArtifact } from "@/lib/practices/artifact";
import { openDraftPr } from "@/lib/github/write";
import { getLatestHousePattern } from "@/lib/db/house-pattern-versions";
import { recordProposedAdoption } from "@/lib/db/practice-adoption";

const ref = { owner: "acme", repo: "web" };
const artifact = { path: "AGENTS.md", body: "# body", branch: "ascent/agents", commitMessage: "c", prTitle: "t", prBody: "b" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(fetchRepoContext).mockResolvedValue({ fullName: "acme/web", name: "web", primaryLanguage: "TypeScript", defaultBranch: "main" });
  vi.mocked(buildPracticeArtifact).mockResolvedValue({ artifact, house: { lines: ["x"], exemplars: ["acme/a"] } } as never);
  vi.mocked(openDraftPr).mockResolvedValue({ number: 7, url: "u", reused: false } as never);
});

const apply = () => applyPracticeToRepo("tok", ref, "agent-guidance", undefined, { orgId: "org-1" }, { orgSlug: "acme" });

describe("applyPracticeToRepo: the adoption row's pattern version", () => {
  it("stamps the latest house version when the read succeeds, unreported", async () => {
    vi.mocked(getLatestHousePattern).mockResolvedValue({ version: 3 } as never);
    expect((await apply()).kind).toBe("ok");
    expect(vi.mocked(recordProposedAdoption).mock.calls[0]![0]).toMatchObject({ source: "house", patternVersion: 3 });
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("a failed version read still writes the row with patternVersion null, logged and reported", async () => {
    const boom = new Error("db down");
    vi.mocked(getLatestHousePattern).mockRejectedValue(boom);
    expect((await apply()).kind).toBe("ok");
    expect(vi.mocked(recordProposedAdoption).mock.calls[0]![0]).toMatchObject({ source: "house", patternVersion: null, prNumber: 7 });
    expect(console.error).toHaveBeenCalledWith("[practices/apply] house pattern version read failed for acme/web", boom);
    expect(reportHandledError).toHaveBeenCalledWith(boom, expect.objectContaining({ message: expect.any(String) }));
  });
});
