// Capture replay fixtures for the model-comparison matrix. Runs a level-balanced subset of the labeled
// bench repos through the REAL scan pipeline once (forcing the mock provider, so NO LLM key is needed —
// only GITHUB_TOKEN), which fires the ASCENT_MATRIX_CAPTURE_DIR hook to dump each repo's
// {scoreInput, snapshot}. The matrix run (run.mts) then replays assess() across models on these.
//
//   ASCENT_MATRIX_CAPTURE_DIR=bench/matrix-inputs npx vite-node --config vitest.config.js scripts/matrix/capture.mts
//
// Loads GITHUB_TOKEN from .env.local automatically. Idempotent — re-run to refresh a repo's fixture.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanRepository } from "@/lib/scan";

// A level-balanced spread of the labeled corpus (bench/repos.json) — both L1/L2, four L3, two L4 — so
// the calibration axis (predicted level vs ground truth) is exercised across the maturity range.
const SELECTION = [
  "jwasham/coding-interview-university", // L1
  "sindresorhus/awesome", // L1
  "sindresorhus/slugify", // L2
  "anthropics/claude-code", // L2
  "expressjs/express", // L3
  "facebook/react", // L3
  "astral-sh/ruff", // L3
  "denoland/deno", // L3
  "vercel/next.js", // L4
  "withastro/astro", // L4
];

function loadEnvLocal(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      const key = m?.[1];
      const val = m?.[2];
      if (key && val !== undefined && !process.env[key]) process.env[key] = val.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local — rely on the ambient env */
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.ASCENT_MATRIX_CAPTURE_DIR) {
    console.error("Set ASCENT_MATRIX_CAPTURE_DIR (e.g. bench/matrix-inputs) so the capture hook writes fixtures.");
    process.exit(1);
  }
  const token = process.env.GITHUB_TOKEN;
  console.log(`\nCapturing ${SELECTION.length} fixtures → ${process.env.ASCENT_MATRIX_CAPTURE_DIR}\n`);
  let ok = 0;
  for (const repo of SELECTION) {
    const started = Date.now();
    try {
      // forceMock: the full fetch/signal/scoreInput pipeline runs, but assess() uses the keyless mock —
      // so a fixture is captured without an LLM key. The mock's assessment is discarded.
      await scanRepository(`https://github.com/${repo}`, { mock: true, token, noAmbientToken: !token });
      ok++;
      console.log(`  ✓ ${repo.padEnd(40)} ${Date.now() - started}ms`);
    } catch (e) {
      console.log(`  ✗ ${repo.padEnd(40)} ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    }
  }
  console.log(`\nCaptured ${ok}/${SELECTION.length} fixtures.\n`);
}

void main();
