// DEV_INSPECT has ONE definition, with its production floor read first (AGENTS.md "A dangerous env
// flag is hard-disabled inside its OWN definition"). The flag arms a build transform that stamps
// repo-relative source paths into every host element, so a stray DEV_INSPECT=1 on a production
// build (a copied .env, a CI job reusing a dev profile) must be inert, not merely unused.
//
// Pinned three ways: the definition table, the loader's own gate (a production loader call returns
// the source untouched without requiring Babel), and next.config.ts's registration (a production
// config load registers no *.tsx / *.jsx loader).

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const FLAG = join(ROOT, "scripts", "dev-inspector", "dev-inspect-flag.cjs");
const LOADER = join(ROOT, "scripts", "dev-inspector", "source-loc-loader.cjs");

type Env = Record<string, string | undefined>;
const flag = (): { devInspectEnabled: (env?: Env) => boolean } => require(FLAG);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("devInspectEnabled - the one definition", () => {
  it("is false in production even with DEV_INSPECT=1 (the floor reads first)", () => {
    expect(flag().devInspectEnabled({ NODE_ENV: "production", DEV_INSPECT: "1" })).toBe(false);
  });

  it("is true in development only for the exact spelling the dev:inspect script sets", () => {
    const { devInspectEnabled } = flag();
    expect(devInspectEnabled({ NODE_ENV: "development", DEV_INSPECT: "1" })).toBe(true);
    expect(devInspectEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devInspectEnabled({ NODE_ENV: "development", DEV_INSPECT: "0" })).toBe(false);
    expect(devInspectEnabled({ NODE_ENV: "development", DEV_INSPECT: "true" })).toBe(false);
  });

  it("defaults to process.env", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_INSPECT", "1");
    expect(flag().devInspectEnabled()).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(flag().devInspectEnabled()).toBe(false);
  });
});

type LoaderResult = { err: unknown; code: unknown };

function runLoader(source: string): Promise<LoaderResult> {
  const loader: (this: unknown, src: string, map?: unknown, meta?: unknown) => void = require(LOADER);
  return new Promise((resolve) => {
    const ctx = {
      resourcePath: join(ROOT, "src", "x", "Foo.tsx"),
      getOptions: () => ({ rootDir: ROOT }),
      async: () => (err: unknown, code: unknown) => resolve({ err, code }),
    };
    loader.call(ctx, source);
  });
}

describe("source-loc-loader gate", () => {
  const SOURCE = "export function Foo() { return <div>hi</div>; }\n";

  it("passes the source through untouched in production and never requires @babel/core", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_INSPECT", "1");
    const Module = require("node:module") as { _load: (...args: unknown[]) => unknown };
    const load = vi.spyOn(Module, "_load");
    const res = await runLoader(SOURCE);
    expect(res.err).toBeNull();
    expect(res.code).toBe(SOURCE);
    expect(String(res.code)).not.toContain("data-loc");
    expect(load.mock.calls.some((c) => c[0] === "@babel/core")).toBe(false);
  });

  it("still stamps data-loc in a development inspect session (behaviour unchanged)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_INSPECT", "1");
    const res = await runLoader(SOURCE);
    expect(res.err).toBeNull();
    expect(String(res.code)).toContain('data-loc="src/x/Foo.tsx:1:');
  });
});

type LoaderRules = Record<string, unknown> | undefined;

async function loadConfigRules(): Promise<LoaderRules> {
  vi.resetModules();
  const mod = (await import("../../../next.config")) as { default: { turbopack?: { rules?: LoaderRules } } };
  return mod.default.turbopack?.rules;
}

describe("next.config.ts registration", () => {
  it("registers no *.tsx / *.jsx loader on a production config load with DEV_INSPECT=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_INSPECT", "1");
    const rules = await loadConfigRules();
    expect(rules?.["*.tsx"]).toBeUndefined();
    expect(rules?.["*.jsx"]).toBeUndefined();
  });

  it("registers both loaders on a development config load with DEV_INSPECT=1 (behaviour unchanged)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_INSPECT", "1");
    const rules = await loadConfigRules();
    expect(rules?.["*.tsx"]).toBeDefined();
    expect(rules?.["*.jsx"]).toBeDefined();
  });

  it("registers nothing on a plain development config load", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_INSPECT", "");
    const rules = await loadConfigRules();
    expect(rules?.["*.tsx"]).toBeUndefined();
  });
});
