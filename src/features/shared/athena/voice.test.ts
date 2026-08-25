// Her voice, and the two pure readers the display layer leans on.
//
// The load-bearing assertion is the negative one: `restingLine(null)` must NOT claim setup is done.
// `next === null` has three indistinguishable causes here (the checklist has not loaded, everything
// available IS done, or this workspace derives no steps at all), and a companion whose first line
// says "setup is complete" while the payload is still in flight has lied before anyone spoke to her.
//
// The IDENTITY_DIFF pin is here rather than in the component because this file runs under node and
// CAN import `@/lib/db/athena-proposals` — the component cannot, since that module pulls Prisma in at
// module scope and a value import of it from a client component fails `next build` while tsc and the
// unit tests both stay green.

import { describe, it, expect } from "vitest";
import { IDENTITY_DIFF_KIND } from "@/lib/db/athena-proposals";
import { restingLine } from "./restingLine";
import { proposalSummary, proposalTitle } from "./AthenaProposalCard";
import { stripFences } from "./AthenaProse";

describe("restingLine — the checklist's voice, not a second opinion", () => {
  it("names the step the checklist promoted, verbatim", () => {
    const line = restingLine({ title: "Run your first scan", href: "/org/acme?tab=overview", cta: "Open the fleet" });
    expect(line).toContain("Run your first scan");
    expect(line).toContain("Ask me");
  });

  it("claims nothing about setup when there is no promoted step", () => {
    const line = restingLine(null);
    expect(line).not.toMatch(/done|complete|finished|all set/i);
    expect(line).toContain("Ask me");
  });

  it("stays one or two sentences, with no heading and no sign-off", () => {
    for (const line of [restingLine(null), restingLine({ title: "Bring the team in", href: "/x", cta: "Open members" })]) {
      expect(line).not.toContain("#");
      expect(line).not.toMatch(/\n/);
      expect(line.split(/[.!?](\s|$)/).filter((s) => s.trim()).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("proposalTitle / proposalSummary", () => {
  it("pins the identity-diff literal to the constant the database actually stores", () => {
    expect(IDENTITY_DIFF_KIND).toBe("identity_diff");
    expect(proposalTitle(IDENTITY_DIFF_KIND)).toMatch(/believes about this org/);
  });

  it("makes an action id readable rather than printing it raw", () => {
    expect(proposalTitle("claim_followups")).toBe("Claim followups");
  });

  it("finds the ask in whichever field the kind's payload used", () => {
    expect(proposalSummary({ summary: "Watch three more repos." })).toBe("Watch three more repos.");
    expect(proposalSummary({ reason: "The stance is stale." })).toBe("The stance is stale.");
    expect(proposalSummary({ ops: [{ op: "append" }, { op: "remove" }] })).toBe("2 edits to her self-model.");
    expect(proposalSummary({ ops: [{ op: "append" }] })).toBe("1 edit to her self-model.");
  });

  it("returns null rather than printing an object when the payload says nothing readable", () => {
    expect(proposalSummary({})).toBeNull();
    expect(proposalSummary({ nested: { deep: true } })).toBeNull();
  });
});

describe("stripFences — the belt behind the block parser", () => {
  it("removes a closed fence and keeps the prose around it", () => {
    // The hole the fence left collapses to ONE blank line, so the two halves read as two paragraphs
    // rather than being welded into a sentence that was never written.
    expect(stripFences('Here it is.\n```athena:table\n{"columns":["A"]}\n```\nThat is the fleet.')).toBe(
      "Here it is.\n\nThat is the fleet.",
    );
  });

  it("cuts an UNCLOSED fence to the end — half a fence renders as raw JSON otherwise", () => {
    expect(stripFences('The fleet averages 62.\n```athena:chart\n{"labels":["Apr"')).toBe("The fleet averages 62.");
  });

  it("leaves ordinary prose exactly as it was", () => {
    const prose = "Two repos moved up a level.\n\n- acme/api\n- acme/web";
    expect(stripFences(prose)).toBe(prose);
  });
});
