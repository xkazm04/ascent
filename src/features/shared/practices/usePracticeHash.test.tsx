// @vitest-environment jsdom
//
// Pins the `#practice-<id>` deep links from the four surfaces that emit them (the executive briefing,
// plan initiatives, the overview's fix-first list + posture dimensions; governance's "cheapest path to
// green" chips were a fifth until that card was deleted 2026-08-19). The
// ledger redesign dropped the old card anchor, so every one of them silently landed at the top of an
// undifferentiated table. The contract restored here is BOTH halves of the handoff: the row carries
// the anchor and is scrolled into view, and its detail modal — the apply flow those surfaces were
// pointing at — is opened.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PracticeLibraryV2 } from "./PracticeLibrary.v2";
import { usePracticesLibrary } from "./usePracticesLibrary";
import { practiceIdFromHash } from "./usePracticeHash";
import type { OrgPractice } from "@/lib/db";

function practice(over: Partial<OrgPractice> = {}): OrgPractice {
  return {
    id: "test-discipline",
    label: "Test discipline",
    dimId: "D2",
    what: "The guardrail that makes AI-generated changes safe to merge.",
    starter: ["Cover the critical paths"],
    total: 4,
    strongCount: 1,
    exemplar: { name: "api", fullName: "acme/api", score: 88 },
    gapRepos: ["app"],
    gapRepoRefs: [{ name: "app", fullName: "acme/app" }],
    ...over,
  };
}

function view(hash: string, practices: OrgPractice[] = [practice(), practice({ id: "ci-gates", label: "CI gates", dimId: "D3" })]) {
  window.location.hash = hash;
  return render(<Harness practices={practices} />);
}

// Module-level so the hook sees stable inputs (fresh literals would re-derive the rows every render).
const ADOPTION = {};
const DIMS = [{ id: "D2", label: "Testing" }, { id: "D3", label: "CI" }];
const REPOS = ["acme/app"];

/** The Prism library wiring: the rows, plus a probe for which practice the shared hook has open. */
function Harness({ practices }: { practices: OrgPractice[] }) {
  const lib = usePracticesLibrary({
    initialPlaybooks: [],
    practices,
    adoption: ADOPTION,
    dimOptions: DIMS,
    repoOptions: REPOS,
  });
  return (
    <>
      <PracticeLibraryV2 rows={lib.rows} rollout={lib.rollout} fleetSize={1} onOpen={lib.open} onCreate={() => {}} />
      <output data-testid="open">{lib.openRow?.label ?? ""}</output>
    </>
  );
}

const scrollSpy = vi.fn();

beforeEach(() => {
  scrollSpy.mockClear();
  Element.prototype.scrollIntoView = scrollSpy;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
});

afterEach(() => {
  window.location.hash = "";
});

describe("practiceIdFromHash", () => {
  it("reads the practice id the five call sites emit", () => {
    expect(practiceIdFromHash("#practice-test-discipline")).toBe("test-discipline");
    expect(practiceIdFromHash("practice-ci-gates")).toBe("ci-gates"); // leading '#' optional
  });

  it("ignores any other hash (and a bare, id-less anchor)", () => {
    expect(practiceIdFromHash("")).toBeNull();
    expect(practiceIdFromHash("#top")).toBeNull();
    expect(practiceIdFromHash("#practice-")).toBeNull();
  });
});

describe("Practice library rows — `#practice-<id>` deep link", () => {
  it("gives every mined row the anchor the call sites route to", () => {
    view("");
    expect(document.getElementById("practice-test-discipline")).not.toBeNull();
    expect(document.getElementById("practice-ci-gates")).not.toBeNull();
  });

  it("scrolls to the targeted row AND opens its detail modal (the apply flow, not just the list)", () => {
    view("#practice-ci-gates");

    expect(scrollSpy).toHaveBeenCalledTimes(1);
    // The scroll happened on the TARGET row, not the first one.
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById("practice-ci-gates"));
    // The detail (the apply flow) is opened on the right practice.
    expect(screen.getByTestId("open")).toHaveTextContent("CI gates");
  });

  it("honors prefers-reduced-motion (no smooth scroll)", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as never;
    view("#practice-test-discipline");
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  });

  it("leaves the page untouched for a hash that is not a practice link", () => {
    view("#somewhere-else");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("open")).toBeEmpty();
  });

  it("does not open anything for a stale/unknown practice id", () => {
    view("#practice-no-such-practice");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("open")).toBeEmpty();
  });
});
