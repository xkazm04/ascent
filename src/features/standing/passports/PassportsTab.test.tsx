// Passport 0.4.0 plumbing: the tab is where a passport becomes a table row, so anything it does not
// copy into `detail` does not exist for any surface below it. The 0.4.0 producer work (minted
// `findings`, and `declined[]` carrying the gaps the read-time overlay REMOVED from `blockers`) was
// invisible in the product for exactly this reason. These pin the pass-through: a declined gap and
// the ids the fleet rollup buckets on must both reach the row.
//
// Node environment on purpose — this asserts on the element tree the server component returns, not on
// rendered DOM (that is covered by the two .dom tests beside this file).

import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { AppPassport } from "@/lib/types";

const getOrgRollup = vi.fn();
vi.mock("@/lib/db", () => ({ getOrgRollup: (...a: unknown[]) => getOrgRollup(...a) }));
vi.mock("@/lib/org/decision-map", () => ({ decisionMap: async () => ({}) }));
vi.mock("@/lib/org/scope", () => ({ resolveOrgScope: async () => ({ segments: [], segmentId: null, techGroupId: null }) }));
vi.mock("@/lib/org/passport-display", () => ({ passportStackChips: () => [] }));
vi.mock("./autonomy/autonomyModel", () => ({ deriveAutonomy: () => ({}) }));
vi.mock("./PassportsSwitcher", () => ({ PassportsSwitcher: () => null }));

const { PassportsTab } = await import("./PassportsTab");

const OBS = "Zero observability: no error tracking, structured logs, metrics, or tracing.";

const passport = (): AppPassport =>
  ({
    identity: { purpose: "Internal cron worker" },
    generatedAt: "2026-08-20",
    declined: [
      {
        path: "productionReadiness.observability",
        label: "Observability",
        reason: "Failures page via the platform.",
        blocker: OBS,
        findingId: "prod.zero-observability",
        at: "2025-02-01",
      },
    ],
    automationReadiness: {
      level: "L3", score: 60, blockers: ["No agent memory."],
      findings: [{ id: "auto.no-memory", code: "no-memory", text: "No agent memory.", severity: "warn" }],
      selfVerify: { build: true, test: true, lint: true, typecheck: true },
      aiInWorkflow: false,
    },
    productionReadiness: {
      band: "beta", score: 50, blockers: [], findings: [],
      ci: { level: "checks", provider: "github-actions", gates: [] },
      tests: { level: "partial", coveragePct: null, criticalPathCovered: false },
      security: { level: "policy", tools: [] },
      observability: { level: "none" },
      delivery: { migrations: "none", iac: false, rollback: false },
    },
    evidence: { confidence: 0.8 },
  }) as unknown as AppPassport;

/** Walk the returned element tree for the first node carrying a `rows` prop (PassportsSwitcher). */
function findRows(node: ReactNode): unknown[] | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findRows(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as { rows?: unknown[]; children?: ReactNode };
  if (Array.isArray(props.rows)) return props.rows;
  return findRows(props.children ?? null);
}

describe("PassportsTab — 0.4.0 fields reach the row", () => {
  it("copies findings and the owner's declined gaps into detail", async () => {
    getOrgRollup.mockResolvedValue({ repos: [{ fullName: "acme/web", name: "web", passport: passport() }] });
    const rows = findRows(await PassportsTab({ slug: "acme", sp: {} }));
    expect(rows).toHaveLength(1);
    const detail = (rows![0] as { detail: Record<string, unknown> }).detail;

    expect(detail.autoFindings).toEqual([
      { id: "auto.no-memory", code: "no-memory", text: "No agent memory.", severity: "warn" },
    ]);
    expect(detail.prodFindings).toEqual([]);
    // The accepted gap the overlay removed from `prodBlockers` is still carried, with its reason.
    expect(detail.prodBlockers).toEqual([]);
    expect(detail.declined).toHaveLength(1);
    expect((detail.declined as { findingId: string; reason: string }[])[0]).toMatchObject({
      findingId: "prod.zero-observability",
      reason: "Failures page via the platform.",
    });
  });

  it("leaves the 0.4.0 fields undefined for a pre-0.4.0 passport rather than fabricating them", async () => {
    const pp = passport();
    delete (pp.automationReadiness as { findings?: unknown }).findings;
    delete (pp.productionReadiness as { findings?: unknown }).findings;
    delete (pp as { declined?: unknown }).declined;
    getOrgRollup.mockResolvedValue({ repos: [{ fullName: "acme/old", name: "old", passport: pp }] });
    const rows = findRows(await PassportsTab({ slug: "acme", sp: {} }));
    const detail = (rows![0] as { detail: Record<string, unknown> }).detail;
    expect(detail.autoFindings).toBeUndefined();
    expect(detail.declined).toBeUndefined();
    // The unchanged 0.3.0 projection still carries the rendered sentences.
    expect(detail.autoBlockers).toEqual(["No agent memory."]);
  });
});
