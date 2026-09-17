// @vitest-environment node
//
// The connect snippet is a shipped config. /v1/logs authenticates and 202-accepts without persisting,
// so shipping OTEL_LOGS_EXPORTER=otlp would send prompt/tool events into a drain every 5s.
// FAIL-BEFORE: putting `export OTEL_LOGS_EXPORTER=otlp` back in the snippet makes this red.

import { describe, expect, it } from "vitest";
import { buildEnvSnippet } from "./envSnippet";

const snippet = buildEnvSnippet("https://ascent.example/api/integrations/ingest", "asc_otel.acme.secretmac");

describe("buildEnvSnippet — metrics only until logs persist", () => {
  it("does not ship OTEL_LOGS_EXPORTER=otlp", () => {
    expect(snippet).not.toMatch(/OTEL_LOGS_EXPORTER\s*=\s*otlp/);
    expect(snippet.split("\n").some((line) => /^export OTEL_LOGS_EXPORTER=/.test(line))).toBe(false);
  });

  it("still ships the metrics exporter the ingest path persists", () => {
    expect(snippet).toContain("export CLAUDE_CODE_ENABLE_TELEMETRY=1");
    expect(snippet).toContain("export OTEL_METRICS_EXPORTER=otlp");
    expect(snippet).toContain("export OTEL_EXPORTER_OTLP_PROTOCOL=http/json");
    expect(snippet).toContain("OTEL_EXPORTER_OTLP_ENDPOINT='https://ascent.example/api/integrations/ingest'");
    expect(snippet).toContain("Authorization=Bearer asc_otel.acme.secretmac");
  });
});
