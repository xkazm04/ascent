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
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(log).not.toHaveBeenCalled(); // a non-ok answer is an ordinary unknown, not a failure
    const boom = new Error("boom");
    mockFetch.mockRejectedValueOnce(boom);
    expect(await detectBuildSystem(ref, "Kotlin", "main")).toBe("unknown");
    // A THROWN read keeps the fallback but is never silent (council r2 sweep).
    expect(log).toHaveBeenCalledWith("[practices/build-system] root listing failed for acme/svc", boom);
    log.mockRestore();
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

describe("ktlint proof (Gradle roots)", () => {
  const kt = { fullName: "acme/svc", name: "svc", primaryLanguage: "Kotlin", defaultBranch: "main" };
  const tree = (...names: string[]) =>
    ({ ok: true, json: async () => ({ tree: names.map((path) => ({ path, type: "blob" })) }) }) as Response;
  const file = (text: string) => ({ ok: true, text: async () => text }) as Response;

  it.each([
    ["build.gradle.kts", 'plugins { id("org.jlleitschuh.gradle.ktlint") version "12.1.0" }'],
    ["build.gradle", "apply plugin: 'org.jlleitschuh.gradle.ktlint'"],
  ])("proves the plugin in %s, reads exactly one more file with the tree call's token", async (name, text) => {
    mockFetch.mockResolvedValueOnce(tree(name, "src")).mockResolvedValueOnce(file(text));
    const out = await withBuildSystem(ref, kt, "tok");
    expect(out).toMatchObject({ ktlintApplied: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [url, opts] = mockFetch.mock.calls[1]!;
    expect(String(url)).toContain(`/contents/${name}?ref=main`);
    expect(opts).toMatchObject({ token: "tok" });
    expect(mockFetch.mock.calls[0]![1]).toMatchObject({ token: "tok" });
  });

  it("prefers build.gradle.kts when both are listed", async () => {
    mockFetch.mockResolvedValueOnce(tree("build.gradle", "build.gradle.kts")).mockResolvedValueOnce(file(""));
    await withBuildSystem(ref, kt, "t");
    expect(String(mockFetch.mock.calls[1]![0])).toContain("/contents/build.gradle.kts");
  });

  it.each([
    ["no plugin", file("plugins { id(\"java\") }")],
    ["only a catalog alias", file("plugins { alias(libs.plugins.ktlint) }")],
    ["a convention plugin", file("plugins { id(\"myorg.kotlin-conventions\") }")],
    ["a failed call", { ok: false } as Response],
  ])("is not proven with %s", async (_n, second) => {
    mockFetch.mockResolvedValueOnce(tree("build.gradle.kts")).mockResolvedValueOnce(second);
    const out = await withBuildSystem(ref, kt, "t");
    expect(out.buildSystem).toBe("gradle-kts");
    expect(out).not.toHaveProperty("ktlintApplied");
  });

  it("is not proven when the second call throws or its body is unreadable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("boom");
    mockFetch.mockResolvedValueOnce(tree("build.gradle")).mockRejectedValueOnce(boom);
    expect(await withBuildSystem(ref, kt, "t")).not.toHaveProperty("ktlintApplied");
    expect(log).toHaveBeenCalledWith("[practices/build-system] root build file read failed for acme/svc", boom);
    log.mockRestore();
    mockFetch.mockResolvedValueOnce(tree("build.gradle")).mockResolvedValueOnce({
      ok: true,
      text: async () => {
        throw new Error("bad body");
      },
    } as unknown as Response);
    expect(await withBuildSystem(ref, kt, "t")).not.toHaveProperty("ktlintApplied");
  });

  it("makes no extra call for Maven, an unknown root, or a non-JVM language", async () => {
    mockFetch.mockResolvedValueOnce(tree("pom.xml"));
    await withBuildSystem(ref, { ...kt, primaryLanguage: "Java" }, "t");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(tree("README.md"));
    await withBuildSystem(ref, kt, "t");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockReset();
    await withBuildSystem(ref, { ...kt, primaryLanguage: "Go" }, "t");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("gives preview and apply the same answer: both go through withBuildSystem", async () => {
    mockFetch.mockResolvedValue(file("id(\"org.jlleitschuh.gradle.ktlint\")"));
    mockFetch.mockResolvedValueOnce(tree("build.gradle.kts"));
    const a = await withBuildSystem(ref, kt, "t");
    mockFetch.mockResolvedValueOnce(tree("build.gradle.kts"));
    const b = await withBuildSystem(ref, kt, "t");
    expect(a).toEqual(b);
  });
});
