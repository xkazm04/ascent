// Step 0's TWO lanes, asserted on the EMITTED MARKDOWN rather than on the shape of the generators.
//
// Why that choice is load-bearing here: this module emits text that runs inside a CUSTOMER'S repo and
// a CUSTOMER'S PR. No gate in this repo ever reads the artefact, so a test that checks "renderStep0
// was called with mode=reference" stays green while the rendered file says something else entirely.
// Every case below reads the string an adopter would actually receive - the file list, the fenced
// bodies, the provenance stamps, the byte sizes.
//
// The defect these cases close: `buildFoundation` committed the real `.ai/` tree AND a SKILL.md
// holding a verbatim second copy of every one of those files (~65KB of fenced bodies: the doctor
// alone is ~30KB). Two authorities for one fact, in one PR, with nothing marking which was the copy.
// Reference mode replaces the copy with a derived pointer list; embed mode (the plain markdown
// download, where the adopter has no files to point AT) keeps every body and gains the provenance
// stamp the guidance projections already use, so a transcribed copy stays comparable to its source.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DimensionId, ScanReport } from "@/lib/types";
import type { GeneratedFile } from "@/lib/standard/types";
import { DIMENSIONS, levelForScore } from "@/lib/maturity/model";
import { sha12 } from "@/lib/analyze/guidance-projection";

vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn() }));

import { renderStep0, STEP0_HEADING } from "./step0";
import { buildOnboardingSkill, buildOnboardingSkillFile, ONBOARDING_SKILL_PATH } from "./skill";
import { buildFoundation, buildStandardFiles, buildDoctor } from "@/lib/standard";
import { openFoundationPr } from "@/lib/standard/pr";
import { openDraftPr } from "@/lib/github/write";
import { AppApiError } from "@/lib/github/app";

const mockPr = vi.mocked(openDraftPr);

