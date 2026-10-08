// The commit path detects the build system with the SAME helper the preview uses, so the bodies agree.
import { describe, it, expect, vi, beforeEach } from "vitest";

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
import { ghFetch } from "@/lib/github/host";
import { buildPracticeArtifact } from "@/lib/practices/artifact";

const ref = { owner: "acme", repo: "svc" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildPracticeArtifact).mockResolvedValue({ artifact: null, house: null });
});

describe("applyPracticeToRepo — build system", () => {
  it("lists the repo root once for a Java repo and generates with that build system", async () => {
    vi.mocked(fetchRepoContext).mockResolvedValue({ fullName: "acme/svc", name: "svc", primaryLanguage: "Java", defaultBranch: "main" });
    vi.mocked(ghFetch).mockResolvedValue({ ok: true, json: async () => ({ tree: [{ path: "pom.xml", type: "blob" }] }) } as Response);

    await applyPracticeToRepo("tok", ref, "agent-guidance", undefined, {});

    expect(vi.mocked(ghFetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildPracticeArtifact).mock.calls[0]![1]).toMatchObject({ buildSystem: "maven" });
  });

  it("makes no extra GitHub call for a non-JVM repo", async () => {
    vi.mocked(fetchRepoContext).mockResolvedValue({ fullName: "acme/web", name: "web", primaryLanguage: "TypeScript", defaultBranch: "main" });

    await applyPracticeToRepo("tok", ref, "agent-guidance", undefined, {});

    expect(vi.mocked(ghFetch)).not.toHaveBeenCalled();
  });
});
