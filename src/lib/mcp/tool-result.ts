// Shared MCP values and result rendering, independent of tool adapters and persistence.


export interface ToolResult {
  structuredContent: unknown;
  /** Human/model-readable text. Defaults to the JSON of structuredContent when omitted. */
  text?: string;
  isError?: boolean;
}


/**
 * The ONE way a tool result becomes text for a model. Lifted out of the MCP route (it was inline at
 * `src/app/api/mcp/route.ts`) when Athena became a second in-process consumer of these same handlers:
 * two doors serving the same tool must not be able to show the model two different renderings of the
 * same answer, and the only way to guarantee that is for neither of them to own the rendering.
 *
 * `text` when the handler wrote one (every `fail()` does), otherwise the pretty-printed structured
 * payload — the exact expression the route used, moved rather than rewritten.
 */
export function toolResultText(result: ToolResult): string {
  return result.text ?? JSON.stringify(result.structuredContent, null, 2);
}


/** The argument bag a tool call arrives with. Untyped by the protocol; validated per handler. */
export type Args = Record<string, unknown>;


export const str = (a: Args, k: string): string | null =>
  typeof a[k] === "string" ? (a[k] as string).trim() : null;


/** A tool-execution error — actionable feedback the model can self-correct from (`isError: true`). */
export const fail = (message: string): ToolResult => ({
  structuredContent: { error: message },
  text: message,
  isError: true,
});