function makeReport(scores: Partial<Record<DimensionId, number>> = {}, overall = 58): ScanReport {
  const dimensions = DIMENSIONS.map((d) => ({
    id: d.id,
    name: d.name,
    weight: d.weight,
    score: scores[d.id] ?? 80,
    signalScore: scores[d.id] ?? 80,
    llmScore: scores[d.id] ?? 80,
    summary: `${d.name} summary`,
    evidence: [`${d.id} observed evidence`],
    strengths: [`${d.id} strength`],
    gaps: [`${d.id} gap one`],
  }));
  return {
    repo: {
      owner: "acme",
      name: "api",
      url: "https://github.com/acme/api",
      description: "Billing API",
      stars: 12,
      forks: 1,
      primaryLanguage: "TypeScript",
      defaultBranch: "main",
    },
    overallScore: overall,
    level: levelForScore(overall),
    archetype: "team",
    adoptionScore: 55,
    rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "Adopting AI with the rigor to ship it." },
    aiUsage: { detected: true, commitFraction: 0.3, signals: ["Co-Authored-By: Claude"] },
    contributors: [],
    dimensions,
    headline: "acme/api is at L3",
    strengths: ["Solid test suite"],
    risks: ["No secret scanning"],
    roadmap: [],
    discrepancies: [],
    confidence: 0.8,
    scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

const REPO = { owner: "acme", name: "api" };

/** Every path a reference-mode Step 0 names, with the purpose cell beside it. */
function listedRows(text: string): Array<{ path: string; sha: string; purpose: string }> {
  return [...text.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{12})` \| (.*) \|$/gm)].map((m) => ({
    path: m[1]!,
    sha: m[2]!,
    purpose: m[3]!,
  }));
}

// ── 1. The PR lane stops carrying a second copy of the tree it commits ────────────────────────────
describe("the foundation PR's SKILL.md no longer embeds the files the same PR commits", () => {
  it("carries no fenced copy of the doctor, maintain or SPEC bodies, and is a fraction of the embed size", () => {
    const report = makeReport({ D4: 40 });
    const foundation = buildFoundation(report);
    const skillFile = foundation.at(-1)!;
    expect(skillFile.path).toBe(ONBOARDING_SKILL_PATH);

    const standard = buildStandardFiles(report);
    const doctor = standard.find((f) => f.path === ".ai/doctor.mjs")!;
    const maintain = standard.find((f) => f.path === ".ai/maintain.mjs")!;
    const spec = standard.find((f) => f.path === ".ai/SPEC.md")!;

    // The opening of each body is unique to it - its presence means the whole body was fenced in.
    expect(skillFile.body).not.toContain(buildDoctor().body.slice(0, 200));
    expect(skillFile.body).not.toContain(doctor.body.slice(0, 200));
    expect(skillFile.body).not.toContain(maintain.body.slice(0, 200));
    expect(skillFile.body).not.toContain(spec.body.slice(0, 200));

    // The measurable claim: the PR-lane skill is under 30% of the embed-lane skill.
    const embedLength = buildOnboardingSkill(report).body.length;
    expect(skillFile.body.length).toBeLessThan(embedLength * 0.3);
    // The bytes the three largest bodies alone used to add, pinned so the win cannot silently erode.
    expect(doctor.body.length + maintain.body.length + spec.body.length).toBeGreaterThan(60_000);
  });
});

// ── 2. The reference list is DERIVED, never hand-maintained ───────────────────────────────────────
describe("reference mode derives its file list from the generated tree", () => {
  it("lists exactly buildStandardFiles(report) paths, in order, each with its own purpose", () => {
    const report = makeReport();
    const files = buildStandardFiles(report);
    const rows = listedRows(renderStep0(files, "reference", REPO));

    expect(rows.map((r) => r.path)).toEqual(files.map((f) => f.path));
    for (const [i, f] of files.entries()) {
      expect(rows[i]!.purpose).toBe(f.purpose!.replace(/\|/g, "\\|").replace(/\r?\n/g, " "));
      expect(rows[i]!.sha).toBe(sha12(f.body));
    }
  });

  it("picks up a FURTHER generated file with no edit to the renderer", () => {
    const report = makeReport();
    const extra: GeneratedFile = {
      path: ".ai/evals/README.md",
      body: "# evals\n",
      purpose: "A newly generated artifact nothing hand-lists.",
      lang: "markdown",
    };
    const files = [...buildStandardFiles(report), extra];
    const rows = listedRows(renderStep0(files, "reference", REPO));
    expect(rows.map((r) => r.path)).toEqual(files.map((f) => f.path));
    expect(rows.at(-1)).toEqual({
      path: ".ai/evals/README.md",
      sha: sha12(extra.body),
      purpose: extra.purpose,
    });
  });

  it("names the files as already present in the PR rather than asking the agent to write them", () => {
    const text = renderStep0(buildStandardFiles(makeReport()), "reference", REPO);
    expect(text).toContain(STEP0_HEADING);
    expect(text).toContain("already in this pull request");
    expect(text).toContain("node .ai/doctor.mjs"); // the baseline run survives the slimming
  });
});

// ── 3. Embed mode still ships a transcribable tree ────────────────────────────────────────────────
describe("embed mode keeps every body verbatim (the markdown download has no files to point at)", () => {
  it("contains each generated body unchanged", () => {
    const report = makeReport();
    const body = buildOnboardingSkill(report).body;
    for (const f of buildStandardFiles(report)) {
      expect(body.includes(f.body), `embed mode dropped the body of ${f.path}`).toBe(true);
    }
  });

  it("still fences a hostile four-backtick body so nothing leaks out of the block", () => {
    const FENCE4 = "`".repeat(4);
    const LEAK = "LEAKED_OUTSIDE_THE_FENCE_MARKER";
    const hostile: GeneratedFile = {
      path: ".ai/evil.mjs",
      lang: "javascript",
      purpose: "adversarial body with an inner code fence",
      body: `const a = 1;\n${FENCE4}\n${LEAK}\nmore body after the inner fence`,
    };
    const text = renderStep0([hostile], "embed", REPO);
    const open = text.match(/\n(`{5,})javascript\n/);
    expect(open, "embed did not open a >=5-backtick fence around a 4-backtick body").toBeTruthy();
    const fence = open![1]!;
    const openIdx = text.indexOf(fence + "javascript\n");
    const afterOpen = openIdx + (fence + "javascript\n").length;
    const closeIdx = text.indexOf(fence, afterOpen);
    const fenced = text.slice(afterOpen, closeIdx);
    expect(fenced).toContain(LEAK);
    expect(fenced).toContain(FENCE4);
    expect(text.split(fence).length - 1).toBe(2);
  });
});

// ── 4. Provenance: the copy is marked, with the shape the projections already use ──────────────────
describe("embed mode stamps every block with the projection provenance header", () => {
  it("stamps each block with generated-from: <path> sha256:<12 of the body>", () => {
    const report = makeReport();
    const text = renderStep0(buildStandardFiles(report), "embed", REPO);
    for (const f of buildStandardFiles(report)) {
      expect(text).toContain(`generated-from: ${f.path} sha256:${sha12(f.body)}`);
      // The pair shape the doctor's parser reads: source hash and body hash, both of this copy.
      expect(text).toContain(
        `generated-from: ${f.path} sha256:${sha12(f.body)} · body: sha256:${sha12(f.body)}`,
      );
    }
  });

  it("moves the stamped hash when the generated body moves", () => {
    const one: GeneratedFile = { path: ".ai/x.md", body: "alpha\n", purpose: "p", lang: "markdown" };
    const two: GeneratedFile = { ...one, body: "beta\n" };
    expect(renderStep0([one], "embed", REPO)).toContain(`sha256:${sha12("alpha\n")}`);
    expect(renderStep0([two], "embed", REPO)).toContain(`sha256:${sha12("beta\n")}`);
    expect(renderStep0([one], "embed", REPO)).not.toContain(`sha256:${sha12("beta\n")}`);
  });

  it("keeps the stamp OUTSIDE the fence so the fenced body is still byte-exact", () => {
    const f: GeneratedFile = { path: ".ai/x.md", body: "alpha\n", purpose: "p", lang: "markdown" };
    const text = renderStep0([f], "embed", REPO);
    const fenceIdx = text.indexOf("````markdown\n");
    const close = text.indexOf("````", fenceIdx + 5);
    expect(text.slice(fenceIdx + "````markdown\n".length, close)).toBe(f.body);
  });
});

// ── 5. The recovery path names a host only when the deployment has one ────────────────────────────
// Same rule as the footer: a self-hostable AGPL build must never send an adopter to a deployment
// where they have no account. Reference mode NEEDS a recovery path (a skipped file leaves a pointer
// to a file the repo does not have), which is exactly why the unset case must stay host-free.
describe("reference mode's recovery download follows the deployment origin", () => {
  const KEYS = ["ASCENT_PUBLIC_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("names <origin>/api/report/skill?repo=owner/name when an origin is configured", () => {
    process.env.ASCENT_PUBLIC_URL = "https://maturity.acme.internal";
    const text = renderStep0(buildStandardFiles(makeReport()), "reference", REPO);
    expect(text).toContain("https://maturity.acme.internal/api/report/skill?repo=acme/api");
  });

  it("names NO host at all when no origin is configured", () => {
    const text = renderStep0(buildStandardFiles(makeReport()), "reference", REPO);
    expect(text).not.toContain("/api/report/skill");
    expect(text).not.toContain("ascent.dev");
    expect(text).not.toMatch(/https?:\/\//);
    // It still tells the reader what to do about a skipped file - just without a host.
    expect(text).toContain("re-export the onboarding skill");
  });
});

// ── 6. The PR install contract is unchanged ───────────────────────────────────────────────────────
describe("openFoundationPr over the slimmed foundation keeps its collision policy", () => {
  beforeEach(() => {
    mockPr.mockReset();
    mockPr.mockImplementation(async () => ({ url: "https://github.com/acme/api/pull/1", number: 1, branch: "b" }) as never);
  });

  const run = (files: GeneratedFile[]) =>
    openFoundationPr({ token: "t", owner: "acme", repo: "api", files, prTitle: "t", prBody: "b" });

  it("commits .ai/manifest.yaml first and the SKILL.md last, in buildFoundation order", async () => {
    const files = buildFoundation(makeReport());
    const res = await run(files);
    expect(res.committed).toEqual(files.map((f) => f.path));
    expect(res.committed[0]).toBe(".ai/manifest.yaml");
    expect(res.committed.at(-1)).toBe(ONBOARDING_SKILL_PATH);
    expect(res.skipped).toEqual([]);
  });

  it("propagates a spine 409 and skips a skill-file 409", async () => {
    const files = buildFoundation(makeReport());
    mockPr.mockImplementation((async (input: { path: string }) => {
      if (input.path === ".ai/manifest.yaml") throw new AppApiError(409, "/x", "already there");
      return { url: "u", number: 1, branch: "b" };
    }) as never);
    await expect(run(files)).rejects.toThrow(/already there/);

    mockPr.mockImplementation((async (input: { path: string }) => {
      if (input.path === ONBOARDING_SKILL_PATH) throw new AppApiError(409, "/x", "already there");
      return { url: "u", number: 1, branch: "b" };
    }) as never);
    const res = await run(files);
    expect(res.skipped).toEqual([ONBOARDING_SKILL_PATH]);
    expect(res.committed).not.toContain(ONBOARDING_SKILL_PATH);
  });
});

// ── 7. The download lane is untouched ─────────────────────────────────────────────────────────────
// `GET /api/report/skill` serves `buildOnboardingSkill(report, selection).body` with no mode, so the
// adopter WITHOUT the GitHub App keeps the transcribable tree. Asserted on the emitted text of the
// exact value the route returns, and on both skill homes the `format=json` branch serializes.
describe("the markdown download keeps embed mode", () => {
  it("serves the embed-mode body, with every generated file still inline in both homes", () => {
    const report = makeReport({ D4: 40 });
    const skill = buildOnboardingSkill(report, {});
    const standard = buildStandardFiles(report);
    for (const f of standard) expect(skill.body).toContain(f.body);
    // format=json serializes skill.files - the Claude home and the vendor-neutral copy, both embedded.
    expect(skill.files).toHaveLength(2);
    for (const home of skill.files) for (const f of standard) expect(home.body).toContain(f.body);
    // And the slimming is strictly opt-in: the download body is NOT the PR body.
    expect(buildOnboardingSkillFile(report, undefined, "reference").body).not.toBe(skill.body);
  });
});
