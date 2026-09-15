// @vitest-environment jsdom
//
// Direction 8 — a decision on a passport blocker must survive the blocker's WORDING changing. The key
// used to hash the sentence, and `auto.self-verify-gaps` embeds the repo's missing-script list in it,
// so adding a `lint` script rotated the key and orphaned the recorded decision. These pin the three
// states: the new id key is what gets written, an OLD decision stored under the prose key is still
// honoured, and a rewording no longer loses the decision.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DecisionMap } from "@/lib/org/decision-map";
import { blockerKey } from "@/lib/org/findings";

// Capture what the decision widget is handed — the itemKey it would WRITE under, and the status it
// resolved to. Rendering the real control would pull in fetch and a router.
const seen: { itemKey: string; status: string }[] = [];
vi.mock("@/components/org/DecisionControl", () => ({
  DecisionControl: ({ itemKey, status }: { itemKey: string; status: string }) => {
    seen.push({ itemKey, status });
    return null;
  },
}));

const { BlockerList } = await import("./PassportDetailLists");

const OLD = "Agent can't self-verify (missing lint, test).";
const NEW = "Agent can't self-verify (missing test).";
const ID = "auto.self-verify-gaps";

function renderList(text: string, decisions: DecisionMap, withFindings = true) {
  seen.length = 0;
  render(
    <BlockerList
      title="Automation blockers"
      items={[text]}
      allClear="clear"
      org="acme"
      fullName="acme/api"
      decisions={decisions}
      findings={withFindings ? [{ id: ID, code: "self-verify-gaps", text, severity: "warn" }] : undefined}
    />,
  );
  return seen[0]!;
}

describe("BlockerList — decision identity", () => {
  it("writes under the minted finding id, not a hash of the sentence", () => {
    const row = renderList(OLD, {});
    expect(row.itemKey).toBe("acme/api::auto.self-verify-gaps");
    expect(row.itemKey).not.toBe(blockerKey("acme/api", OLD));
  });

  it("a decision SURVIVES the blocker text changing", () => {
    const decisions: DecisionMap = {
      "acme/api::auto.self-verify-gaps": { status: "accepted", rationale: "we ship without lint", decidedBy: "alice" },
    };
    // Same cause, new sentence (the repo added a lint script).
    const row = renderList(NEW, decisions);
    expect(row.status).toBe("accepted");
  });

  it("still honours a LEGACY decision stored under the old prose key", () => {
    const decisions: DecisionMap = {
      [blockerKey("acme/api", OLD)]: { status: "dismissed", rationale: "n/a here", decidedBy: "bob" },
    };
    const row = renderList(OLD, decisions);
    // Read matched the alias...
    expect(row.status).toBe("dismissed");
    // ...but the next write lands on the stable id key.
    expect(row.itemKey).toBe("acme/api::auto.self-verify-gaps");
  });

  it("prefers the id-keyed decision when BOTH spellings exist", () => {
    const decisions: DecisionMap = {
      "acme/api::auto.self-verify-gaps": { status: "accepted", rationale: "current", decidedBy: "alice" },
      [blockerKey("acme/api", OLD)]: { status: "dismissed", rationale: "ancient", decidedBy: "bob" },
    };
    expect(renderList(OLD, decisions).status).toBe("accepted");
  });

  it("falls back to the prose key entirely for a pre-0.4.0 passport with no findings", () => {
    const decisions: DecisionMap = {
      [blockerKey("acme/api", OLD)]: { status: "snoozed", rationale: "later", decidedBy: "bob" },
    };
    const row = renderList(OLD, decisions, false);
    expect(row.itemKey).toBe(blockerKey("acme/api", OLD));
    expect(row.status).toBe("snoozed");
  });

  it("renders an undecided blocker as open", () => {
    expect(renderList(OLD, {}).status).toBe("open");
    expect(screen.getByText(OLD)).toBeTruthy();
  });
});
