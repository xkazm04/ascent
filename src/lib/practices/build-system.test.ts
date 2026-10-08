import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/github/host", () => ({
  ghFetch: vi.fn(),
  githubApiBase: () => "https://api.github.test",
}));

import { ghFetch } from "@/lib/github/host";
import { classifyRoot, detectBuildSystem, withBuildSystem } from "./build-system";

const mockFetch = vi.mocked(ghFetch);
const ref = { owner: "acme", repo: "svc" };

function root(...names: string[]) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ tree: names.map((path) => ({ path, type: "blob" })) }),
  } as Response);
}

beforeEach(() => mockFetch.mockReset());

describe("classifyRoot", () => {
  it.each([
    [["pom.xml"], "maven"],
    [["build.gradle"], "gradle"],
    [["build.gradle.kts"], "gradle-kts"],
    [["README.md"], "unknown"],
    [["pom.xml", "build.gradle"], "unknown"],
    [["pom.xml", "build.gradle.kts"], "unknown"],
  ])("%j -> %s", (names, expected) => {
    expect(classifyRoot(names)).toBe(expected);
  });
});

describe("detectBuildSystem", () => {
  it("makes exactly ONE non-recursive trees call on the default branch with the given token", async () => {
    root("build.gradle.kts", "src");
    expect(await detectBuildSystem(ref, "Java", "main", "tok")).toBe("gradle-kts");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://api.github.test/repos/acme/svc/git/trees/main");
    expect(String(url)).not.toContain("recursive");
    expect(opts).toMatchObject({ token: "tok" });
  });

  it.each(["TypeScript", "Go", "Python", null, undefined, "Scala"])("makes NO call for %s", async (lang) => {
    expect(await detectBuildSystem(ref, lang, "main", "tok")).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("resolves unknown (not undefined) when the call fails or throws", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    expect(await detectBuildSystem(ref, "Kotlin", "main")).toBe("unknown");
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    expect(await detectBuildSystem(ref, "Kotlin", "main")).toBe("unknown");
  });
});

describe("withBuildSystem", () => {
  it("returns a non-JVM context untouched with no call, and stamps a JVM one", async () => {
    const ts = { fullName: "acme/web", name: "web", primaryLanguage: "TypeScript", defaultBranch: "main" };
    expect(await withBuildSystem(ref, ts, "t")).toBe(ts);
    expect(mockFetch).not.toHaveBeenCalled();

    root("pom.xml");
    const java = { fullName: "acme/svc", name: "svc", primaryLanguage: "Java", defaultBranch: "main" };
    expect(await withBuildSystem(ref, java, "t")).toEqual({ ...java, buildSystem: "maven" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
