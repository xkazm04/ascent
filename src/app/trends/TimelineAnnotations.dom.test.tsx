// @vitest-environment jsdom
// Pins the "Events on this timeline" legend once deploy markers join the score events:
//   • a deploy renders under its own "Deploy" word and a failure-aware tone, never as an incident;
//   • a deploy and a score event pinned to the SAME scan both render (keys are kind-scoped);
//   • no events → no section.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelineAnnotations } from "@/app/trends/TimelineAnnotations";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { DEPLOY_FAILED_COLOR, DEPLOY_OK_COLOR } from "@/app/trends/deployTone";

const SHA = "c".repeat(40);

const regression: TrendAnnotation = {
  at: "2026-09-20T00:00:00.000Z",
  scanId: "s3",
  kind: "regression",
  label: "-6",
  detail: "Regression: overall score fell 6 points from 66 to 60.",
  delta: -6,
  sha: SHA.slice(0, 7),
  commitSha: SHA,
};

const failedDeploy: TrendAnnotation = {
  ...regression,
  kind: "deploy",
  label: "1 failed",
  detail: "Deployment status, not incidents: 1 deployment (1 failed): production failure at fffffff on 2026-09-15.",
  deploys: { count: 1, failed: 1, environments: ["production"] },
};

const cleanDeploy: TrendAnnotation = {
  ...failedDeploy,
  at: "2026-09-10T00:00:00.000Z",
  scanId: "s2",
  label: "deploy",
  detail: "Deployment status, not incidents: 1 deployment: production success at fffffff on 2026-09-05.",
  deploys: { count: 1, failed: 0, environments: ["production"] },
};

afterEach(() => vi.restoreAllMocks());

describe("TimelineAnnotations with deploy markers", () => {
  it("renders a deploy under the Deploy word with the deployment-status sentence", () => {
    render(<TimelineAnnotations annotations={[failedDeploy]} repoFullName="acme/widget" />);
    expect(screen.getByText("Deploy 1 failed")).toBeInTheDocument();
    expect(screen.getByText(/Deployment status, not incidents/)).toBeInTheDocument();
  });

  it("tones a failed deploy red and a clean one blue", () => {
    render(<TimelineAnnotations annotations={[failedDeploy, cleanDeploy]} repoFullName="acme/widget" />);
    const failed = screen.getByText("Deploy 1 failed") as HTMLElement;
    const clean = screen.getByText("Deploy deploy") as HTMLElement;
    expect(failed.style.color).toBe(hexToRgb(DEPLOY_FAILED_COLOR));
    expect(clean.style.color).toBe(hexToRgb(DEPLOY_OK_COLOR));
  });

  it("renders a regression and a deploy on the same scan as two rows without a key collision", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(
      <TimelineAnnotations annotations={[regression, failedDeploy]} repoFullName="acme/widget" />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    const keyWarnings = err.mock.calls.filter((c) => String(c[0]).includes("same key"));
    expect(keyWarnings).toEqual([]);
  });

  it("guard: renders nothing when there are no events", () => {
    const { container } = render(<TimelineAnnotations annotations={[]} repoFullName="acme/widget" />);
    expect(container.innerHTML).toBe("");
  });
});

function hexToRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
