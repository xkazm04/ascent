#!/usr/bin/env node
// `npx ascent work` — claim → brief → (your agent) → report, over Ascent's MCP door.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS IS FOR. Ascent's Follow-ups ledger is a pull queue, and this is the smallest honest
// client of it. It does NOT run an agent. It hands you a brief on stdout (or into a command you
// name) and posts back what you tell it happened — because the whole point of the protocol is that
// the agent is yours: Claude Code, Copilot, Codex, Cursor, a CI job, a person with a terminal. A
// remediation product that only works with its own agent is a product you have to switch to; this is
// one you point at whatever you already pay for.
//
// ZERO DEPENDENCIES, and it assumes nothing about the ascent repository — it is a client of a public
// HTTP endpoint and nothing else, so it can be copied into any repo, run from `npx`, or pasted into
// a CI step. Node 18+ for global `fetch`.
//
// DELIBERATELY A SEPARATE FILE from `scripts/ascent-skills.mjs`. Merging them into one `npx ascent`
// binary is a distributable-packaging job (W1-D owns it), and doing it here would couple a protocol
// client to a release decision that has not been made.
//
// EXIT CODES ARE ABOUT THE PROTOCOL, NOT ABOUT THE WORK. 0 = the calls this script made succeeded.
// A follow-up you skipped is a successful `skipped` report, not a failure — a CI step that went red
// because an agent honestly declined an item would teach everyone to stop reporting honestly.
//
//   ASCENT_TOKEN   an org API token holding mcp:read + followups:write + telemetry:write
//   ASCENT_URL     the Ascent base URL (default https://ascent.dev)
//
//   node scripts/ascent-work.mjs claim  --repo owner/name [--count 3] [--lease 45]
//   node scripts/ascent-work.mjs brief  --ids id1,id2
//   node scripts/ascent-work.mjs report --id id --verdict resolved|skipped|needs_human \
//                                       --reason "..." [--branch b] [--pr url]
//   node scripts/ascent-work.mjs run    --repo owner/name [--count 3] -- <your agent command>
// ─────────────────────────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";

const BASE = (process.env.ASCENT_URL || "https://ascent.dev").replace(/\/+$/, "");
const TOKEN = process.env.ASCENT_TOKEN || "";
const PROTOCOL = "2026-07-28";

function die(message) {
  process.stderr.write(`ascent work: ${message}\n`);
  process.exit(1);
}

/** argv → { _: [positionals], flag: value }. `--` ends the flags and collects the rest verbatim. */
function parseArgs(argv) {
  const out = { _: [], rest: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--") {
      out.rest = argv.slice(i + 1);
      break;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i += 1;
      }
    } else out._.push(a);
  }
  return out;
}

/**
 * One MCP `tools/call`. The routing headers mirror the body because this revision requires it, and a
 * tool error arrives as `isError` INSIDE a 200 rather than as an HTTP status — so both are checked.
 */
async function callTool(name, args) {
  if (!TOKEN) die("set ASCENT_TOKEN to an org API token holding mcp:read + followups:write.");
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
      "mcp-protocol-version": PROTOCOL,
      "mcp-method": "tools/call",
      "mcp-name": name,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401/403 here is almost always a scope the token does not hold, and the door answers an
    // out-of-scope tool with `Unknown tool` on purpose — so say what to check rather than echoing a
    // refusal that cannot, by design, be specific.
    const msg = body?.error?.message || `HTTP ${res.status}`;
    die(`${name}: ${msg}${res.status === 400 ? " (does this token hold followups:write and telemetry:write?)" : ""}`);
  }
  const result = body?.result;
  if (!result) die(`${name}: the door returned no result.`);
  if (result.isError) {
    // A TOOL error is the org refusing this specific request — a T0 repository, an expired lease, a
    // row somebody else holds. It is printed verbatim and exits non-zero, because the caller asked
    // for something it did not get.
    die(result.content?.[0]?.text || `${name} was refused.`);
  }
  return result;
}

const structured = (result) => result.structuredContent ?? {};
const text = (result) => result.content?.[0]?.text ?? "";

