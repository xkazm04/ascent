// Gate: a freshly opened mint form and an empty-scope server fallback both admit the MCP door.

import { describe, expect, it } from "vitest";
import { DEFAULT_PICKED_SCOPES } from "./apiTokenDefaults";
import { cleanScopes } from "@/lib/db/org-api-tokens";

describe("default minted token scopes", () => {
  it("default picked set and cleanScopes([]) include mcp:read", () => {
    expect(DEFAULT_PICKED_SCOPES).toContain("mcp:read");
    expect(cleanScopes([])).toContain("mcp:read");
  });

  it("does not silently include skills:read — that resource is an explicit opt-in", () => {
    expect(DEFAULT_PICKED_SCOPES).not.toContain("skills:read");
    expect(cleanScopes(["skills:read"])).toEqual(["skills:read"]);
  });
});
