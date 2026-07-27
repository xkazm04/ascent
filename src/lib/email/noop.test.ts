// The no-op sender's whole contract is the `skipped` flag: it reports ok (nothing went wrong) AND
// skipped (nothing was sent). The notify path now branches on that distinction, so it gets a test —
// previously nothing asserted that `skipped` was even set, which is how the flag came to be read by
// nothing while the UI reported success on every unconfigured deploy.

import { afterEach, describe, expect, it, vi } from "vitest";
import { NoopEmailSender } from "./noop";

afterEach(() => vi.restoreAllMocks());

describe("NoopEmailSender", () => {
  it("reports ok AND skipped, and never throws", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await new NoopEmailSender().send({
      to: "dev@nuda.dev",
      subject: "Your Ascent scan is ready",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(res).toEqual({ ok: true, skipped: true });
    expect(new NoopEmailSender().name).toBe("noop");
    expect(log).toHaveBeenCalled(); // the would-be send is logged for the operator
  });
});
