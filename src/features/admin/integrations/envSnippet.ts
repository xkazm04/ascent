// Display/copy split for the Claude Code connect surface.
//
// The ingest token is a bearer credential: whoever holds the string can push telemetry as the org.
// The page therefore has exactly two representations of it, and they must never be confused:
//
//   - what is RENDERED (goes into the DOM, into a screenshot, into a screen-share) — masked unless
//     the owner explicitly reveals it;
//   - what is COPIED (goes to the clipboard, into a shell profile) — always the real value, because
//     a clipboard full of bullet characters is a worse bug than the leak it would be "fixing".
//
// Both the token field and the ENVIRONMENT block are built from the same pair of functions below, so
// there is one masking rule rather than one per surface — the previous shape masked the field and
// then printed the full token inside the env snippet immediately underneath it.

/** Bullets stand in for the mac; the `asc_otel.<slug>[.eN].` prefix is not secret and stays legible. */
export function maskIngestToken(token: string): string {
  return token.replace(/^(asc_otel\.[^.]+\.(?:e\d+\.)?)(.+)$/, (_, prefix: string, mac: string) => prefix + "•".repeat(Math.min(mac.length, 24)));
}

/**
 * The exporter configuration. `token` is substituted verbatim, so callers pass the real token to
 * build the copyable snippet and {@link maskIngestToken}'s output to build the rendered one.
 */
export function buildEnvSnippet(endpoint: string, token: string): string {
  return [
    "export CLAUDE_CODE_ENABLE_TELEMETRY=1",
    "export OTEL_METRICS_EXPORTER=otlp",
    "export OTEL_LOGS_EXPORTER=otlp",
    "export OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    `export OTEL_EXPORTER_OTLP_ENDPOINT=${endpoint}`,
    `export OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer ${token}`,
    "export OTEL_RESOURCE_ATTRIBUTES=git.repository=$(git remote get-url origin)",
  ].join("\n");
}
