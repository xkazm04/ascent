// Pure tests for the shared tech-stack display + grouping helpers (Features 3a/3b). The role→group-key
// mapping is the contract that keeps a repo's badge and its filterable group in sync, so pin it:
// multi-membership (fullstack → frontend AND backend:node), per-language backend keys (§8.11), unknown
// dropped, dedup, and the label round-trip.

import { describe, it, expect } from "vitest";
import { techChips, techGroupsFor, techGroupLabel, STACK_ROLE_LABEL } from "@/lib/org/tech-stack";
import type { TechStack } from "@/lib/types";

const stack = (over: Partial<TechStack>): TechStack => ({ languages: [], frameworks: [], roles: [], confidence: 1, ...over });

describe("techGroupsFor", () => {
  it("maps a fullstack repo to BOTH frontend and a per-language backend group (multi-membership)", () => {
    const groups = techGroupsFor(stack({ roles: ["frontend", "backend"], backendLanguage: "Node" }));
    expect(groups).toEqual([
      { key: "frontend", label: "Frontend" },
      { key: "backend:node", label: "Backend · Node" },
    ]);
  });

  it("uses a plain 'backend' key when no backend language is known", () => {
    expect(techGroupsFor(stack({ roles: ["backend"] }))).toEqual([{ key: "backend", label: "Backend" }]);
  });

  it("drops the 'unknown' role (no group) and returns [] for a null stack", () => {
    expect(techGroupsFor(stack({ roles: ["unknown"] }))).toEqual([]);
    expect(techGroupsFor(null)).toEqual([]);
  });

  it("dedupes keys", () => {
    const groups = techGroupsFor(stack({ roles: ["backend", "backend"], backendLanguage: "Python" }));
    expect(groups).toEqual([{ key: "backend:python", label: "Backend · Python" }]);
  });
});

describe("techChips", () => {
  it("shows Backend·<lang> and appends a bounded number of frameworks", () => {
    const chips = techChips(stack({ roles: ["backend"], backendLanguage: "Go", frameworks: ["Gin", "X", "Y", "Z"] }), 2);
    expect(chips[0]).toBe("Backend·Go");
    expect(chips).toContain("Gin");
    expect(chips).toContain("X");
    expect(chips).not.toContain("Z"); // capped at maxFrameworks=2
  });
  it("omits the unknown role", () => {
    expect(techChips(stack({ roles: ["unknown"] }))).toEqual([]);
  });
});

describe("techGroupLabel", () => {
  it("round-trips a backend:<lang> key to a capitalized label", () => {
    expect(techGroupLabel("backend:python")).toBe("Backend · Python");
  });
  it("uses the role label for a plain role key", () => {
    expect(techGroupLabel("frontend")).toBe(STACK_ROLE_LABEL.frontend);
    expect(techGroupLabel("data_ml")).toBe(STACK_ROLE_LABEL.data_ml);
  });
  it("humanizes an unknown key instead of rendering it raw", () => {
    expect(techGroupLabel("custom-thing")).toBe("Custom Thing");
  });
});
