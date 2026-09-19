// Local registry pairing against a REAL temporary git checkout: the registry-lane check, the committed
// tree the local source indexes, the git-backed skill history, and the working-tree standards reader
// the local conformance sweep uses. The db writers are not exercised here (pairLocalRegistry is a thin
// upsert + indexRegistry over these same pieces).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGit } from "@/lib/local/git";
import { localRegistryDir, verifyLocalRegistry } from "./local-registry";
import { listLocalPathCommits, localSource, readLocalFileAtRef } from "./local-source";
import { gitBlobSha, readLocalStandardsFiles } from "./conformance-read-local";

let root: string;
let registry: string;
let plain: string;

async function repo(dir: string, files: Record<string, string>, message: string) {
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), text);
  }
  await runGit(dir, ["add", "-A"]);
  const r = await runGit(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", message]);
  if (!r.ok) throw new Error(r.stderr);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ascent-local-registry-"));
  registry = path.join(root, "ai-registry");
  plain = path.join(root, "app");
  for (const dir of [registry, plain]) {
    await mkdir(dir, { recursive: true });
    await runGit(dir, ["init", "-q", "-b", "main"]);
  }
  await repo(registry, { "skills/forge/SKILL.md": "---\nname: forge\nversion: 1.0.0\n---\n" }, "seed");
  await repo(registry, { "skills/forge/SKILL.md": "---\nname: forge\nversion: 1.1.0\n---\n" }, "bump");
  await writeFile(path.join(registry, "skills", "forge", "SKILL.md"), "uncommitted edit");
  await repo(plain, { "README.md": "app", ".ai/registry-map.json": '{"schema":"x"}' }, "app");
  await writeFile(path.join(plain, ".ai", "consults.jsonl"), '{"t":1}\n');
}, 30_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("verifyLocalRegistry", () => {
  it("accepts a checkout with a registry lane and names it local/<folder> when it has no origin", async () => {
    const check = await verifyLocalRegistry(registry);
    expect(check).toMatchObject({ ok: true, lanes: ["skills"], fullName: "local/ai-registry", branch: "main" });
  });

  it("refuses a git repo that carries no registry lane, saying which lanes it looked for", async () => {
    const check = await verifyLocalRegistry(plain);
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/skills, practices, memory, knowledge/);
  });
});

describe("localSource", () => {
  it("indexes the COMMITTED tree — an uncommitted edit is not what a pass reads", async () => {
    const source = localSource(registry);
    const tree = await source.readTree("main");
    const entry = tree.entries.find((e) => e.path === "skills/forge/SKILL.md")!;
    expect(await source.readBlob(entry)).toContain("version: 1.1.0");
    expect(source.token).toBeUndefined();
    expect(source.sweep).toBeDefined();
  });

  it("lists a path's history newest first and reads the file at each commit", async () => {
    const { commits, truncated } = await listLocalPathCommits(registry, "skills/forge/SKILL.md", "HEAD", 1);
    expect(commits).toHaveLength(1);
    expect(truncated).toBe(true);
    expect(commits[0]).toMatchObject({ message: "bump", authorLogin: null });
    expect(await readLocalFileAtRef(registry, "skills/forge/SKILL.md", commits[0]!.sha)).toContain("1.1.0");
    expect(await readLocalFileAtRef(registry, "skills/nope/SKILL.md", commits[0]!.sha)).toBeNull();
  });
});

describe("readLocalStandardsFiles", () => {
  it("reads the working tree, including the gitignored-by-convention consult log, keyed by git's blob id", async () => {
    const files = await readLocalStandardsFiles(plain);
    expect(files.map).toBe('{"schema":"x"}');
    expect(files.mapSha).toBe(gitBlobSha('{"schema":"x"}'));
    expect(files.consults).toContain('"t":1');
    expect(files.hasContextMap).toBe(false);
  });

  it("matches git's own blob id", async () => {
    const r = await runGit(plain, ["rev-parse", "HEAD:.ai/registry-map.json"]);
    expect(gitBlobSha('{"schema":"x"}')).toBe(r.stdout.trim());
  });
});

describe("localRegistryDir", () => {
  it("is a read source only on a self-hosted deployment", () => {
    const prev = process.env.ASCENT_SELF_HOSTED;
    process.env.ASCENT_SELF_HOSTED = "0";
    expect(localRegistryDir({ localPath: registry })).toBeNull();
    process.env.ASCENT_SELF_HOSTED = "1";
    expect(localRegistryDir({ localPath: registry })).toBe(registry);
    expect(localRegistryDir({ localPath: null })).toBeNull();
    if (prev === undefined) delete process.env.ASCENT_SELF_HOSTED;
    else process.env.ASCENT_SELF_HOSTED = prev;
  });
});
