// @vitest-environment jsdom
//
// WHAT A BLOCKED OPERATOR READS. The bar used to report per TRANSPORT, which in a four-arm comparison
// answers "something is blocked" and leaves the operator to find out which by deleting arms one at a
// time. It reports per ARM now, and this file is what holds it there.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ArmProbeBar } from "./ArmProbeBar";
import { CONTEXT_MISS, CONTEXT_REMEDY, probeFixture, replyFixture } from "./armProbeFixture";

afterEach(cleanup);

const hosted = probeFixture("claude");
const local = probeFixture("pi", CONTEXT_MISS);

/** Two local arms on one server (probe 1, shared) and one hosted arm (probe 0). */
const reply = replyFixture(
  [hosted, local],
  [
    { armId: "claude-sonnet-1", label: "claude:sonnet", execProbe: 0 },
    { armId: "local-2", label: "the 27B", execProbe: 1 },
    { armId: "local-3", label: "the 27B again", execProbe: 1 },
  ],
);

const bar = (props: Partial<Parameters<typeof ArmProbeBar>[0]> = {}) =>
  render(
    <ArmProbeBar
      phase="blocked"
      reply={reply}
      error={reply.refusal}
      stale={false}
      disabled={false}
      onProbe={() => {}}
      {...props}
    />,
  );

describe("ArmProbeBar", () => {
  it("names EVERY blocked arm, not the transport they share", () => {
    bar();
    expect(screen.getByTestId("arm-probe-blocked-local-2")).toHaveTextContent("the 27B");
    expect(screen.getByTestId("arm-probe-blocked-local-3")).toHaveTextContent("the 27B again");
    // The passing arm is not in the alert: a red light beside a green arm is a red light nobody trusts.
    expect(screen.queryByTestId("arm-probe-blocked-claude-sonnet-1")).toBeNull();
  });

  it("puts the remedy on screen, with the observed/required gap that makes it believable", () => {
    bar();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("4096 — 65536 required");
    expect(alert).toHaveTextContent(CONTEXT_REMEDY);
    expect(alert).toHaveTextContent(reply.refusal!);
  });

  it("lists a shared failure ONCE per arm — de-duplication is in the work, not the attribution", () => {
    bar();
    // Both halves of each non-split arm point at the same probe; the context miss is printed once for
    // arm 2 and once for arm 3, never twice for either.
    expect(screen.getAllByText(/4096 — 65536 required/)).toHaveLength(2);
  });

  it("shows nothing but the idle word when the arms changed under the light", () => {
    bar({ stale: true });
    expect(screen.getByTestId("arm-probe")).toHaveAttribute("data-state", "idle");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("declares a probe that was not free", () => {
    const spent = { ...hosted, zeroToken: false };
    const armable = replyFixture([spent], [{ armId: "a-1", label: "a", execProbe: 0 }]);
    bar({ phase: "armable", reply: armable, error: null });
    expect(screen.getByText(/was not free/)).toBeTruthy();
  });
});
