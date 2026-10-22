// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./LiveCockpit.v2", () => ({ LiveCockpitV2: () => <div>composition-v2</div> }));

import { LiveCockpit, type LiveCockpitProps } from "./LiveCockpit";

const props = { slug: "kiro" } as unknown as LiveCockpitProps;

describe("LiveCockpit entry", () => {
  it("renders the Prism composition", () => {
    render(<LiveCockpit {...props} />);
    expect(screen.getByText("composition-v2")).toBeTruthy();
  });
});
