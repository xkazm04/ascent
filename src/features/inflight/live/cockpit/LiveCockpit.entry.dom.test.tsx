// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./LiveCockpit.v1", () => ({ LiveCockpitV1: () => <div>composition-v1</div> }));
vi.mock("./LiveCockpit.v2", () => ({ LiveCockpitV2: () => <div>composition-v2</div> }));

import { LiveCockpit, type LiveCockpitProps } from "./LiveCockpit";

const props = { slug: "kiro" } as unknown as LiveCockpitProps;

describe("LiveCockpit entry: the composition follows the theme the server resolved", () => {
  it("renders the shipped composition for altimeter and when no theme is passed", () => {
    const a = render(<LiveCockpit {...props} theme="altimeter" />);
    expect(screen.getByText("composition-v1")).toBeTruthy();
    a.unmount();
    render(<LiveCockpit {...props} />);
    expect(screen.getByText("composition-v1")).toBeTruthy();
  });
  it("renders the Prism composition for prism", () => {
    render(<LiveCockpit {...props} theme="prism" />);
    expect(screen.getByText("composition-v2")).toBeTruthy();
  });
});
