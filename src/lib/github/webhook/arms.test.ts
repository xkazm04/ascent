// @vitest-environment node
// Data-table guards over the webhook arm table (no source scanning): an arm that declares a tenant
// write must declare an owner bind, and the table's events must equal the events documented in
// docs/features/github/github-app.md. Each guard carries a seeded violation proving it still bites.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/github/app", () => ({}));
vi.mock("@/lib/db", () => ({}));
vi.mock("@/lib/db/scan-jobs", () => ({}));
vi.mock("@/lib/db/install-grants", () => ({}));
vi.mock("@/lib/db/control-observations", () => ({}));
vi.mock("@/lib/db/ai-changes", () => ({}));
vi.mock("@/lib/github/pr-gate", () => ({}));
vi.mock("@/lib/push-rescan", () => ({}));
vi.mock("@/lib/registry/registry-push", () => ({}));

import { WEBHOOK_ARMS, armTableViolations, type WebhookArm } from "./arms";

const DOC = readFileSync(join(process.cwd(), "docs/features/github/github-app.md"), "utf8");

/** Events named in backticks in the FIRST column of each row of the table whose header row starts
 *  with `headerPrefix`, before any parenthetical. Other cells backtick function names, so they are
 *  deliberately not read. */
function firstColumnEvents(md: string, headerPrefix: string): Set<string> {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(headerPrefix));
  if (start < 0) return new Set();
  const events = new Set<string>();
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    // The event names lead the cell; a parenthetical qualifier after them may backtick an action.
    const first = (line.split("|")[1] ?? "").split("(")[0]!;
    for (const m of first.matchAll(/`([a-z_]+)`/g)) events.add(m[1]!);
  }
  return events;
}

const tableEvents = (arms: readonly WebhookArm[]) => new Set(arms.map((a) => a.event));
const sorted = (s: Set<string>) => [...s].sort();

describe("webhook arm table guards", () => {
  it("every tenant-writing arm declares an owner or GitHub-confirmed bind", () => {
    expect(armTableViolations(WEBHOOK_ARMS)).toEqual([]);
  });

  it("bites: a seeded tenant-writing arm with bind 'none' is a violation", () => {
    const seeded: WebhookArm = { event: "x", needs: { app: false, db: false }, bind: "none", effects: ["tenant-write"], schedule: () => {} };
    expect(armTableViolations([...WEBHOOK_ARMS, seeded])).toEqual(["x: declares tenant-write with bind 'none'"]);
  });

  it("bites: a duplicated event is a violation", () => {
    const dup = WEBHOOK_ARMS[0]!;
    expect(armTableViolations([...WEBHOOK_ARMS, dup])).toContain(`${dup.event}: declared twice`);
  });

  it("the arm table's events equal the first-column events of the doc's event table", () => {
    const documented = firstColumnEvents(DOC, "| Event | Action |");
    expect(documented.size).toBeGreaterThan(0);
    expect(sorted(tableEvents(WEBHOOK_ARMS))).toEqual(sorted(documented));
  });

  it("the arm table's events equal the first-column events of the doc's bind table", () => {
    const documented = firstColumnEvents(DOC, "| Event | Bind |");
    expect(sorted(tableEvents(WEBHOOK_ARMS))).toEqual(sorted(documented));
  });

  it("bites: a seeded undocumented arm breaks the parity", () => {
    const documented = firstColumnEvents(DOC, "| Event | Action |");
    const seeded = new Set([...tableEvents(WEBHOOK_ARMS), "identity_sync"]);
    expect(sorted(seeded)).not.toEqual(sorted(documented));
  });

  it("reads only the first column: a backticked name in a later cell is not an event", () => {
    const md = "| Event | Action |\n| --- | --- |\n| `push` (moved) | runs `runPushRescan` |\n\nafter";
    expect(sorted(firstColumnEvents(md, "| Event | Action |"))).toEqual(["push"]);
  });
});
