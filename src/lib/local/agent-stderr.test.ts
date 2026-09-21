import { describe, expect, it } from "vitest";
import { sanitizeAgentStderr } from "@/lib/local/agent-stderr";

describe("sanitizeAgentStderr — what of stderr may be persisted on a lane", () => {
  it("drops a failing hook's echoed command line whole (the shape the live check found)", () => {
    const stderr = [
      "SessionEnd hook [node C:/Users/x/.claude/hooks/notify.mjs --token ghp_abcdefghijklmnopqrstuvwxyz0123456789] failed: exit 1",
      "Error: You've hit your session limit · resets 3pm",
    ].join("\n");
    const out = sanitizeAgentStderr(stderr);
    expect(out).toBe("Error: You've hit your session limit · resets 3pm");
    expect(out).not.toContain("ghp_");
  });

  it("redacts labelled secrets and keeps the label", () => {
    expect(sanitizeAgentStderr("request failed: api_key=sk-live-123 retry")).toBe("request failed: api_key=[redacted] retry");
    expect(sanitizeAgentStderr('Authorization: "Bearer abc.def"')).toBe("Authorization: [redacted]");
    expect(sanitizeAgentStderr("password: hunter2")).toBe("password: [redacted]");
  });

  it("redacts a long unlabelled opaque run", () => {
    const out = sanitizeAgentStderr("fetch https://x.test/?q=0123456789abcdef0123456789abcdef01 failed");
    expect(out).toBe("fetch https://x.test/?q=[redacted] failed");
  });

  it("leaves an ordinary error sentence untouched", () => {
    const line = "Error: ENOENT: no such file or directory, open 'src/index.ts'";
    expect(sanitizeAgentStderr(line)).toBe(line);
  });

  it("returns an empty string for nothing", () => {
    expect(sanitizeAgentStderr("")).toBe("");
  });
});