async function claim(args) {
  const repo = args.repo || die("--repo owner/name is required.");
  const res = await callTool("claim_followups", {
    repo,
    ...(args.ids ? { ids: String(args.ids).split(",").map((s) => s.trim()).filter(Boolean) } : {}),
    ...(args.count ? { count: Number(args.count) } : {}),
    ...(args.lease ? { leaseMinutes: Number(args.lease) } : {}),
  });
  const s = structured(res);
  for (const r of s.refused ?? []) process.stderr.write(`  refused ${r.id}: ${r.reason}\n`);
  return (s.claimed ?? []).map((c) => c.id);
}

async function brief(ids) {
  if (ids.length === 0) die("nothing to brief — claim some follow-ups first.");
  return text(await callTool("get_fix_brief", { ids }));
}

async function report(args) {
  const res = await callTool("report_attempt", {
    id: args.id || die("--id is required."),
    verdict: args.verdict || die("--verdict resolved|skipped|needs_human is required."),
    reason: args.reason || die("--reason is required: a verdict with no reason is not an account."),
    ...(args.branch ? { branch: String(args.branch) } : {}),
    ...(args.pr ? { prUrl: String(args.pr) } : {}),
  });
  return structured(res);
}

/** Run the caller's agent command with the brief on its stdin. Inherits stdout/stderr so a terminal
 *  agent stays interactive. Resolves with the exit code; never throws on a non-zero one. */
function runAgent(command, briefText) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "inherit", "inherit"], shell: false });
    child.on("error", (err) => {
      process.stderr.write(`ascent work: could not run "${command[0]}": ${err.message}\n`);
      resolve(127);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(briefText);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (cmd === "claim") {
    const ids = await claim(args);
    process.stdout.write(`${ids.join("\n")}\n`);
    return;
  }
  if (cmd === "brief") {
    const ids = String(args.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
    process.stdout.write(`${await brief(ids)}\n`);
    return;
  }
  if (cmd === "report") {
    const s = await report(args);
    process.stdout.write(`${s.adjudication ?? "recorded"}\n`);
    return;
  }
  if (cmd === "run") {
    if (args.rest.length === 0) die("`run` needs an agent command after `--`.");
    const ids = await claim(args);
    if (ids.length === 0) {
      // NOT AN ERROR. An empty queue is a real answer about this repository, and a CI step that went
      // red on it would page somebody because there was nothing to fix.
      process.stdout.write("Nothing to claim — this repository has no open follow-ups available.\n");
      return;
    }
    const code = await runAgent(args.rest, await brief(ids));
    // THE VERDICT IS NOT INFERRED FROM THE EXIT CODE, and this is the one design decision in this
    // file worth arguing about. An agent that exits 0 has told you its process ended, not that it
    // fixed anything — reporting `resolved` on that basis would put a claim in the org's ledger that
    // nobody made. So an unattended run reports `needs_human`, which is exactly true: the work
    // happened and a person has to say what it was. Report per id yourself for anything better.
    for (const id of ids) {
      await report({
        id,
        verdict: "needs_human",
        reason:
          code === 0
            ? "An unattended agent session ran against this item and exited cleanly; no per-item verdict was reported."
            : `An unattended agent session ran against this item and exited ${code}.`,
      });
    }
    process.stdout.write(`Reported ${ids.length} item(s). Ascent's next scan of the default branch adjudicates.\n`);
    return;
  }

  process.stdout.write(
    [
      "ascent work — claim, brief and report follow-ups over Ascent's MCP door.",
      "",
      "  claim  --repo owner/name [--ids a,b] [--count 3] [--lease 45]",
      "  brief  --ids a,b",
      "  report --id id --verdict resolved|skipped|needs_human --reason '...' [--branch b] [--pr url]",
      "  run    --repo owner/name [--count 3] -- <your agent command>",
      "",
      "  ASCENT_TOKEN   org API token with mcp:read + followups:write + telemetry:write",
      "  ASCENT_URL     Ascent base URL (default https://ascent.dev)",
      "",
      "Nothing here closes a follow-up. Ascent's next scan of the default branch decides.",
      "",
    ].join("\n"),
  );
}

main().catch((err) => die(err instanceof Error ? err.message : String(err)));
