// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ReconnectedNotice } from "./OnboardingReconnected";

afterEach(cleanup);

describe("ReconnectedNotice — stopped", () => {
  it("says the run may still be going, the page stopped checking, and never claims it finished", () => {
    const { container } = render(<ReconnectedNotice state={{ status: "stopped", pending: 2, total: 5 }} />);
    const text = container.textContent ?? "";
    expect(text).toContain("may still be running");
    expect(text).toContain("stopped checking");
    expect(text).toContain("start it again");
    expect(text).toContain("dashboard");
    expect(text).not.toMatch(/finished|complete|done/i);
  });
});
