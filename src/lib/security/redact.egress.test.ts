// The paired proof for the prompt-egress redactor: an agent's lane-report lessons, each carrying
// credential-shaped text, walked through the real parser and the real prompt builders that quote
// agent-written text. What is counted is how many of the planted secrets survive into the prompt
// string a model would receive. Arm A was run against the tree at 60159ae0, before the redactor existed.

import { describe, expect, it } from "vitest";
import { ATHENA_MEMORY_TOOL, createAthenaGrounding } from "@/lib/athena/grounding";
import { buildAthenaPrompt } from "@/lib/athena/prompt";
import { parseLaneReport } from "@/lib/local/lane-report";
import { buildLaneSummaryPrompt } from "@/lib/local/lane-summary";
import { buildConsolidationPrompt } from "@/lib/memory/consolidation";
import { buildReflectionPrompt } from "@/lib/memory/reflection";
import { buildLaneBrief } from "@/lib/org/lane-brief";

/** One secret per shape: the text planted, and the part that must not reach a model. */
const PLANTED: { shape: string; text: string; core: string }[] = [
  {
    shape: "private-key",
    text: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAfixtureKeyMaterial\n-----END RSA PRIVATE KEY-----",
    core: "MIIEowIBAAKCAQEAfixtureKeyMaterial",
  },
  { shape: "google", text: "AIzaSyD-1234567890abcdefghijklmnopqrstu", core: "AIzaSyD-1234567890abcdefghijklmnopqrstu" },
  { shape: "stripe", text: "sk_live_51H8xKfLkd0293ndkAOSJ", core: "sk_live_51H8xKfLkd0293ndkAOSJ" },
  { shape: "sk-key", text: "sk-ant-api03-FixtureKey1234567890abcd", core: "sk-ant-api03-FixtureKey1234567890abcd" },
  { shape: "github", text: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", core: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345" },
  { shape: "gitlab", text: "glpat-abcdefghijklmnopqrst", core: "glpat-abcdefghijklmnopqrst" },
  { shape: "npm", text: "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", core: "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789" },
  { shape: "aws-key-id", text: "AKIAIOSFODNN7EXAMPLE", core: "AKIAIOSFODNN7EXAMPLE" },
  {
    shape: "aws-secret",
    text: "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    core: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  },
  { shape: "slack", text: "xoxb-1234567890-abcdefghij", core: "xoxb-1234567890-abcdefghij" },
  { shape: "slack-app", text: "xapp-1-A0123456789-abcdef", core: "xapp-1-A0123456789-abcdef" },
  {
    shape: "jwt",
    text: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    core: "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  },
  { shape: "connection-string", text: "postgres://admin:s3cr3tP4ss@db.example.com:5432/app", core: "s3cr3tP4ss" },
  { shape: "auth-header", text: "Authorization: Bearer abcdef0123456789abcdef", core: "abcdef0123456789abcdef" },
  { shape: "quoted-assignment", text: '"password": "two words here"', core: "two words here" },
  { shape: "key-value-assignment", text: "api_key=super-secret-value-123", core: "super-secret-value-123" },
];

// Split across lessons so no lesson hits the parser's per-lesson cap and silently drops a secret,
// which would make arm A undercount for a reason that has nothing to do with redaction.
const LESSONS = [PLANTED.slice(0, 6), PLANTED.slice(6, 11), PLANTED.slice(11)].map(
  (group, i) => `Lesson ${i + 1}: while debugging the deploy I used ${group.map((p) => p.text).join(" then ")} and it worked.`,
);

const survivors = (prompt: string): string[] => PLANTED.filter((p) => prompt.includes(p.core)).map((p) => p.shape);

type Row = { id: string; kind: string; content: string; confidence: number };

/** Every prompt builder that quotes agent-written text, fed the same rows. */
async function promptsFor(rows: Row[]): Promise<Record<string, string>> {
  const grounding = await createAthenaGrounding("acme", {
    canReadOrg: async () => true,
    memoryAllowed: async () => true,
    runTool: async () => ({ structuredContent: { memories: rows } }),
  });
  return {
    "lane-brief": buildLaneBrief({
      org: "acme",
      repo: "acme/widget",
      dimIds: ["D6"],
      playbooks: [],
      housePattern: [],
      memories: rows.map((r) => ({ ...r, source: "loop-lesson" })),
      skills: [],
      evidence: [],
    }).text,
    athena: buildAthenaPrompt({
      constitution: null,
      selfModel: null,
      recall: rows,
      grounding: "prefetched",
      history: [],
      message: "what did the last lane learn?",
      orgSlug: "acme",
    }),
    "athena-tool": await grounding!.execute({ id: "c1", name: ATHENA_MEMORY_TOOL, args: {} }),
    consolidation: rows
      .map((r) =>
        buildConsolidationPrompt(
          { content: r.content, kind: r.kind, namespace: "acme/widget", candidates: rows },
          rows.map((c) => ({ id: c.id, similarity: 0.5, relation: "unrelated" as const, reason: "fixture" })),
        ),
      )
      .join("\n"),
    reflection: buildReflectionPrompt([{ memberIds: rows.map((r) => r.id), cohesion: 0.5 }], rows),
    "lane-summary": buildLaneSummaryPrompt(
      rows.map((r) => ({ headline: r.content, dimId: null, kind: "noted" as const, covers: [r.id], evidence: r.content })),
    ),
  };
}

function report(label: string, prompts: Record<string, string>): Record<string, string[]> {
  const counts = Object.fromEntries(Object.entries(prompts).map(([k, v]) => [k, survivors(v)]));
  const total = Object.values(counts).reduce((n, v) => n + v.length, 0);
  const line = Object.entries(counts)
    .map(([k, v]) => `${k}=${v.length}/${PLANTED.length}`)
    .join(" ");
  process.stderr.write(`[REDACT] ${label}: ${total} secrets reaching prompt strings (${line})\n`);
  for (const [k, v] of Object.entries(counts)) {
    if (v.length) process.stderr.write(`[REDACT]   ${k} survivors: ${v.join(", ")}\n`);
  }
  return counts;
}

const NONE = { "lane-brief": [], athena: [], "athena-tool": [], consolidation: [], reflection: [], "lane-summary": [] };

describe("[REDACT] agent-written text at the prompt egress", () => {
  it("a lane lesson carrying every shape reaches no prompt with a secret in it", async () => {
    for (const l of LESSONS) expect(l.length).toBeLessThanOrEqual(600);
    const parsed = parseLaneReport(JSON.stringify({ v: 1, items: [], lessons: LESSONS }), []);
    expect(parsed.lessons).toHaveLength(LESSONS.length);
    // Redacted where a lesson becomes a candidate row, before any prompt: the reviewer never sees it.
    expect(survivors(parsed.lessons.join("\n"))).toEqual([]);
    const rows = parsed.lessons.map((content, i) => ({ id: `m${i + 1}`, kind: "procedural", content, confidence: 0.6 }));
    expect(report("via lane-report", await promptsFor(rows))).toEqual(NONE);
  });

  it("the egress holds on its own for agent text that never passed the lane-report parser", async () => {
    // Memory written through the MCP door or by a member: no parse-time redaction ran, so only the
    // prompt egress stands between the stored text and the model.
    const rows = LESSONS.map((content, i) => ({ id: `d${i + 1}`, kind: "procedural", content, confidence: 0.6 }));
    const raw = rows.map((r) => r.content).join("\n");
    expect(survivors(raw)).toHaveLength(PLANTED.length); // the instrument sees every planted secret
    expect(report("stored directly", await promptsFor(rows))).toEqual(NONE);
  });
});
