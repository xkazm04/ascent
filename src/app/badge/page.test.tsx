// @vitest-environment jsdom
//
// /badge renders the "guard it in CI" gate section. GateSection was a maintained component rendered
// NOWHERE — the only surface carrying the "free, no account needed" pitch and a runnable gate command
// sat dead in the tree while the page rendered <BadgeGenerator /> alone.
//
// Two things are pinned here: (1) the page's REAL snippet values (imported from ./gate-snippets, the
// module page.tsx renders) describe ONE policy in both renderings, and (2) the section is composed
// into the generator and interpolates the repo the visitor typed — the old server-rendered version
// printed `<ASCENT_URL>/<owner>/<repo>` placeholders on a page whose entire promise is "copy this".
//
// The whole page is NOT rendered: the shared site chrome (SiteHeader/SiteFooter) suspends outside the
// Next runtime, so a full-page render throws before any assertion. The generator + snippet module are
// exactly the parts this change owns.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// governance.ts (the ciActionYaml single-source) pulls @/lib/db; none of it is needed to build a snippet.
vi.mock("@/lib/db", () => ({ getOrgGatePolicy: vi.fn(), getOrgRollup: vi.fn() }));

import { GATE_QUERY, GATE_YAML, PUBLIC_GATE_POLICY } from "./gate-snippets";
import { BadgeGenerator } from "@/components/badge/BadgeGenerator";

const gate = () => ({ yaml: GATE_YAML, query: GATE_QUERY });
// Scoped to the <pre> blocks: "curl --fail" also appears as inline <code> in the section's prose.
const textOf = (match: RegExp) => screen.getByText(match, { selector: "pre" }).textContent ?? "";

describe("/badge gate snippets — one policy, two renderings", () => {
  it("expresses the SAME bar as a gate query and as action inputs", () => {
    // The demonstrated bar leads with the deterministic Security floor — the gate's strongest
    // turn-it-on argument belongs in the snippet a visitor copies, not only in prose.
    expect(PUBLIC_GATE_POLICY.minDimensionFor?.D9).toBe(50);

    expect(GATE_QUERY).toBe("min_level=L3&min_security=50");
    expect(GATE_YAML).toContain("min-level: L3");
    expect(GATE_YAML).toContain("min-security: '50'");
    // From the canonical ciActionYaml preamble, not a hand-rolled copy that could drift from the
    // action's real ref / required input / indentation.
    expect(GATE_YAML.split("\n")[0]).toContain("ascent@v1");
    expect(GATE_YAML).toContain("    ascent-url: ${{ vars.ASCENT_URL }}");
  });
});

describe("/badge — the free CI gate section is actually rendered", () => {
  it("shows the pitch, the deterministic-security argument, and both snippets", () => {
    render(<BadgeGenerator gate={gate()} />);

    expect(screen.getByText(/free, no account needed/)).toBeTruthy();
    expect(screen.getByText(/fully deterministic/)).toBeTruthy();
    expect(textOf(/curl --fail "/)).toContain("min_security=50");
    expect(textOf(/uses:/)).toContain("min-security: '50'");
  });

  it("interpolates the repo the visitor typed into the runnable gate command", () => {
    render(<BadgeGenerator gate={gate()} />);

    // Honest placeholder until a repo is entered — and the <pre> says so.
    expect(textOf(/curl --fail "/)).toContain("<owner>/<repo>");
    expect(textOf(/curl --fail "/)).toContain("enter a repository above");

    fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "facebook/react" } });

    expect(textOf(/curl --fail "/)).toContain("/api/gate/facebook/react?min_level=L3&min_security=50");
    expect(textOf(/curl --fail "/)).not.toContain("<owner>/<repo>");
  });

  it("stays off the page when no gate snippets are supplied", () => {
    render(<BadgeGenerator />);
    expect(screen.queryByText(/free, no account needed/)).toBeNull();
  });
});
