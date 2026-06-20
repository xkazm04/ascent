import { describe, it, expect } from "vitest";
import { detectStackFit, stackFitFromLanguage } from "./stack-fit";
import type { RepoSnapshot } from "@/lib/types";

function snap(primaryLanguage: string | undefined, paths: string[]): Pick<RepoSnapshot, "meta" | "tree"> {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", primaryLanguage },
    tree: paths.map((p) => ({ path: p, type: "blob" as const })),
  };
}

describe("detectStackFit (full — language + file tree)", () => {
  it("flags ML for a notebook-first language", () => {
    expect(detectStackFit(snap("Jupyter Notebook", ["train.ipynb"]))?.stack).toBe("ml");
  });

  it("flags ML for notebooks inside a repo GitHub labels 'Python' (weak-language case)", () => {
    expect(detectStackFit(snap("Python", ["a.ipynb", "b.ipynb", "c.ipynb", "src/x.py"]))?.stack).toBe("ml");
  });

  it("flags mobile for a strong mobile language, and for a Kotlin app with a manifest", () => {
    expect(detectStackFit(snap("Swift", ["App.swift"]))?.stack).toBe("mobile");
    expect(detectStackFit(snap("Kotlin", ["app/src/main/AndroidManifest.xml"]))?.stack).toBe("mobile");
    expect(detectStackFit(snap("Ruby", ["fastlane/Fastfile"]))?.stack).toBe("mobile");
  });

  it("flags embedded only with a systems language AND a firmware signal AND no web manifest", () => {
    expect(detectStackFit(snap("C", ["src/main.c", "platformio.ini"]))?.stack).toBe("embedded");
    expect(detectStackFit(snap("Rust", ["firmware.rs", "memory.ld"]))?.stack).toBe("embedded");
    // A systems language without a firmware signal is NOT flagged (avoids false positives on C++ apps).
    expect(detectStackFit(snap("C++", ["src/main.cpp", "CMakeLists.txt"]))).toBeNull();
    // A firmware signal but the repo is also web-ish (package.json) → not embedded.
    expect(detectStackFit(snap("C", ["main.c", "platformio.ini", "package.json"]))).toBeNull();
  });

  it("returns null (full fit, no caveat) for a normal web/service repo", () => {
    expect(detectStackFit(snap("TypeScript", ["src/index.ts", "package.json"]))).toBeNull();
    expect(detectStackFit(snap("Go", ["main.go", "go.mod"]))).toBeNull();
  });
});

describe("stackFitFromLanguage (durable read-time signal — language only)", () => {
  it("flags ml/mobile from a strong language", () => {
    expect(stackFitFromLanguage("Jupyter Notebook")?.stack).toBe("ml");
    expect(stackFitFromLanguage("Swift")?.stack).toBe("mobile");
    expect(stackFitFromLanguage("Dart")?.stack).toBe("mobile");
  });

  it("does not guess embedded or full-fit stacks from language alone", () => {
    expect(stackFitFromLanguage("C++")).toBeNull(); // too broad without a tree signal
    expect(stackFitFromLanguage("TypeScript")).toBeNull();
    expect(stackFitFromLanguage(null)).toBeNull();
    expect(stackFitFromLanguage("")).toBeNull();
  });
});
