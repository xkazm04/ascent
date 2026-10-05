// THE GUARD'S SECOND LICENSED INVENTION — a toolchain check detected from tracked files, for a
// repository that declares none. The cases with teeth are the NEGATIVE ones: a Unity solution, an
// Unreal tree and an Android-only module must detect nothing (or nothing Android), because a check
// that cannot run headless from a clean checkout costs every lane its timeout and protects nothing.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectToolchainChecks, gradleIncludes, MAX_TOOLCHAIN_PATHS, toolchainChecksFromPaths } from "@/lib/local/lane-toolchain";

const WRAPPER = ["gradlew", "gradlew.bat", "gradle/wrapper/gradle-wrapper.jar", "settings.gradle.kts"];
const SETTINGS = 'rootProject.name = "x"\ninclude(":core")\ninclude(":tv-app")\n';

describe("Gradle", () => {
  // The measured shape of xkazm04/firetv: a pure-JVM `core` beside an Android `tv-app`.
  const FIRETV = [
    ...WRAPPER,
    "core/src/main/kotlin/A.kt",
    "core/src/test/kotlin/CoreTest.kt",
    "tv-app/src/main/AndroidManifest.xml",
    "tv-app/src/test/kotlin/TvTest.kt",
  ];

  it("prefers the pure-JVM core module's test task — no Android SDK needed", () => {
    expect(toolchainChecksFromPaths(FIRETV, "linux", SETTINGS)).toEqual([
      { command: "./gradlew :core:test --console=plain --no-daemon", source: "detected: Gradle wrapper + settings.gradle.kts (pure-JVM :core)" },
    ]);
  });

  it("runs the .bat through an explicit `.\\` on Windows, where cmd.exe may not search the cwd", () => {
    expect(toolchainChecksFromPaths(FIRETV, "win32", SETTINGS)[0]?.command).toBe(".\\gradlew.bat :core:test --console=plain --no-daemon");
  });

  it("skips an Android-only module — with no pure-JVM module left it falls back to plain `test`", () => {
    const paths = [...WRAPPER, "tv-app/src/main/AndroidManifest.xml", "tv-app/src/test/kotlin/TvTest.kt"];
    expect(toolchainChecksFromPaths(paths, "linux")[0]?.command).toBe("./gradlew test --console=plain --no-daemon");
  });

  it("uses plain `test` when no module tracks any test sources", () => {
    const checks = toolchainChecksFromPaths([...WRAPPER, "app/src/main/kotlin/Main.kt"], "linux");
    expect(checks).toEqual([{ command: "./gradlew test --console=plain --no-daemon", source: "detected: Gradle wrapper + settings.gradle.kts" }]);
  });

  it("does not name a module the settings never include — Gradle would reject `:x:test`", () => {
    const paths = [...WRAPPER, "scratch/src/test/kotlin/T.kt"];
    expect(toolchainChecksFromPaths(paths, "linux", 'include(":app")')[0]?.command).toBe("./gradlew test --console=plain --no-daemon");
  });

  it("needs the wrapper jar (and on Windows the .bat) — the script alone cannot run from a clean checkout", () => {
    expect(toolchainChecksFromPaths(["gradlew", "gradlew.bat", "settings.gradle"], "linux")).toEqual([]);
    expect(toolchainChecksFromPaths(["gradlew", "gradle/wrapper/gradle-wrapper.jar", "settings.gradle"], "win32")).toEqual([]);
  });

  it("reads top-level includes in both DSLs and drops nested project paths", () => {
    expect(gradleIncludes("include(\":core\")\ninclude ':a', ':b'\ninclude(\":libs:x\")\n// include(\":c\")")).toEqual(["core", "a", "b"]);
  });
});

