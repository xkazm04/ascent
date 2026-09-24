// @vitest-environment jsdom
// Deploy markers on the overall trend chart. A deploy is pinned to a scan by timestamp identity like
// every other annotation, but it is drawn as its own mark (a toned glyph along the plot floor) so it
// never stacks its chip on top of a band-crossing / regression label on the same scan, and it keys by
// kind so the two can coexist on one scan at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { TrendChart, type TrendPoint } from "./TrendChart";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { DEPLOY_FAILED_COLOR, DEPLOY_OK_COLOR } from "@/app/trends/deployTone";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => vi.restoreAllMocks());

const at = (d: number) => `2026-09-${String(d).padStart(2, "0")}T00:00:00.000Z`;
const POINTS: TrendPoint[] = [
  { score: 64, at: at(1) },
  { score: 66, at: at(10) },
  { score: 60, at: at(20) },
];

const base = { delta: -6, sha: null, commitSha: null };
const regression: TrendAnnotation = { ...base, at: at(20), scanId: "s3", kind: "regression", label: "-6", detail: "Regression." };
const failedDeploy: TrendAnnotation = {
  ...base,
  at: at(20),
  scanId: "s3",
  kind: "deploy",
  label: "1 failed",
  detail: "Deployment status, not incidents: 1 deployment (1 failed).",
  deploys: { count: 1, failed: 1, environments: ["production"] },
};
const cleanDeploy: TrendAnnotation = {
  ...failedDeploy,
  at: at(10),
  scanId: "s2",
  label: "deploy",
  detail: "Deployment status, not incidents: 1 deployment.",
  deploys: { count: 1, failed: 0, environments: ["production"] },
};

const deployMarks = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-deploy-marker]"));

describe("TrendChart deploy markers", () => {
  it("draws one toned deploy glyph per pinned scan, red for a failure and blue otherwise", () => {
    const { container } = render(<TrendChart points={POINTS} annotations={[failedDeploy, cleanDeploy]} />);
    const marks = deployMarks(container);
    expect(marks.map((m) => m.getAttribute("data-deploy-marker"))).toEqual(["s3", "s2"]);
    expect(marks[0]!.querySelector("text")!.getAttribute("fill")).toBe(DEPLOY_FAILED_COLOR);
    expect(marks[1]!.querySelector("text")!.getAttribute("fill")).toBe(DEPLOY_OK_COLOR);
    expect(marks[0]!.querySelector("title")!.textContent).toMatch(/Deployment status, not incidents/);
  });

  it("keeps a regression chip AND a deploy glyph on the same scan, with no key collision", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<TrendChart points={POINTS} annotations={[regression, failedDeploy]} />);
    expect(deployMarks(container)).toHaveLength(1);
    expect(container.querySelector('svg[role="img"]')!.textContent).toContain("-6");
    expect(err.mock.calls.filter((c) => String(c[0]).includes("same key"))).toEqual([]);
  });

  it("guard: a deploy pinned outside the visible slice is dropped, never clamped to an edge", () => {
    const { container } = render(
      <TrendChart points={POINTS} annotations={[{ ...cleanDeploy, at: "2026-08-01T00:00:00.000Z" }]} />,
    );
    expect(deployMarks(container)).toHaveLength(0);
  });
});
