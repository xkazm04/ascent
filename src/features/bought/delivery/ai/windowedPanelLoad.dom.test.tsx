// @vitest-environment jsdom
//
// G4: a thrown windowed Delivery read is not "no attempts recorded". Both panels used to
// `.catch(() => null)` and vanish — the same screen as an empty fleet, which after a connected
// Claude exporter reads as "session.id never arrived" rather than "try refresh".

import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { render } from "@testing-library/react";
import type { DeliveryOutcomes } from "@/lib/db/delivery-outcomes";
import type { UnitEconomicsView } from "@/lib/db/unit-economics";
import type { ResolvedWindow } from "@/lib/window";

const { mockGetUnitEconomics, mockGetDeliveryOutcomes } = vi.hoisted(() => ({
  mockGetUnitEconomics: vi.fn(),
  mockGetDeliveryOutcomes: vi.fn(),
}));

vi.mock("@/lib/db/unit-economics", () => ({ getUnitEconomics: mockGetUnitEconomics }));
vi.mock("@/lib/db/delivery-outcomes", () => ({
  getDeliveryOutcomes: mockGetDeliveryOutcomes,
  MIN_DEPLOYMENTS: 5,
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const { UnitEconomicsPanel } = await import("./UnitEconomicsPanel");
const { DeliveryOutcomesPanel } = await import("./DeliveryOutcomesPanel");

const period: ResolvedWindow = {
  key: "30d",
  start: new Date("2026-08-18T00:00:00.000Z"),
  end: new Date("2026-09-16T23:59:59.999Z"),
  endExclusive: new Date("2026-09-17T00:00:00.000Z"),
  title: "Last 30 days",
  comparisonLabel: "vs 30d ago",
  reviewTitle: "30 days in review",
};

const emptyFleet: UnitEconomicsView = {
  rollup: { repos: [], totals: { sessions: 0, producedCode: 0, costCents: 0, people: 0 }, from: null, to: null },
  rows: [],
  fleet: {
    sessions: 0,
    producedCode: 0,
    producedRate: null,
    costCents: 0,
    costPerProducingSession: null,
    costPerMergedAiChange: null,
    mergedAiChanges: 0,
    reposWithoutDenominator: 0,
  },
};

const emptyOutcomes: DeliveryOutcomes = {
  total: 0,
  failed: 0,
  failureRate: null,
  perWeek: null,
  medianRestoreHours: null,
  attributed: 0,
  unattributed: 0,
  coverage: null,
  ai: { deployments: 0, failed: 0, failureRate: null },
  human: { deployments: 0, failed: 0, failureRate: null },
  failureRateGap: null,
  environments: [],
  from: null,
  to: null,
};

describe("UnitEconomicsPanel — throw vs empty fleet", () => {
  it("shows SectionEmpty couldn't-load on rejection, never the session.id onboarding", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUnitEconomics.mockRejectedValue(new Error("db blip"));
    const { container } = render(await UnitEconomicsPanel({ slug: "acme", period }));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    const text = container.textContent ?? "";
    expect(text).toMatch(/couldn't load/i);
    expect(text).toMatch(/try refreshing/i);
    expect(text).not.toMatch(/session\.id/);
    expect(text).not.toMatch(/Integrations/);
    expect(text).not.toMatch(/no agent sessions/i);
  });

  it("keeps the sessions===0 onboarding card when the fleet is empty", async () => {
    mockGetUnitEconomics.mockResolvedValue(emptyFleet);
    const { container } = render(await UnitEconomicsPanel({ slug: "acme", period }));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Unit economics/);
    expect(text).toMatch(/session\.id/);
    expect(text).toMatch(/Integrations/);
    expect(text).not.toMatch(/couldn't load/i);
  });

  it("stays absent when the query honestly returns null (no DB / no org)", async () => {
    mockGetUnitEconomics.mockResolvedValue(null);
    const { container } = render(await UnitEconomicsPanel({ slug: "acme", period }));
    expect(container.textContent ?? "").toBe("");
  });
});

describe("DeliveryOutcomesPanel — throw vs empty fleet", () => {
  it("shows SectionEmpty couldn't-load on rejection, never the re-scan onboarding", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetDeliveryOutcomes.mockRejectedValue(new Error("db blip"));
    const { container } = render(await DeliveryOutcomesPanel({ slug: "acme", period }));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
    const text = container.textContent ?? "";
    expect(text).toMatch(/couldn't load/i);
    expect(text).toMatch(/try refreshing/i);
    expect(text).not.toMatch(/Re-scan the fleet/);
    expect(text).not.toMatch(/no deployments were recorded/i);
  });

  it("keeps the total===0 onboarding card when nothing deployed", async () => {
    mockGetDeliveryOutcomes.mockResolvedValue(emptyOutcomes);
    const { container } = render(await DeliveryOutcomesPanel({ slug: "acme", period }));
    const text = container.textContent ?? "";
    expect(text).toMatch(/Delivery outcomes/);
    expect(text).toMatch(/no deployments were recorded/i);
    expect(text).toMatch(/Re-scan the fleet/);
    expect(text).not.toMatch(/couldn't load/i);
  });

  it("stays absent when the query honestly returns null (no DB / no org)", async () => {
    mockGetDeliveryOutcomes.mockResolvedValue(null);
    const { container } = render(await DeliveryOutcomesPanel({ slug: "acme", period }));
    expect(container.textContent ?? "").toBe("");
  });
});
