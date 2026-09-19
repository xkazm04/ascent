// @vitest-environment jsdom
//
// Direction 8 — a decision on a passport blocker must survive the blocker's WORDING changing. The key
// used to hash the sentence, so a copy edit rotated it and orphaned the recorded decision. These pin
// the three states: the new id key is what gets written, an OLD decision stored under the prose key
// is still honoured, and a rewording no longer loses the decision. DecisionControl is only offered
// on a declinable finding (`auto.no-manifest` here).

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DecisionMap } from "@/lib/org/decision-map";
import { blockerKey } from "@/lib/org/findings";
import type { AppPassport, PassportFinding } from "@/lib/types";
import { declineOffers, isDeclinableFinding } from "./passportDeclineOffers";

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

const OLD = "No in-repo .ai/manifest.yaml (agent-facing capability contract).";
const NEW = "No in-repo .ai/manifest.yaml.";
const ID = "auto.no-manifest";

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
      findings={withFindings ? [{ id: ID, code: "no-manifest", text, severity: "warn" }] : undefined}
    />,
  );
  return seen[0]!;
}

const HOLES: PassportFinding[] = [
  { id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" },
  { id: "prod.security-unassessable", code: "security-unassessable", text: "Scanning could not be assessed.", severity: "info" },
  { id: "prod.observability-unassessable", code: "observability-unassessable", text: "Observability could not be assessed.", severity: "info" },
  { id: "prod.tests-unassessable", code: "tests-unassessable", text: "Tests could not be assessed.", severity: "info" },
  { id: "auto.self-verify-unassessable", code: "self-verify-unassessable", text: "Self-verify could not be assessed.", severity: "info" },
  { id: "prod.enforcement-not-observable", code: "enforcement-not-observable", text: "Enforcement (branch protection) not observable.", severity: "info" },
];

describe("BlockerList — decision identity", () => {
  it("writes under the minted finding id, not a hash of the sentence", () => {
    const row = renderList(OLD, {});
    expect(row.itemKey).toBe("acme/api::auto.no-manifest");
    expect(row.itemKey).not.toBe(blockerKey("acme/api", OLD));
  });

  it("a decision SURVIVES the blocker text changing", () => {
    const decisions: DecisionMap = {
      "acme/api::auto.no-manifest": { status: "accepted", rationale: "cron worker, no agents", decidedBy: "alice" },
    };
    // Same cause, new sentence (copy edit).
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
    expect(row.itemKey).toBe("acme/api::auto.no-manifest");
  });

  it("prefers the id-keyed decision when BOTH spellings exist", () => {
    const decisions: DecisionMap = {
      "acme/api::auto.no-manifest": { status: "accepted", rationale: "current", decidedBy: "alice" },
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

describe("BlockerList — evidence-limit findings are not decidable", () => {
  it("omits DecisionControl on every unassessable and enforcement-not-observable row", () => {
    seen.length = 0;
    render(
      <BlockerList
        title="Production blockers"
        items={HOLES.map((f) => f.text)}
        allClear="clear"
        org="acme"
        fullName="acme/api"
        decisions={{}}
        findings={HOLES}
      />,
    );
    expect(seen).toHaveLength(0);
    expect(HOLES.every((f) => !isDeclinableFinding(f.id))).toBe(true);
    expect(
      declineOffers({
        automationReadiness: { findings: HOLES.filter((f) => f.id.startsWith("auto.")) },
        productionReadiness: { findings: HOLES.filter((f) => f.id.startsWith("prod.")) },
      } as unknown as AppPassport),
    ).toEqual([]);
    for (const f of HOLES) expect(screen.getByText(f.text)).toBeTruthy();
  });

  it("still offers DecisionControl on a declinable gap next to a coverage hole", () => {
    const gap: PassportFinding = {
      id: "prod.zero-observability",
      code: "zero-observability",
      text: "Zero observability.",
      severity: "block",
    };
    const hole = HOLES[HOLES.length - 1]!;
    seen.length = 0;
    render(
      <BlockerList
        title="Production blockers"
        items={[gap.text, hole.text]}
        allClear="clear"
        org="acme"
        fullName="acme/api"
        decisions={{}}
        findings={[gap, hole]}
      />,
    );
    expect(seen).toEqual([{ itemKey: "acme/api::prod.zero-observability", status: "open" }]);
    expect(screen.getByText(hole.text)).toBeTruthy();
  });
});
