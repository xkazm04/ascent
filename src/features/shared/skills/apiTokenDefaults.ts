// Default scopes pre-checked when minting an org API token. The MCP door, not leftover skills:read —
// that resource stays an explicit opt-in and is never implied by mcp:read.

export const DEFAULT_PICKED_SCOPES = ["mcp:read"] as const;
