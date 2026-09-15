// @vitest-environment jsdom
//
// The human sees what only the agent was told (#8 / W3).
//
// `compileStance` has built `unenforceable[]` since the compiler shipped, and its only readers were
// `mcp/handlers.ts` and `mcp/tools.ts`. So an agent asking about the stance was handed the list of
// clauses only it can honour, while the owner who PUBLISHED those clauses saw a perimeter that
// showed the declaration and the controls and never the gap between them.
//
// Two invariants: the list renders one line per clause with its reason, and it renders NOTHING when
// there is nothing to say. The empty case is the one worth pinning — a reassuring "everything here
// is enforced" is a claim this component is in no position to make.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { unenforceableClauses, type UnenforceableClause } from "@/lib/org/admission";
import type { AiStance } from "@/lib/types";

const { UnenforceableClauses } = await import("./UnenforceableClauses");

const clause = (n: number): UnenforceableClause[] =>
  Array.from({ length: n }, (_, i) => ({ clause: `clause-${i}`, why: `because ${i}` }));

const stance = (over: Partial<AiStance> = {}): AiStance =>
  ({
    permittedTools: [],
    permittedModels: [],
    noAiZones: [],
    reviewTiers: [],
    provenance: { requireTrailer: false, requireHumanApproval: false },
    ...over,
  }) as AiStance;

describe("UnenforceableClauses", () => {
  it("renders one line per clause, each carrying its reason", () => {
    render(<UnenforceableClauses clauses={clause(3)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(screen.getByText(`clause-${i}`)).toBeTruthy();
      expect(screen.getByText(`because ${i}`)).toBeTruthy();
    }
  });

  it("renders NOTHING when the list is empty — silence, not a reassurance", () => {
    const { container } = render(<UnenforceableClauses clauses={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("agrees in number with the compiled output an agent reads", () => {
    // The point of the direction: one derivation, two audiences. If these ever diverge, the stance
    // says one thing to an agent and another to the person who wrote it.
    const s = stance({ permittedModels: ["claude"], permittedTools: ["copilot"] });
    render(<UnenforceableClauses clauses={unenforceableClauses(s, null)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(unenforceableClauses(s, null).length);
    expect(screen.getByText(/permittedModels/)).toBeTruthy();
    expect(screen.getByText(/permittedTools/)).toBeTruthy();
  });

  it("shows nothing for a stance that declares none of the uncompilable clauses", () => {
    const { container } = render(<UnenforceableClauses clauses={unenforceableClauses(stance(), null)} />);
    expect(container.innerHTML).toBe("");
  });
});
