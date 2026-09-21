// THE RULER AN ARCHITECTURE MOVE IS MEASURED AGAINST — the three partition sources over real temp
// directories, the name-status parser, and the move detector as a table.

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleOf, modulePartition, movesInDiff, parseNameStatus, type NameStatusEntry } from "./module-partition";
import { cargoWorkspaceGlobs, pnpmWorkspaceGlobs } from "./module-partition-sources";
import type { ModulePartition } from "./runner-types";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ascent-partition-"));
  dirs.push(dir);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body, "utf8");
  }
  return dir;
}

describe("modulePartition — first source wins", () => {
  it("reads a context map's file paths as directory prefixes, dropping stale entries and the root", async () => {
    const map = {
      groups: [{ contexts: [{ filePaths: ["src/lib/a/x.ts", "src/lib/b/y.ts", "gone/z.ts", "package.json"] }] }],
      ungrouped: [{ filePaths: ["scripts/run.mjs"] }],
    };
    const dir = tree({
      "context-map.json": JSON.stringify(map),
      "src/lib/a/x.ts": "",
      "src/lib/b/y.ts": "",
      "scripts/run.mjs": "",
      "package.json": JSON.stringify({ workspaces: ["src/lib/*"] }),
    });
    const p = await modulePartition(dir);
    expect(p).toEqual({ source: "context-map", modules: ["src/lib/a/", "src/lib/b/", "scripts/"] });
  });

  it("falls to workspace roots — npm globs (with exclusions), nested go.mod, Cargo members", async () => {
    const dir = tree({
      "package.json": JSON.stringify({ workspaces: { packages: ["packages/*", "!packages/skip"] } }),
      "packages/a/package.json": "{}",
      "packages/b/package.json": "{}",
      "packages/skip/package.json": "{}",
      "packages/notes/README.md": "no manifest, not a workspace",
      "go.mod": "module root",
      "services/api/go.mod": "module api",
      "Cargo.toml": '[workspace]\nmembers = [\n  "crates/*",\n]\n[profile.release]\n',
      "crates/core/Cargo.toml": "",
    });
    const p = await modulePartition(dir);
    expect(p.source).toBe("workspace");
    expect(p.modules).toEqual(["services/api/", "crates/core/", "packages/a/", "packages/b/"]);
  });

  it("reads pnpm and Cargo workspace lists", () => {
    expect(pnpmWorkspaceGlobs("packages:\n  - 'apps/*'\n  - \"libs/**\" # all\nother: x\n  - nope\n")).toEqual(["apps/*", "libs/**"]);
    expect(cargoWorkspaceGlobs('[package]\nname="x"\n[workspace]\nmembers = ["a", \'b/*\']\n')).toEqual(["a", "b/*"]);
  });

  it("falls to depth-2 directories under the first source root", async () => {
    const dir = tree({ "src/lib/db/x.ts": "", "src/lib/local/y.ts": "", "src/app/api/r.ts": "", "src/index.ts": "", "lib/other/deep/z.ts": "" });
    expect(await modulePartition(dir)).toEqual({ source: "directory", modules: ["src/lib/local/", "src/app/api/", "src/lib/db/"] });
  });

  it("uses depth-1 at the repo root when no source root exists, never a dot-directory", async () => {
    const dir = tree({ "tools/a.py": "", "docs/readme.md": "", ".github/workflows/ci.yml": "", "top.txt": "" });
    expect(await modulePartition(dir)).toEqual({ source: "directory", modules: ["tools/", "docs/"] });
  });

  it("reads TRACKED files in a git checkout, so untracked output never becomes a module", async () => {
    const dir = tree({ "src/lib/db/x.ts": "", "src/lib/local/y.ts": "" });
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "seed");
    mkdirSync(join(dir, "src", "gen", "out"), { recursive: true });
    writeFileSync(join(dir, "src", "gen", "out", "built.js"), "", "utf8");
    expect((await modulePartition(dir)).modules).toEqual(["src/lib/local/", "src/lib/db/"]);
  });
});

describe("parseNameStatus", () => {
  it("parses the line format: scores, copies, type changes, quoted paths; skips unknown letters", () => {
    const raw = ["M\tsrc/a.ts", "R087\tsrc/old.ts\tsrc/new.ts", "C100\ta.ts\tb.ts", "T\tlink", "U\tconflict.ts", 'A\t"we\\tird.ts"', "D\tgone.ts", ""].join("\n");
    expect(parseNameStatus(raw)).toEqual([
      { status: "M", path: "src/a.ts", from: null },
      { status: "R", path: "src/new.ts", from: "src/old.ts" },
      { status: "C", path: "b.ts", from: "a.ts" },
      { status: "T", path: "link", from: null },
      { status: "A", path: "we\tird.ts", from: null },
      { status: "D", path: "gone.ts", from: null },
    ]);
  });

  it("parses the -z format", () => {
    expect(parseNameStatus("M\0a.ts\0R100\0x/o.ts\0y/o.ts\0D\0z.ts\0")).toEqual([
      { status: "M", path: "a.ts", from: null },
      { status: "R", path: "y/o.ts", from: "x/o.ts" },
      { status: "D", path: "z.ts", from: null },
    ]);
  });
});

