// Tech-stack extraction (Feature 3a) — a PURE, deterministic function of the snapshot. It reads the
// already-fetched manifests (package.json, pyproject.toml, go.mod, cargo.toml, pom.xml, build.gradle,
// gemfile, composer.json, …), the file tree, and the GitHub primary language to derive a repo's
// languages, frameworks, roles (frontend / backend / mobile / data_ml / infra / library — MULTI), the
// primary backend language (for "Backend·<lang>" grouping), and a confidence. It is NOT fed to the LLM
// prompt or the score (Option A, display-only) so scans stay byte-identical — see docs/CALIBRATION.md.
//
// DETERMINISM IS LOAD-BEARING: snapshot-only, no Date.now / IO / env / Math.random. Same snapshot →
// byte-identical TechStack (pinned by a re-run test). Detection is conservative + manifest-first:
// manifest evidence beats filename heuristics, and confidence drops when manifests are missing.

import type { RepoSnapshot, StackRole, TechStack } from "@/lib/types";

// dep-name -> display label, split by role. Matched against package.json deps+devDeps (exact key).
const NODE_FRONTEND: Record<string, string> = {
  react: "React",
  "react-dom": "React",
  next: "Next.js",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  "@angular/core": "Angular",
  "solid-js": "SolidJS",
  astro: "Astro",
  "@remix-run/react": "Remix",
  gatsby: "Gatsby",
};
const NODE_BACKEND: Record<string, string> = {
  express: "Express",
  koa: "Koa",
  "@nestjs/core": "NestJS",
  fastify: "Fastify",
  "@hapi/hapi": "hapi",
  hapi: "hapi",
};
const NODE_MOBILE: Record<string, string> = {
  "react-native": "React Native",
  expo: "Expo",
};

// substring -> label for non-JSON manifests (matched case-insensitively in the raw file text).
const PY_FRAMEWORKS: { needle: string; label: string; role: StackRole }[] = [
  { needle: "django", label: "Django", role: "backend" },
  { needle: "flask", label: "Flask", role: "backend" },
  { needle: "fastapi", label: "FastAPI", role: "backend" },
];
const PY_DATA: { needle: string; label: string }[] = [
  { needle: "numpy", label: "NumPy" },
  { needle: "pandas", label: "pandas" },
  { needle: "torch", label: "PyTorch" },
  { needle: "tensorflow", label: "TensorFlow" },
  { needle: "scikit-learn", label: "scikit-learn" },
  { needle: "keras", label: "Keras" },
];
const GO_FRAMEWORKS: { needle: string; label: string }[] = [
  { needle: "gin-gonic/gin", label: "Gin" },
  { needle: "labstack/echo", label: "Echo" },
  { needle: "gofiber/fiber", label: "Fiber" },
];

