// The temp-file helper behind codex's --output-schema (backlog develop-2026-09-17 row 44). The
// adapter-level cases (tmpdir placement, argv, cleanup on success/failure/timeout/abort) live in
// schema-wire.codex.test.ts; this file pins the helper's own refusals.

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaFileError, withSchemaFile } from "./schema-file";

const roots: string[] = [];
function root(name: string): string {
  const dir = join(tmpdir(), `${name}-${process.pid}-${roots.length}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("withSchemaFile", () => {
  it("hands the callback a shell-quoted path to the written schema, then removes it", async () => {
    const base = root("ascent row44 spaced");
    let seen = "";
    const out = await withSchemaFile({ type: "object" }, async (quoted, path) => {
      seen = path;
      expect(quoted).toBe(`"${path}"`);
      expect(existsSync(path)).toBe(true);
      return 7;
    }, base);
    expect(out).toBe(7);
    expect(existsSync(seen)).toBe(false);
    expect(readdirSync(base)).toEqual([]);
  });

  it("accepts a temp root under a non-ASCII or apostrophe profile name (safe inside double quotes)", async () => {
    const base = root("ascent row44 Kazďa O'Brien");
    await expect(withSchemaFile({}, async (quoted) => quoted, base)).resolves.toMatch(/^".*schema\.json"$/);
    expect(readdirSync(base)).toEqual([]);
  });

  it("removes the file when the callback throws, and rethrows the callback's error", async () => {
    const base = root("ascent-row44-throw");
    const boom = new Error("boom");
    await expect(withSchemaFile({}, async () => { throw boom; }, base)).rejects.toBe(boom);
    expect(readdirSync(base)).toEqual([]);
  });

  it("refuses a temp root the shell would re-interpret, leaving nothing behind and never calling back", async () => {
    const base = root("ascent-row44-%PATH%");
    const use = vi.fn(async () => 1);
    await expect(withSchemaFile({}, use, base)).rejects.toBeInstanceOf(SchemaFileError);
    expect(use).not.toHaveBeenCalled();
    expect(readdirSync(base)).toEqual([]);
  });
});
