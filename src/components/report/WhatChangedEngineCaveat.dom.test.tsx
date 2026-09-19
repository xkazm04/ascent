// @vitest-environment jsdom
//
// A mock-vs-live What Changed pair used to render a green/red delta with no label that the two
// instruments are not comparable. Pins the labelled caveat: mock mixed with a live model is named;
// same-kind pairs (both mock, both live, two different live providers) stay quiet.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  MIXED_ENGINE_PAIR_LABEL,
  MIXED_ENGINE_PAIR_NOTE,
} from "@/components/report/chartEngine";
import { MixedEngineCaveat } from "./WhatChangedEngineCaveat";

describe("MixedEngineCaveat — mock vs live is labelled", () => {
  it("labels mock → live as mixed engines and states the instruments are not comparable", () => {
    render(<MixedEngineCaveat beforeEngine="mock" afterEngine="claude-cli" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-testid", "mixed-engine-pair");
    expect(status).toHaveTextContent(MIXED_ENGINE_PAIR_LABEL);
    expect(status).toHaveTextContent(MIXED_ENGINE_PAIR_NOTE);
  });

  it("labels live → mock the other way (order of the pair does not hide the mix)", () => {
    render(<MixedEngineCaveat beforeEngine="bedrock" afterEngine="mock" />);
    expect(screen.getByTestId("mixed-engine-pair")).toHaveTextContent(/mixed engines/i);
  });

  it("stays quiet when both sides are mock", () => {
    const { container } = render(<MixedEngineCaveat beforeEngine="mock" afterEngine="mock" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stays quiet when both sides are live, even if the live providers differ", () => {
    const { container } = render(
      <MixedEngineCaveat beforeEngine="claude-cli" afterEngine="bedrock" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("stays quiet when a side is missing — undefined is not a live model", () => {
    const { container } = render(<MixedEngineCaveat beforeEngine="mock" afterEngine={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
