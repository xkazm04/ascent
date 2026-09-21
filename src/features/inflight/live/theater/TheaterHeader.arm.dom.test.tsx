// @vitest-environment jsdom
//
// THE ARM LABEL: shown on every run including an ordinary single-arm one, and rendered as NOTHING —
// not "default" — for a lane recorded before arms existed, whose configuration is genuinely unknown.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Arm } from "@/lib/local/arm";
import { TheaterHeader } from "./TheaterHeader";
import { DEMO_EPOCH, fixturePulse } from "./theaterFixture";
import { headerModel } from "./theaterHeaderModel";

const model = () =>
  headerModel({
    pulse: fixturePulse(),
    loaded: true,
    stale: false,
    clock: DEMO_EPOCH,
    heardAgoMs: 1_000,
    error: null,
    ledgerHref: "/org/acme?tab=live&view=ledger",
  });

const single: Arm = { id: "local", label: "claude:sonnet plan → pi:qwen3.8:27b", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } };

describe("TheaterHeader arm label", () => {
  it("names the arm on an ordinary single-arm run", () => {
    render(<TheaterHeader model={model()} arm={single} />);
    expect(screen.getByTestId("theater-arm")).toHaveTextContent("claude:sonnet plan → pi:qwen3.8:27b");
  });

  it("falls back to the arm's shape when it carries no label", () => {
    render(<TheaterHeader model={model()} arm={{ id: "local", label: "", transport: "pi", model: "qwen3.8:27b" }} />);
    expect(screen.getByTestId("theater-arm")).toHaveTextContent("pi:qwen3.8:27b");
  });

  it("renders NOTHING for a lane recorded before arms existed", () => {
    render(<TheaterHeader model={model()} arm={null} />);
    expect(screen.queryByTestId("theater-arm")).not.toBeInTheDocument();
    expect(screen.queryByText(/default/i)).not.toBeInTheDocument();
  });

  it("renders nothing when no arm is passed at all", () => {
    render(<TheaterHeader model={model()} />);
    expect(screen.queryByTestId("theater-arm")).not.toBeInTheDocument();
  });
});
