// Golden + determinism tests for the tech-stack extractor (Feature 3a). The extractor is PURE — these
// drive synthetic snapshots that exercise each detection path (Node frontend/backend, Python, Go, JVM,
// mobile, data/ML, infra, library, unknown) and pin the multi-role output, then assert determinism
// (same snapshot -> byte-identical TechStack) and the tolerant read-path parser. Determinism is
// load-bearing: it's what keeps re-scans byte-identical (the extractor never feeds the score).

import { describe, it, expect } from "vitest";
import { extractTechStack, parseTechStackJson } from "@/lib/analyze/tech-extract";
import type { RepoMeta, RepoSnapshot } from "@/lib/types";

function meta(over: Partial<RepoMeta> = {}): RepoMeta {
  return { owner: "o", name: "r", url: "https://x", stars: 0, forks: 0, defaultBranch: "main", ...over };
}
type Snap = Pick<RepoSnapshot, "meta" | "tree" | "files" | "coverage">;
function snap(opts: { lang?: string; tree?: string[]; files?: Record<string, string>; coverage?: number }): Snap {
  return {
    meta: meta({ primaryLanguage: opts.lang }),
    tree: (opts.tree ?? []).map((p) => ({ path: p, type: "blob" as const })),
    files: Object.entries(opts.files ?? {}).map(([path, content]) => ({ path, content, bytes: content.length })),
    coverage: opts.coverage ?? 1,
  };
}
const pkg = (deps: Record<string, string>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ dependencies: deps, ...extra });

describe("extractTechStack — per-stack golden output", () => {
  it("Next.js frontend (react+next, .tsx tree) → frontend role, TS language", () => {
    const t = extractTechStack(snap({ lang: "TypeScript", tree: ["src/app/page.tsx"], files: { "package.json": pkg({ react: "^18", next: "^15" }) } }));
    expect(t.roles).toContain("frontend");
    expect(t.frameworks).toEqual(expect.arrayContaining(["React", "Next.js"]));
    expect(t.languages).toContain("TypeScript");
    expect(t.backendLanguage).toBeUndefined();
  });

  it("FastAPI backend → backend role + Python backendLanguage", () => {
    const t = extractTechStack(snap({ lang: "Python", files: { "pyproject.toml": "[project]\ndependencies=['fastapi']" } }));
    expect(t.roles).toEqual(["backend"]);
    expect(t.frameworks).toContain("FastAPI");
    expect(t.backendLanguage).toBe("Python");
    expect(t.languages).toContain("Python");
  });

  it("fullstack (react + express) → BOTH frontend and backend (multi-role), Node backend", () => {
    const t = extractTechStack(snap({ lang: "TypeScript", files: { "package.json": pkg({ react: "^18", express: "^4" }) } }));
    expect(t.roles).toEqual(expect.arrayContaining(["frontend", "backend"]));
    expect(t.backendLanguage).toBe("Node");
  });

  it("Go (go.mod + gin) → Go backend + Gin", () => {
    const t = extractTechStack(snap({ lang: "Go", files: { "go.mod": "module x\nrequire github.com/gin-gonic/gin v1.9.0" } }));
    expect(t.roles).toEqual(["backend"]);
    expect(t.languages).toContain("Go");
    expect(t.frameworks).toContain("Gin");
    expect(t.backendLanguage).toBe("Go");
  });

  it("data/ML (notebooks + numpy/pandas) → data_ml role", () => {
    const t = extractTechStack(snap({ lang: "Python", tree: ["notebooks/explore.ipynb"], files: { "requirements.txt": "numpy\npandas\n" } }));
    expect(t.roles).toContain("data_ml");
    expect(t.frameworks).toEqual(expect.arrayContaining(["Jupyter", "NumPy", "pandas"]));
  });

  it("mobile (react-native) → mobile role", () => {
    const t = extractTechStack(snap({ lang: "TypeScript", files: { "package.json": pkg({ "react-native": "^0.74" }) } }));
    expect(t.roles).toContain("mobile");
    expect(t.frameworks).toContain("React Native");
  });

  it("infra (terraform) → infra role", () => {
    const t = extractTechStack(snap({ tree: ["infra/main.tf"] }));
    expect(t.roles).toContain("infra");
    expect(t.frameworks).toContain("Terraform");
  });

  it("library (package with main, no app framework) → library role", () => {
    const t = extractTechStack(snap({ files: { "package.json": pkg({ lodash: "^4" }, { main: "index.js" }) } }));
    expect(t.roles).toEqual(["library"]);
  });

  it("nothing detectable → unknown role + low confidence", () => {
    const t = extractTechStack(snap({}));
    expect(t.roles).toEqual(["unknown"]);
    expect(t.confidence).toBeGreaterThan(0);
    expect(t.confidence).toBeLessThan(0.5);
  });

  it("confidence is always within [0,1]", () => {
    const t = extractTechStack(snap({ lang: "Go", files: { "go.mod": "module x" }, coverage: 0.5 }));
    expect(t.confidence).toBeGreaterThanOrEqual(0);
    expect(t.confidence).toBeLessThanOrEqual(1);
  });
});

describe("extractTechStack — determinism (load-bearing for byte-identical re-scans)", () => {
  it("yields byte-identical output for the same snapshot", () => {
    const s = snap({ lang: "TypeScript", tree: ["src/app/page.tsx", "infra/main.tf"], files: { "package.json": pkg({ react: "^18", express: "^4" }) } });
    expect(extractTechStack(s)).toEqual(extractTechStack(s));
  });

  it("orders languages with the primary language first, rest alphabetical", () => {
    const t = extractTechStack(snap({ lang: "Go", files: { "go.mod": "module x", "package.json": pkg({ react: "^18" }), "pyproject.toml": "x" } }));
    expect(t.languages[0]).toBe("Go");
    expect([...t.languages].slice(1)).toEqual([...t.languages].slice(1).sort());
  });
});

describe("parseTechStackJson — tolerant read path", () => {
  it("round-trips an extracted stack", () => {
    const t = extractTechStack(snap({ lang: "Python", files: { "pyproject.toml": "fastapi" } }));
    expect(parseTechStackJson(JSON.stringify(t))).toEqual(t);
  });
  it("returns null for null / malformed / wrong-shape input", () => {
    expect(parseTechStackJson(null)).toBeNull();
    expect(parseTechStackJson("not json")).toBeNull();
    expect(parseTechStackJson("{}")).toBeNull(); // no roles array
  });
});