function uniqSorted(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/** Parse a package.json's combined dependency keys (deps + devDeps + peer). Tolerant — [] on bad JSON. */
function packageDeps(text: string): string[] {
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const keys: string[] = [];
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const obj = json[field];
      if (obj && typeof obj === "object") keys.push(...Object.keys(obj as Record<string, unknown>));
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Extract a repo's tech stack from a snapshot. Pure + deterministic.
 */
export function extractTechStack(snap: Pick<RepoSnapshot, "meta" | "tree" | "files" | "coverage">): TechStack {
  const fileByPath = new Map(snap.files.map((f) => [f.path.toLowerCase(), f.content]));
  const get = (p: string) => fileByPath.get(p) ?? fileByPath.get(p.replace(/^\.\//, ""));
  const lowerPaths = snap.tree.map((t) => t.path.toLowerCase());
  const hasPath = (pred: (p: string) => boolean) => lowerPaths.some(pred);
  const primaryLang = (snap.meta.primaryLanguage ?? "").trim();

  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const roles = new Set<StackRole>();
  let backendLanguage: string | undefined;
  let manifests = 0;

  if (primaryLang) languages.add(primaryLang);

  // ── Node / JS-TS ecosystem (package.json) ──────────────────────────────────────────────────────
  const pkg = get("package.json");
  if (pkg !== undefined) {
    manifests++;
    const tsconfig = get("tsconfig.json") !== undefined || hasPath((p) => p.endsWith(".ts") || p.endsWith(".tsx"));
    languages.add(tsconfig ? "TypeScript" : "JavaScript");
    const deps = packageDeps(pkg);
    for (const d of deps) {
      if (NODE_FRONTEND[d]) {
        frameworks.add(NODE_FRONTEND[d]);
        roles.add("frontend");
      }
      if (NODE_BACKEND[d]) {
        frameworks.add(NODE_BACKEND[d]);
        roles.add("backend");
        backendLanguage ??= "Node";
      }
      if (NODE_MOBILE[d]) {
        frameworks.add(NODE_MOBILE[d]);
        roles.add("mobile");
      }
    }
  }

  // ── Python (pyproject.toml / requirements.txt) ─────────────────────────────────────────────────
  const pyText = [get("pyproject.toml"), get("requirements.txt"), get("setup.py")].filter(Boolean).join("\n").toLowerCase();
  const hasPy = pyText.length > 0 || /python/i.test(primaryLang) || hasPath((p) => p.endsWith(".py"));
  if (pyText.length > 0 || /python/i.test(primaryLang)) {
    if (get("pyproject.toml") !== undefined || get("requirements.txt") !== undefined) manifests++;
    if (hasPy) languages.add("Python");
    for (const f of PY_FRAMEWORKS) {
      if (pyText.includes(f.needle)) {
        frameworks.add(f.label);
        roles.add(f.role);
        backendLanguage ??= "Python";
      }
    }
    for (const f of PY_DATA) {
      if (pyText.includes(f.needle)) {
        frameworks.add(f.label);
        roles.add("data_ml");
      }
    }
  }

  // ── Go (go.mod) ────────────────────────────────────────────────────────────────────────────────
  const goMod = get("go.mod");
  if (goMod !== undefined) {
    manifests++;
    languages.add("Go");
    roles.add("backend");
    backendLanguage ??= "Go";
    const lower = goMod.toLowerCase();
    for (const f of GO_FRAMEWORKS) if (lower.includes(f.needle)) frameworks.add(f.label);
  }

  // ── Rust (cargo.toml) ──────────────────────────────────────────────────────────────────────────
  if (get("cargo.toml") !== undefined) {
    manifests++;
    languages.add("Rust");
    roles.add("backend");
    backendLanguage ??= "Rust";
  }

  // ── Ruby (gemfile) ─────────────────────────────────────────────────────────────────────────────
  const gemfile = get("gemfile");
  if (gemfile !== undefined) {
    manifests++;
    languages.add("Ruby");
    roles.add("backend");
    backendLanguage ??= "Ruby";
    if (/\brails\b/i.test(gemfile)) frameworks.add("Rails");
  }

  // ── PHP (composer.json) ────────────────────────────────────────────────────────────────────────
  const composer = get("composer.json");
  if (composer !== undefined) {
    manifests++;
    languages.add("PHP");
    roles.add("backend");
    backendLanguage ??= "PHP";
    const lower = composer.toLowerCase();
    if (lower.includes("laravel/framework")) frameworks.add("Laravel");
    if (lower.includes("symfony/")) frameworks.add("Symfony");
  }

  // ── JVM (pom.xml / build.gradle) — Android-aware ───────────────────────────────────────────────
  const pom = get("pom.xml");
  const gradle = [get("build.gradle"), get("build.gradle.kts")].filter(Boolean).join("\n");
  if (pom !== undefined || gradle.length > 0) {
    manifests++;
    const isKotlin = get("build.gradle.kts") !== undefined || hasPath((p) => p.endsWith(".kt") || p.endsWith(".kts"));
    const jvmText = `${pom ?? ""}\n${gradle}`.toLowerCase();
    const isAndroid = jvmText.includes("com.android") || hasPath((p) => p.endsWith("androidmanifest.xml"));
    if (isAndroid) {
      languages.add(isKotlin ? "Kotlin" : "Java");
      roles.add("mobile");
      frameworks.add("Android");
    } else {
      languages.add(isKotlin ? "Kotlin" : "Java");
      roles.add("backend");
      backendLanguage ??= isKotlin ? "Kotlin" : "Java";
      if (jvmText.includes("springframework") || jvmText.includes("spring-boot")) frameworks.add("Spring");
    }
  }

  // ── Native mobile (Swift / iOS / Flutter) ──────────────────────────────────────────────────────
  if (
    hasPath((p) => p.endsWith("package.swift") || p.endsWith("podfile") || p.endsWith(".xcodeproj") || p.includes(".xcodeproj/")) ||
    /swift|objective-c/i.test(primaryLang)
  ) {
    languages.add("Swift");
    roles.add("mobile");
    frameworks.add("iOS");
  }
  if (get("pubspec.yaml") !== undefined || /dart/i.test(primaryLang)) {
    manifests += get("pubspec.yaml") !== undefined ? 1 : 0;
    languages.add("Dart");
    roles.add("mobile");
    frameworks.add("Flutter");
  }

  // ── Data / ML by notebooks ─────────────────────────────────────────────────────────────────────
  if (/jupyter/i.test(primaryLang) || hasPath((p) => p.endsWith(".ipynb"))) {
    roles.add("data_ml");
    if (hasPath((p) => p.endsWith(".ipynb"))) frameworks.add("Jupyter");
  }

  // ── Infra (Terraform / Helm / Kubernetes / Ansible) ────────────────────────────────────────────
  if (hasPath((p) => p.endsWith(".tf"))) {
    roles.add("infra");
    frameworks.add("Terraform");
  }
  if (hasPath((p) => p.endsWith("chart.yaml") || (p.includes("/templates/") && p.endsWith(".yaml")))) {
    roles.add("infra");
    frameworks.add("Helm");
  }
  if (hasPath((p) => p.endsWith("kustomization.yaml") || p.endsWith("kustomization.yml"))) {
    roles.add("infra");
    frameworks.add("Kubernetes");
  }

  // ── Library fallback: a package with no app role detected (a publishable lib, not an app/service) ─
  if (roles.size === 0 && pkg !== undefined) {
    try {
      const json = JSON.parse(pkg) as Record<string, unknown>;
      if (json.main || json.module || json.exports || json.types) roles.add("library");
    } catch {
      /* ignore */
    }
  }

  if (roles.size === 0) roles.add("unknown");

  // Confidence: a base that rises with the number of manifests found, scaled by inspect coverage.
  const coverage = Number.isFinite(snap.coverage) ? Math.max(0, Math.min(1, snap.coverage)) : 1;
  const base = manifests > 0 ? Math.min(0.9, 0.45 + manifests * 0.12) : 0.2;
  const confidence = Math.round(base * (0.5 + 0.5 * coverage) * 100) / 100;

  const roleOrder: StackRole[] = ["frontend", "backend", "mobile", "data_ml", "infra", "library", "unknown"];
  const sortedRoles = roleOrder.filter((r) => roles.has(r));

  return {
    languages: orderLanguages([...languages], primaryLang),
    frameworks: uniqSorted([...frameworks]),
    roles: sortedRoles,
    ...(backendLanguage ? { backendLanguage } : {}),
    confidence,
  };
}

/** Tolerant parse of a persisted TechStack JSON blob (Repository/Scan.techStackJson) — null on a
 *  missing/malformed value so a read path degrades to "no tech" instead of throwing. */
export function parseTechStackJson(raw: string | null | undefined): TechStack | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TechStack>;
    if (!v || !Array.isArray(v.roles)) return null;
    const strs = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : []);
    return {
      languages: strs(v.languages),
      frameworks: strs(v.frameworks),
      roles: strs(v.roles) as StackRole[],
      ...(typeof v.backendLanguage === "string" ? { backendLanguage: v.backendLanguage } : {}),
      confidence: typeof v.confidence === "number" ? v.confidence : 0,
    };
  } catch {
    return null;
  }
}

/** Languages with the GitHub primary language first (if present), the rest alphabetical — stable. */
function orderLanguages(langs: string[], primary: string): string[] {
  const rest = uniqSorted(langs.filter((l) => l !== primary));
  return primary && langs.includes(primary) ? [primary, ...rest] : rest;
}
