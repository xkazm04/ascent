// @vitest-environment jsdom
//
// The owner form echoed the STORED value with nothing to say where it came from, so an empty
// criticality select meant either "nobody has decided" or "the scan could not see it" and the form
// looked identical in both cases. The same blob that lets the card mark an owner-set value tells the
// form which of its three fields is already an assertion — so the editor and the card can never give
// a reader two different answers about who issued a claim.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { PassportOwnerControls } = await import("./PassportOwnerControls");
const { OWNER_SET_LABEL, SCAN_OBSERVED_LABEL } = await import("./OwnerSetCue");

describe("PassportOwnerControls — each field says who issued its value", () => {
  it("marks the fields the owner has set and leaves the rest scan-observed", () => {
    render(
      <PassportOwnerControls repo="acme/web" criticality="business" lifecycle="ga" rollback={false} ownerSet={{ lifecycle: true }} />,
    );
    expect(screen.getAllByText(OWNER_SET_LABEL)).toHaveLength(1);
    expect(screen.getAllByText(SCAN_OBSERVED_LABEL)).toHaveLength(2);
  });

  it("reads as entirely scan-observed for a repo with no overrides at all", () => {
    render(<PassportOwnerControls repo="acme/web" rollback={false} />);
    expect(screen.queryByText(OWNER_SET_LABEL)).toBeNull();
    expect(screen.getAllByText(SCAN_OBSERVED_LABEL)).toHaveLength(3);
  });
});