describe(".NET", () => {
  it("runs `dotnet test` on a solution whose subtree carries a tests project", () => {
    const paths = [
      "shared/core-dotnet/GardenVR.sln",
      "shared/core-dotnet/GardenVR.Core/GardenVR.Core.csproj",
      "shared/core-dotnet/GardenVR.Core.Tests/GardenVR.Core.Tests.csproj",
    ];
    expect(toolchainChecksFromPaths(paths, "win32")).toEqual([
      {
        command: 'dotnet test "shared/core-dotnet/GardenVR.sln" --nologo',
        source: "detected: shared/core-dotnet/GardenVR.sln with a *Tests project (GardenVR.Core.Tests.csproj)",
      },
    ]);
  });

  it("detects nothing for a Unity-shaped solution, even one with a tests csproj", () => {
    const unity = ["apps/sundial/Sundial.sln", "apps/sundial/Sundial.Tests.csproj", "apps/sundial/ProjectSettings/ProjectVersion.txt"];
    expect(toolchainChecksFromPaths(unity, "linux")).toEqual([]);
    expect(toolchainChecksFromPaths(["Game.sln", "Game.Tests.csproj", "Assets/Scenes.meta"], "linux")).toEqual([]);
  });

  it("needs a tests project — a solution of libraries alone is not a test harness", () => {
    expect(toolchainChecksFromPaths(["App.sln", "App/App.csproj"], "linux")).toEqual([]);
  });

  it("ignores a solution deeper than three directories", () => {
    expect(toolchainChecksFromPaths(["a/b/c/d/X.sln", "a/b/c/d/X.Tests/X.Tests.csproj"], "linux")).toEqual([]);
  });
});

describe("what is never detected", () => {
  it("an Unreal tree — a .uproject beside its solution vetoes it, and nothing else applies", () => {
    const unreal = ["Game/Game.uproject", "Game/Game.sln", "Game/Source/Game/Game.cpp", "Game/Source/Game.Tests/Game.Tests.csproj"];
    expect(toolchainChecksFromPaths(unreal, "win32")).toEqual([]);
    expect(toolchainChecksFromPaths(["apps/vr/Game/MageArenaVR.uproject", "apps/vr/Game/Source/A.cpp"], "win32")).toEqual([]);
  });

  it("Python, CMake and a bare JS tree", () => {
    expect(toolchainChecksFromPaths(["pyproject.toml", "tests/test_a.py", "CMakeLists.txt", "package.json"], "linux")).toEqual([]);
  });

  it("anything at all from a listing too large to read whole", () => {
    expect(toolchainChecksFromPaths(Array.from({ length: MAX_TOOLCHAIN_PATHS + 1 }, () => "Cargo.toml"), "linux")).toEqual([]);
  });
});

describe("Cargo and Go, and the order between toolchains", () => {
  it("maps a root Cargo.toml and a root go.mod", () => {
    expect(toolchainChecksFromPaths(["Cargo.toml", "src/lib.rs"], "linux")).toEqual([{ command: "cargo test", source: "detected: Cargo.toml at the root" }]);
    expect(toolchainChecksFromPaths(["go.mod", "main.go"], "linux")).toEqual([{ command: "go test ./...", source: "detected: go.mod at the root" }]);
  });

  it("returns at most ONE check, the first rule that applies", () => {
    expect(toolchainChecksFromPaths([...WRAPPER, "Cargo.toml", "go.mod"], "linux")).toHaveLength(1);
    expect(toolchainChecksFromPaths(["go.mod", "Cargo.toml"], "linux")[0]?.command).toBe("cargo test");
  });

  it("ignores a nested manifest — only the root's licenses a root command", () => {
    expect(toolchainChecksFromPaths(["tools/Cargo.toml", "svc/go.mod"], "linux")).toEqual([]);
  });
});

describe("detectToolchainChecks (IO)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("falls back to a bounded walk when the directory is not a git checkout", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "toolchain-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "go.mod"), "module x\n");
    await mkdir(path.join(dir, "node_modules", "dep"), { recursive: true });
    await writeFile(path.join(dir, "node_modules", "dep", "Cargo.toml"), "");
    expect(await detectToolchainChecks(dir)).toEqual([{ command: "go test ./...", source: "detected: go.mod at the root" }]);
  });

  it("never throws for a directory that does not exist", async () => {
    expect(await detectToolchainChecks(path.join(os.tmpdir(), "toolchain-missing-dir-xyz"))).toEqual([]);
  });
});
