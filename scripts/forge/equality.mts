// THE EQUALITY PROOF — the release gate for lane W4-P (moonshot #4).
//
// The claim this lane has to earn before a second forge is allowed anywhere near the pipeline: routing
// GitHub through the `Forge` registry changed NOTHING about a GitHub scan. Not the snapshot, not the
// score input, not a single byte.
//
// Two modes, and the honest difference between them matters:
//
//   npx vite-node --config vitest.config.js scripts/forge/equality.mts
//       OFFLINE, deterministic, runs anywhere. A recorded GitHub — a `fetch` stub serving fixed
//       responses for the metadata / tree / commits / raw / enrichment endpoints — is scanned TWICE:
//       once through the routed path (`resolveForge(...)` builds the source and the enrichments), and
//       once through the pre-#4 construction (`opts.source = new GitHubPublicSource()`). Both captures
//       go through the SAME `ASCENT_MATRIX_CAPTURE_DIR` hook the model-matrix bench uses, and the two
//       `{scoreInput, snapshot}` JSON documents are compared byte for byte. Any difference is the
//       routing perturbing the GitHub path, which is the failure this whole lane is arranged to
//       prevent.
//
//   npx vite-node --config vitest.config.js scripts/forge/equality.mts --baseline bench/matrix-inputs
//       LIVE. Diffs a fresh capture against fixtures captured from `master` BEFORE the extraction
//       (`ASCENT_MATRIX_CAPTURE_DIR=bench/matrix-inputs npx vite-node … scripts/matrix/capture.mts`,
//       `mock: true`, GITHUB_TOKEN only — no LLM key). This is the mode that covers the 10-repo bench
//       corpus and the `reference-data/` cohort against REAL repositories, and it needs network +
//       a token. Run it before merging a change to `src/lib/forge/**` or `src/lib/github/source.ts`.
//
// What the offline mode does and does not prove, stated plainly so nobody over-reads it: it proves the
// ROUTING is transparent over a fixed upstream, across the full ingest → signals → scoreInput
// pipeline. It does not re-verify GitHub's own readers against live GitHub — that is what the live
// mode and the 9,700-test suite do.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanRepository } from "@/lib/scan";
import { GitHubPublicSource } from "@/lib/github/source";

// A frozen instant. The capture records `at`, and two runs a millisecond apart would differ on a field
// that has nothing to do with forge routing — so the clock is pinned rather than diffed around.
const FIXED_NOW = "2026-08-30T00:00:00.000Z";
const REPO = "ascent-fixture/equality";

// ── The recorded GitHub ──────────────────────────────────────────────────────────────────────────
// Deliberately shaped like a small but real repo: manifests, source, tests, workflows, a CODEOWNERS,
// agent guidance, and an `.ai/memory` entry — the last one because the QUARANTINE (W1-B, carried by
// ruling W4-#6) is part of what has to stay byte-identical through the routed path.

const TREE = [
  "README.md",
  "package.json",
  "AGENTS.md",
  "CODEOWNERS",
  "SECURITY.md",
  "src/index.ts",
  "src/index.test.ts",
  ".github/workflows/ci.yml",
  ".ai/memory/0001-first-decision.md",
];

const CONTENT: Record<string, string> = {
  "README.md": "# equality fixture\n\nA fixed repository used to prove forge routing is transparent.\n",
  "package.json": JSON.stringify({ name: "equality", version: "1.0.0", scripts: { test: "vitest" } }, null, 2),
  "AGENTS.md": "# Agent guidance\n\nRun the tests before committing.\n",
  CODEOWNERS: "* @ascent-fixture/core\n",
  "SECURITY.md": "Report vulnerabilities to security@example.com.\n",
  "src/index.ts": "export const answer = 42;\n",
  "src/index.test.ts": "import { answer } from './index';\n",
  ".github/workflows/ci.yml": "name: ci\non: [push]\npermissions:\n  contents: read\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n",
  ".ai/memory/0001-first-decision.md": "We decided to pin the clock in the equality harness.\n",
};

const HEAD_SHA = "1111111111111111111111111111111111111111";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** The stub. Anything not explicitly recorded answers 404, which every reader in the pipeline already
 *  degrades on — so an unrecorded endpoint shows up as a missing signal, never as a hang. */
function recordedFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

  if (url.includes("raw.githubusercontent.com")) {
    const path = decodeURIComponent(url.split(`/${HEAD_SHA}/`)[1] ?? url.split("/").slice(6).join("/"));
    const body = CONTENT[path];
    return Promise.resolve(body ? new Response(body, { status: 200 }) : new Response("", { status: 404 }));
  }
  if (/\/repos\/[^/]+\/[^/]+\/git\/trees\//.test(url)) {
    return Promise.resolve(
      json({ sha: HEAD_SHA, truncated: false, tree: TREE.map((path) => ({ path, type: "blob", size: CONTENT[path]?.length ?? 0 })) }),
    );
  }
  if (/\/repos\/[^/]+\/[^/]+\/commits\b/.test(url) || url.endsWith("/commits/HEAD")) {
    return Promise.resolve(
      json([
        {
          sha: HEAD_SHA,
          commit: {
            message: "feat: pin the clock",
            author: { name: "Dana", date: "2026-08-29T12:00:00Z" },
            committer: { date: "2026-08-29T12:00:00Z" },
          },
        },
      ]),
    );
  }
  if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
    return Promise.resolve(
      json({
        name: "equality",
        owner: { login: "ascent-fixture" },
        html_url: `https://github.com/${REPO}`,
        description: "fixture",
        stargazers_count: 12,
        forks_count: 3,
        open_issues_count: 1,
        language: "TypeScript",
        pushed_at: "2026-08-29T12:00:00Z",
        default_branch: "main",
        size: 40,
        private: false,
        topics: [],
      }),
    );
  }
  // Every enrichment endpoint (GraphQL PRs, branch protection, deployments, check suites, actions
  // health, security posture, OSV) answers 404 → each reader degrades to its documented null. That is
  // the SAME degrade on both runs, so it does not weaken the comparison; it keeps the harness offline.
  return Promise.resolve(new Response("", { status: 404 }));
}