const DIR: ModulePartition = { source: "directory", modules: ["src/lib/local/", "src/app/api/", "src/lib/big/", "src/lib/db/"] };
const BEFORE = ["src/lib/db/a.ts", "src/lib/db/b.ts", "src/lib/local/c.ts", "src/app/api/r.ts", "src/lib/big/one.ts", "src/lib/big/two.ts", "src/lib/big/three.ts", "src/lib/legacy/old.ts", "README.md"];
const A = (path: string): NameStatusEntry => ({ status: "A", path, from: null });
const D = (path: string): NameStatusEntry => ({ status: "D", path, from: null });
const R = (from: string, path: string): NameStatusEntry => ({ status: "R", path, from });

describe("movesInDiff — a directory partition", () => {
  it.each<[string, NameStatusEntry[], ReturnType<typeof movesInDiff>]>([
    ["an edit is no move", [{ status: "M", path: "src/lib/db/a.ts", from: null }], []],
    ["a rename inside a leaf module is internal structure", [R("src/lib/db/a.ts", "src/lib/db/sub/a.ts")], []],
    ["a rename across modules", [R("src/lib/db/a.ts", "src/lib/local/a.ts")], [{ kind: "cross-module-move", from: "src/lib/db/", to: "src/lib/local/" }]],
    ["a new peer directory is a module created", [A("src/lib/fresh/x.ts"), A("src/lib/fresh/y.ts")], [{ kind: "module-created", from: null, to: "src/lib/fresh/" }]],
    ["a directory that already held files is not new", [A("src/lib/legacy/new.ts")], []],
    ["a dot-directory never counts", [A("src/lib/.cache/x")], []],
    ["a loose root file is no module", [A("NOTES.md"), R("README.md", "docs/README.md")], []],
    ["losing SOME files is not removal", [D("src/lib/db/a.ts")], []],
    ["losing EVERY file is removal", [D("src/lib/db/a.ts"), D("src/lib/db/b.ts")], [{ kind: "module-removed", from: "src/lib/db/", to: null }]],
    [
      "renaming a module's only file away is a move AND a removal",
      [R("src/lib/local/c.ts", "src/app/api/c.ts")],
      [
        { kind: "module-removed", from: "src/lib/local/", to: null },
        { kind: "cross-module-move", from: "src/lib/local/", to: "src/app/api/" },
      ],
    ],
    [
      "one module into two NEW modules is a split",
      [R("src/lib/big/one.ts", "src/lib/alpha/one.ts"), R("src/lib/big/two.ts", "src/lib/beta/two.ts")],
      [
        { kind: "module-created", from: null, to: "src/lib/alpha/" },
        { kind: "module-created", from: null, to: "src/lib/beta/" },
        { kind: "module-split", from: "src/lib/big/", to: "src/lib/alpha/" },
        { kind: "module-split", from: "src/lib/big/", to: "src/lib/beta/" },
      ],
    ],
    [
      "two modules into one NEW module is a merge",
      [R("src/lib/db/a.ts", "src/lib/merged/a.ts"), R("src/lib/local/c.ts", "src/lib/merged/c.ts")],
      [
        { kind: "module-created", from: null, to: "src/lib/merged/" },
        { kind: "module-removed", from: "src/lib/local/", to: null },
        { kind: "module-merged", from: "src/lib/db/", to: "src/lib/merged/" },
        { kind: "module-merged", from: "src/lib/local/", to: "src/lib/merged/" },
      ],
    ],
    ["extracting into ONE new module is its creation only", [R("src/lib/big/one.ts", "src/lib/solo/one.ts")], [{ kind: "module-created", from: null, to: "src/lib/solo/" }]],
  ])("%s", (_name, entries, expected) => {
    expect(movesInDiff(entries, DIR, BEFORE)).toEqual(expected);
  });
});

describe("movesInDiff — workspace and nested context-map partitions", () => {
  it("a new package is created; a new folder inside a package is not", () => {
    const ws: ModulePartition = { source: "workspace", modules: ["packages/a/", "packages/b/"] };
    const before = ["packages/a/index.ts", "packages/b/index.ts"];
    expect(movesInDiff([A("packages/c/index.ts"), A("packages/a/src/new/x.ts")], ws, before)).toEqual([{ kind: "module-created", from: null, to: "packages/c/" }]);
  });

  it("a nested map treats a new peer of child modules as created, a subfolder of a leaf as internal", () => {
    const ctx: ModulePartition = { source: "context-map", modules: ["src/lib/db/", "src/lib/", "src/"] };
    const before = ["src/main.ts", "src/lib/x.ts", "src/lib/db/a.ts"];
    expect(movesInDiff([A("src/lib/newthing/x.ts"), A("src/lib/db/deeper/x.ts")], ctx, before)).toEqual([{ kind: "module-created", from: null, to: "src/lib/newthing/" }]);
    expect(moduleOf(ctx, "src/lib/db/deeper/x.ts")).toBe("src/lib/db/");
    expect(moduleOf(ctx, "README.md")).toBeNull();
  });
});