interface Fixture {
  repo: string;
  at: string;
  scoreInput: unknown;
  snapshot: unknown;
}

/** Strip the wall-clock field: two runs a millisecond apart would differ on a value that has nothing
 *  to do with forge routing. Everything else is compared. */
function withoutClock(fx: Fixture): Omit<Fixture, "at"> {
  return { repo: fx.repo, scoreInput: fx.scoreInput, snapshot: fx.snapshot };
}

/** Read the single fixture a capture directory holds. */
function readCapture(dir: string): Omit<Fixture, "at"> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length !== 1) throw new Error(`expected exactly 1 fixture in ${dir}, found ${files.length}`);
  return withoutClock(JSON.parse(readFileSync(join(dir, files[0]!), "utf8")) as Fixture);
}

async function captureOnce(dir: string, injectLegacySource: boolean): Promise<void> {
  process.env.ASCENT_MATRIX_CAPTURE_DIR = dir;
  await scanRepository(REPO, {
    mock: true,
    token: "fixture-token",
    now: FIXED_NOW,
    ...(injectLegacySource ? { source: new GitHubPublicSource() } : {}),
  });
}

/** Byte-compare two JSON documents after a STABLE key ordering, so key-insertion order — which no
 *  consumer depends on and which a refactor can reorder harmlessly — is not reported as a diff. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

async function offlineProof(): Promise<boolean> {
  const original = globalThis.fetch;
  globalThis.fetch = recordedFetch as typeof fetch;
  const routedDir = mkdtempSync(join(tmpdir(), "ascent-forge-routed-"));
  const legacyDir = mkdtempSync(join(tmpdir(), "ascent-forge-legacy-"));
  try {
    await captureOnce(routedDir, false);
    await captureOnce(legacyDir, true);
    const routed = stable(readCapture(routedDir));
    const legacy = stable(readCapture(legacyDir));
    if (routed === legacy) {
      console.log(`  ✓ routed === pre-#4 construction  (${routed.length} bytes compared)`);
      return true;
    }
    console.error("  ✗ DIFF — the routing perturbed the GitHub path.");
    for (let i = 0; i < Math.max(routed.length, legacy.length); i++) {
      if (routed[i] !== legacy[i]) {
        console.error(`    first difference at byte ${i}:`);
        console.error(`      routed: …${routed.slice(Math.max(0, i - 60), i + 60)}…`);
        console.error(`      legacy: …${legacy.slice(Math.max(0, i - 60), i + 60)}…`);
        break;
      }
    }
    return false;
  } finally {
    globalThis.fetch = original;
    delete process.env.ASCENT_MATRIX_CAPTURE_DIR;
    rmSync(routedDir, { recursive: true, force: true });
    rmSync(legacyDir, { recursive: true, force: true });
  }
}

/** Diff a fresh capture of each baseline repo against the fixture captured from `master`. */
async function baselineProof(baselineDir: string): Promise<boolean> {
  const dir = resolve(process.cwd(), baselineDir);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.error(`  ✗ ${baselineDir} holds no fixtures. Capture them from master FIRST:`);
    console.error("      git switch master");
    console.error(`      ASCENT_MATRIX_CAPTURE_DIR=${baselineDir} npx vite-node --config vitest.config.js scripts/matrix/capture.mts`);
    return false;
  }
  const token = process.env.GITHUB_TOKEN;
  let ok = true;
  for (const file of files) {
    const baseline = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
    const out = mkdtempSync(join(tmpdir(), "ascent-forge-live-"));
    try {
      process.env.ASCENT_MATRIX_CAPTURE_DIR = out;
      await scanRepository(`https://github.com/${baseline.repo}`, {
        mock: true,
        token,
        noAmbientToken: !token,
        now: baseline.at,
      });
      const fresh = withoutClock(
        JSON.parse(readFileSync(join(out, readdirSync(out)[0]!), "utf8")) as Fixture,
      );
      const same = stable(fresh) === stable(withoutClock(baseline));
      console.log(`  ${same ? "✓" : "✗"} ${baseline.repo}`);
      ok &&= same;
    } catch (e) {
      console.log(`  ✗ ${baseline.repo} — ${e instanceof Error ? e.message.slice(0, 90) : String(e)}`);
      ok = false;
    } finally {
      delete process.env.ASCENT_MATRIX_CAPTURE_DIR;
      rmSync(out, { recursive: true, force: true });
    }
  }
  return ok;
}

async function main(): Promise<void> {
  const idx = process.argv.indexOf("--baseline");
  const baseline = idx >= 0 ? process.argv[idx + 1] : undefined;
  console.log(`\nForge equality proof — ${baseline ? `live, against ${baseline}` : "offline, recorded GitHub"}\n`);
  const ok = baseline ? await baselineProof(baseline) : await offlineProof();
  console.log(ok ? "\nEMPTY DIFF. The GitHub path is unchanged.\n" : "\nNON-EMPTY DIFF — this blocks the lane.\n");
  process.exit(ok ? 0 : 1);
}

void main();
